//backend/src/store/store-image.controller.ts
import {
  BadRequestException, Body, Controller, Headers, NotFoundException,
  Param, Post, UnauthorizedException,
} from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { prisma } from '../db'
import { StoreImageService } from './store-image.service'

class ChangeImageDto {
  prompt?: string
  imageUrl?: string
}

@Controller('seltra/store/:storeId')
export class StoreImageController {
  constructor(
    private readonly jwtService: JwtService,
    private readonly storeImageService: StoreImageService,
  ) {}

  @Post('hero-image')
  async changeHeroImage(
    @Param('storeId') storeId: string,
    @Body() body: ChangeImageDto,
    @Headers('authorization') auth?: string,
  ) {
    const tenant = await this.assertOwner(storeId, auth)
    if (body.imageUrl) return this.storeImageService.setHeroImageUrl(tenant.id, body.imageUrl)
    return this.storeImageService.regenerateHeroImage(tenant.id, body.prompt)
  }

  @Post('products/:productId/image')
  async changeProductImage(
    @Param('storeId') storeId: string,
    @Param('productId') productId: string,
    @Body() body: ChangeImageDto,
    @Headers('authorization') auth?: string,
  ) {
    const tenant = await this.assertOwner(storeId, auth)
    if (body.imageUrl) return this.storeImageService.setProductImageUrl(tenant.id, productId, body.imageUrl)
    return this.storeImageService.regenerateProductImage(tenant.id, productId, body.prompt)
  }

  @Post('products/by-name/image')
  async changeProductImageByName(
    @Param('storeId') storeId: string,
    @Body() body: ChangeImageDto & { productName: string },
    @Headers('authorization') auth?: string,
  ) {
    const tenant = await this.assertOwner(storeId, auth)
    if (!body.productName) throw new BadRequestException('productName is required')
    const product = await this.storeImageService.findProductByName(tenant.id, body.productName)
    if (!product) throw new NotFoundException(`No product matching "${body.productName}"`)

    if (body.imageUrl) return this.storeImageService.setProductImageUrl(tenant.id, product.id, body.imageUrl)
    return this.storeImageService.regenerateProductImage(tenant.id, product.id, body.prompt)
  }

  private async assertOwner(storeId: string, authorization?: string) {
    const { resolveUserIdFromAuthorization } = await import('../auth/resolve-user')
    const userId = await resolveUserIdFromAuthorization(authorization, this.jwtService, true)
    const tenant = await prisma.tenant.findFirst({
      where: { OR: [{ id: storeId }, { slug: storeId }], ownerId: userId! },
    })
    if (!tenant) throw new NotFoundException('Store not found')
    return tenant
  }
}