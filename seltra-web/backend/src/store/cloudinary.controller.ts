// seltra-web/backend/src/store/cloudinary.controller.ts
import {
  Controller, Post, Body, Headers,
  UnauthorizedException, BadRequestException, InternalServerErrorException,
  Logger,
} from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { prisma } from '../db'
import { uploadImageBuffer } from './cloudinary.service'

@Controller('seltra/upload')
export class CloudinaryController {
  private readonly logger = new Logger(CloudinaryController.name)

  constructor(private readonly jwtService: JwtService) {}

  /**
   * POST /api/v1/seltra/upload/product-image
   * Body: { storeId: string, productId: string, imageBase64: string, mimeType: string }
   */
  @Post('product-image')
  async uploadProductImage(
    @Body() body: { storeId: string; productId: string; imageBase64: string; mimeType: string },
    @Headers('authorization') auth?: string,
  ) {
    const userId = await this.getUserId(auth)

    if (!body.imageBase64 || !body.productId || !body.storeId) {
      throw new BadRequestException('Missing imageBase64, productId, or storeId')
    }

    // Verify store ownership — also handle slug-based storeId
    const tenant = await prisma.tenant.findFirst({
      where: { OR: [{ id: body.storeId }, { slug: body.storeId }], ownerId: userId },
    })
    if (!tenant) throw new UnauthorizedException('Store not found or access denied')

    // Sanitize public_id: strip leading/trailing slashes, replace unsafe chars
    const safeProductId = body.productId.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/^_+|_+$/g, '')
    const publicId = `seltra/${tenant.id}/products/${safeProductId}`

    let result: { secure_url: string }
    try {
      result = await uploadImageBuffer(body.imageBase64, body.mimeType ?? 'image/jpeg', publicId)
   } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : typeof err === 'object' && err !== null
            ? JSON.stringify(err)
            : String(err)
      this.logger.error(`Cloudinary upload failed: ${msg}`)
      throw new InternalServerErrorException(`Image upload failed: ${msg}`)
    }

    // Upsert the primary ProductImage row
    // Upsert the primary ProductImage row — only for real product IDs
try {
  // Skip DB upsert for temporary composer IDs (used by the agent attachment flow)
  const isComposerId = body.productId.startsWith('composer-')
  
  if (!isComposerId) {
    // Verify product exists and belongs to this tenant before touching images
    const product = await prisma.product.findFirst({
      where: { id: body.productId, tenantId: tenant.id },
      select: { id: true },
    })

    if (product) {
      const existing = await prisma.productImage.findFirst({
        where: { productId: body.productId, isPrimary: true },
      })
      if (existing) {
        await prisma.productImage.update({
          where: { id: existing.id },
          data: { url: result.secure_url },
        })
      } else {
        await prisma.productImage.create({
          data: { productId: body.productId, url: result.secure_url, isPrimary: true },
        })
      }
      await prisma.productImage.deleteMany({
        where: { productId: body.productId, isPrimary: false },
      })
    }
    // If product not found, upload still succeeded — just return the URL
  }
} catch (err) {
  this.logger.warn(`Cloudinary upload OK but DB upsert failed: ${err}`)
}

return { success: true, url: result.secure_url }
  }

  private async getUserId(authorization?: string) {
    const token = authorization?.replace(/^Bearer\s+/i, '')
    if (!token) throw new UnauthorizedException('Missing token')
    try {
      const payload = await this.jwtService.verifyAsync<{ sub: string }>(
        token,
        { secret: process.env.JWT_SECRET || 'change-me' },
      )
      return payload.sub
    } catch {
      throw new UnauthorizedException('Invalid token')
    }
  }
}