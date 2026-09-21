//apps/api/src/orders/orders.controller.ts
import { Controller, Post, Body, Headers, HttpCode, Get, Param, Patch, Query } from '@nestjs/common'
import { OrdersService } from './orders.service'

class VerifyOrderDto {
  reference!: string
  tenantId!: string
  customerEmail!: string
  customerName!: string
  cart!: Array<{ product: { id: string; name: string; price: string }; quantity: number }>
  totalAmount!: number
  currency!: string
}

class InitializeOrderDto extends VerifyOrderDto {}

@Controller()
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post('seltra/orders/initialize')
  @HttpCode(200)
  initialize(@Body() body: InitializeOrderDto) {
    return this.ordersService.initialize(body)
  }

  @Post('seltra/orders/verify')
  @HttpCode(200)
  verify(@Body() body: VerifyOrderDto) {
    return this.ordersService.verifyAndSave(body)
  }

  @Post('seltra/orders/webhook')
  @HttpCode(200)
  webhook(@Body() body: unknown, @Headers('x-paystack-signature') signature?: string) {
    return this.ordersService.handleWebhook(body, signature)
  }

  @Get('orders')
  list(
    @Headers('authorization') authorization: string | undefined,
    @Query('tenantId') tenantId?: string,
    @Query('page') page = '1',
    @Query('perPage') perPage = '20',
    @Query('status') status?: string,
  ) {
    return this.ordersService.listOrders(authorization, {
      tenantId,
      page: Number(page) || 1,
      perPage: Number(perPage) || 20,
      status,
    })
  }

  @Get('orders/by-reference')
  getByReference(@Query('ref') reference: string) {
    return this.ordersService.getOrderByReference(reference)
  }

  @Get('orders/:id')
  get(
    @Param('id') id: string,
    @Headers('authorization') authorization?: string,
    @Query('tenantId') tenantId?: string,
    @Query('ref') reference?: string,
  ) {
    return this.ordersService.getOrder(authorization, id, tenantId, reference)
  }

  @Patch('orders/:id/status')
  updateStatus(
    @Param('id') id: string,
    @Body() body: { status: string; tenantId?: string },
    @Headers('authorization') authorization?: string,
  ) {
    return this.ordersService.updateStatus(authorization, id, body.status, body.tenantId)
  }
}
