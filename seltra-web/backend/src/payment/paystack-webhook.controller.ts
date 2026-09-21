//seltra/backend/src/payment/paystack-webhook.controller.ts
import { Body, Controller, Headers, HttpCode, Post } from '@nestjs/common'
import { PaymentService, type WebhookPayload } from './payment.service'

@Controller('webhooks/paystack')
export class PaystackWebhookController {
  constructor(private readonly paymentService: PaymentService) {}

  @Post()
  @HttpCode(200)
  handle(@Body() body: WebhookPayload, @Headers('x-paystack-signature') signature?: string) {
    return this.paymentService.handleWebhook(body, signature)
  }
}
