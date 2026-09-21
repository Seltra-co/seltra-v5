//store/products.controller.ts
import {
  BadRequestException,
  Body, Controller, Delete, Get, Headers, HttpCode,
  Param, Patch, Post, Query,
} from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { prisma } from '../db'
import { UnauthorizedException, NotFoundException } from '@nestjs/common'
import { TenantEventsService } from '../internal-ops/events/tenant-events.service'
import { planLimits } from '../common/plan-limits'

class ProductVariantDto {
  id?: string
  name!: string
  value!: string
}

class UpsertProductDto {
  name!: string
  description?: string
  price!: string
  currency?: string
  category?: string
  sku?: string
  variants?: ProductVariantDto[]
}

class BulkProductActionDto {
  action!: 'increase_prices_percent' | 'premium_names' | 'set_category'
  percent?: number
  category?: string
}

@Controller('seltra/store/:storeId/products')
export class ProductsController {

  constructor(
    private readonly jwtService: JwtService,
    private readonly tenantEvents: TenantEventsService,
  ) {}

 @Get()
  async list(
    @Param('storeId') storeId: string,
    @Headers('authorization') auth?: string,
    @Query('page') pageQuery = '1',
    @Query('perPage') perPageQuery = '12',
  ) {
    const tenant = await this.assertOwner(storeId, auth)
    const page = Math.max(1, Number(pageQuery) || 1)
    const perPage = Math.min(50, Math.max(1, Number(perPageQuery) || 12))
    const where = { tenantId: tenant.id }
    const [data, total] = await Promise.all([
      prisma.product.findMany({
        where,
        include: { images: true, variants: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      prisma.product.count({ where }),
    ])
    return { data, total, page, perPage }
  }

  @Post()
  async create(
    @Param('storeId') storeId: string,
    @Body() body: UpsertProductDto,
    @Headers('authorization') auth?: string,
  ) {
    const tenant = await this.assertOwner(storeId, auth)
    const [count, owner] = await Promise.all([
      prisma.product.count({ where: { tenantId: tenant.id } }),
      prisma.user.findUnique({ where: { id: tenant.ownerId ?? undefined }, select: { plan: true } }),
    ])
    const { maxProductsPerStore } = planLimits(owner?.plan)
    if (count >= maxProductsPerStore) {
      throw new BadRequestException(`Your plan allows up to ${maxProductsPerStore} products for this store. Upgrade to Premium for more.`)
    }
    const product = await prisma.product.create({
      data: {
        tenantId: tenant.id,
        name: body.name,
        description: body.description,
        price: body.price,
        currency: body.currency ?? 'GHS',
        category: body.category,
        sku: body.sku,
        status: 'active',
        tags: [],
      },
      include: { images: true, variants: true },
    })
    void this.tenantEvents.recordForTenant(tenant.id, 'product_added', { productId: product.id, name: product.name })
    return product
  }

  @Patch()
  async bulkUpdate(
    @Param('storeId') storeId: string,
    @Body() body: BulkProductActionDto,
    @Headers('authorization') auth?: string,
  ) {
    const tenant = await this.assertOwner(storeId, auth)
    const products = await prisma.product.findMany({ where: { tenantId: tenant.id }, include: { images: true, variants: true } })

    if (body.action === 'increase_prices_percent') {
      const percent = Number(body.percent ?? 10)
      await Promise.all(products.map((product) => prisma.product.update({
        where: { id: product.id },
        data: { price: (Number(product.price) * (1 + percent / 100)).toFixed(2) },
      })))
    }

    if (body.action === 'premium_names') {
      await Promise.all(products.map((product) => prisma.product.update({
        where: { id: product.id },
        data: { name: /premium|signature|reserve/i.test(product.name) ? product.name : `Signature ${product.name}` },
      })))
    }

    if (body.action === 'set_category' && body.category) {
      await prisma.product.updateMany({ where: { tenantId: tenant.id }, data: { category: body.category } })
    }

    const updated = await prisma.product.findMany({
      where: { tenantId: tenant.id },
      include: { images: true, variants: true },
      orderBy: { createdAt: 'desc' },
    })
    void this.tenantEvents.recordForTenant(tenant.id, 'ai_invocation', { action: `bulk_${body.action}`, count: updated.length })
    return { data: updated, count: updated.length }
  }

  @Patch(':productId')
  async update(
    @Param('storeId') storeId: string,
    @Param('productId') productId: string,
    @Body() body: Partial<UpsertProductDto>,
    @Headers('authorization') auth?: string,
  ) {
    const tenant = await this.assertOwner(storeId, auth)
    const product = await prisma.product.findFirst({ where: { id: productId, tenantId: tenant.id } })
    if (!product) throw new NotFoundException('Product not found')
    return prisma.product.update({
      where: { id: productId },
      data: {
        ...(body.name !== undefined && { name: body.name }),
        ...(body.description !== undefined && { description: body.description }),
        ...(body.price !== undefined && { price: body.price }),
        ...(body.currency !== undefined && { currency: body.currency }),
        ...(body.category !== undefined && { category: body.category }),
        ...(body.sku !== undefined && { sku: body.sku }),
        ...(body.variants !== undefined && {
          variants: {
            deleteMany: {},
            createMany: {
              data: body.variants.map((variant) => ({
                name: variant.name,
                value: variant.value,
              })),
            },
          },
        }),
      },
      include: { images: true, variants: true },
    })
  }

  @Delete(':productId')
  @HttpCode(200)
  async remove(
    @Param('storeId') storeId: string,
    @Param('productId') productId: string,
    @Headers('authorization') auth?: string,
  ) {
    const tenant = await this.assertOwner(storeId, auth)
    const product = await prisma.product.findFirst({ where: { id: productId, tenantId: tenant.id } })
    if (!product) throw new NotFoundException('Product not found')
    await prisma.product.delete({ where: { id: productId } })
    return { success: true, id: productId }
  }

  
private async assertOwner(storeId: string, authorization?: string) {
    const token = authorization?.replace(/^Bearer\s+/i, '')
    if (!token) throw new UnauthorizedException('Missing token')
    let userId: string
    try {
      const payload = await this.jwtService.verifyAsync<{ sub: string }>(token, {
        secret: process.env.JWT_SECRET || 'change-me',
      })
      userId = payload.sub
    } catch {
      throw new UnauthorizedException('Invalid token')
    }
    // Support both UUID and slug
    const tenant = await prisma.tenant.findFirst({
      where: { OR: [{ id: storeId }, { slug: storeId }], ownerId: userId },
    })
    if (!tenant) throw new NotFoundException('Store not found')
    return tenant
  }
}
