// seltra/backend/src/payment/payment.module.ts
import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { PaymentController } from './payment.controller'
import { PaymentService } from './payment.service'
import { PaystackService } from './paystack.service'
import { PaystackWebhookController } from './paystack-webhook.controller'
import { MoolreService } from './moolre.service'
import { MoolreWebhookController } from './moolre-webhook.controller'
import { TenantEventsService } from '../internal-ops/events/tenant-events.service'
import { OrderAgentService } from '../orders/order-agent.service'
import { AgentEventsService } from '../agent/agent-events.service'
import { ResendService } from '../resend/resend.service'

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'change-me',
      signOptions: { expiresIn: '7d' },
    }),
  ],
  controllers: [PaymentController, PaystackWebhookController, MoolreWebhookController],
  providers: [PaymentService, PaystackService, MoolreService, TenantEventsService, OrderAgentService, AgentEventsService, ResendService],
  exports: [PaymentService],
})
export class PaymentModule {}
