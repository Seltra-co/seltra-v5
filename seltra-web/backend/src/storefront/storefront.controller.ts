import { Body, Controller, Get, Headers, Ip, Param, Post, Query } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { StorefrontCheckoutDto, StorefrontConfirmDto } from './storefront.dto'
import { StorefrontService } from './storefront.service'

@ApiTags('storefront')
@Controller('storefront/:slug')
export class StorefrontController {
  constructor(private readonly storefront: StorefrontService) {}

  @Get('store')
  @ApiOperation({ summary: 'Read public store details for a generated storefront' })
  getStore(@Param('slug') slug: string) { return this.storefront.getStore(slug) }

  @Get('products')
  @ApiOperation({ summary: 'Read active catalog products for a generated storefront' })
  getProducts(@Param('slug') slug: string, @Query('category') category?: string) { return this.storefront.getProducts(slug, category) }

  @Get('categories')
  getCategories(@Param('slug') slug: string) { return this.storefront.getCategories(slug) }

  @Get('shipping')
  getShipping(@Param('slug') slug: string) { return this.storefront.getShipping(slug) }

  @Post('checkout')
  @ApiOperation({ summary: 'Initialize checkout using server-authoritative product prices' })
  checkout(@Param('slug') slug: string, @Body() body: StorefrontCheckoutDto, @Ip() ip: string) {
    return this.storefront.checkout(slug, body, ip || 'unknown')
  }

  @Post('orders/confirm')
  confirmCheckout(@Param('slug') slug: string, @Body() body: StorefrontConfirmDto) {
    return this.storefront.confirmCheckout(slug, body.reference)
  }

  @Get('orders/:id')
  getOrder(@Param('slug') slug: string, @Param('id') id: string, @Query('email') email = '') {
    return this.storefront.getOrder(slug, id, email)
  }
}
