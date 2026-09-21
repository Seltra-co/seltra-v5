//seltra-web/backend/src/payment/payment.controller.ts
import { Body, Controller, Get, Headers, Post, Query } from '@nestjs/common'
import { PaymentService } from './payment.service'

class InitializePaymentDto {
  tenantId!: string
  items!: Array<{
    productId?: string
    product?: { id?: string; name?: string; price?: string | number }
    name?: string
    quantity: number
    price?: string | number
    selectedVariants?: Record<string, string>
  }>
  customerEmail!: string
  customerName?: string
  customerPhone?: string
  shippingAddress?: string
  shippingCity?: string
  shippingCountry?: string
  marketingOptIn?: boolean
  deliveryTier?: { id: string; label: string; priceFrom: number; currency: string }
  callbackUrl?: string
}

class ValidatePayoutDto {
  tenantId?: string
  method?: string
  providerCode?: string
  account?: string
}

class RequestDisbursementDto {
  tenantId?: string
  amount?: string | number
}

class ConfirmDisbursementDto {
  tenantId?: string
  disbursementId?: string
  otp?: string
}

@Controller('payment')
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  @Post('initialize')
  initialize(@Body() body: InitializePaymentDto) {
    return this.paymentService.initializePayment(
      body.tenantId,
      body.items,
      body.customerEmail,
      body.customerName,
      {
        customerPhone: body.customerPhone,
        shippingAddress: body.shippingAddress,
        shippingCity: body.shippingCity,
        shippingCountry: body.shippingCountry,
        marketingOptIn: body.marketingOptIn,
        deliveryTier: body.deliveryTier,
      },
      body.callbackUrl,
    )
  }

  @Get('ledger')
  ledger(
    @Headers('authorization') authorization?: string,
    @Query('tenantId') tenantId?: string,
    @Query('page') page = '1',
    @Query('perPage') perPage = '10',
  ) {
    return this.paymentService.getMerchantLedger(authorization, tenantId, Number(page) || 1, Number(perPage) || 10)
  }

  @Get('payout-options')
  payoutOptions() {
    return this.paymentService.getPayoutOptions()
  }

  @Post('payout/validate')
  validatePayout(@Headers('authorization') authorization: string | undefined, @Body() body: ValidatePayoutDto) {
    return this.paymentService.validatePayoutAccount(authorization, body)
  }

  @Post('disbursement/request')
  requestDisbursement(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: RequestDisbursementDto,
  ) {
    return this.paymentService.requestDisbursement(authorization, body.tenantId, body.amount)
  }

  @Post('disbursement/confirm')
  confirmDisbursement(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: ConfirmDisbursementDto,
  ) {
    return this.paymentService.confirmDisbursement(authorization, body)
  }

  @Get('sales')
  sales(
    @Headers('authorization') authorization: string | undefined,
    @Query('tenantId') tenantId?: string,
    @Query('page') page = '1',
    @Query('perPage') perPage = '20',
  ) {
    return this.paymentService.getMerchantSales(
      authorization,
      Number(page) || 1,
      Number(perPage) || 20,
      tenantId,
    )
  }

  @Get('orders')
  orders(
    @Headers('authorization') authorization: string | undefined,
    @Query('tenantId') tenantId?: string,
    @Query('page') page = '1',
    @Query('perPage') perPage = '20',
  ) {
    return this.paymentService.getMerchantSales(
      authorization,
      Number(page) || 1,
      Number(perPage) || 20,
      tenantId,
    )
  }

  @Get('customers')
  customers(
    @Headers('authorization') authorization: string | undefined,
    @Query('tenantId') tenantId?: string,
    @Query('page') page = '1',
    @Query('perPage') perPage = '10',
  ) {
    return this.paymentService.getMerchantCustomers(authorization, tenantId, Number(page) || 1, Number(perPage) || 10)
  }

  @Get('verify')
  verify(@Query('reference') reference: string) {
    return this.paymentService.verifyPayment(reference)
  }
}
