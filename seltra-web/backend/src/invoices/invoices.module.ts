import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { InvoicesController } from './invoices.controller'
import { InvoicesService } from './invoices.service'
import { ResendService } from '../resend/resend.service'
import { TenantEventsService } from '../internal-ops/events/tenant-events.service'
import { AgentEventsService } from '../agent/agent-events.service'

@Module({
  imports: [JwtModule.register({ secret: process.env.JWT_SECRET || 'change-me' })],
  controllers: [InvoicesController],
  providers: [InvoicesService, ResendService, TenantEventsService, AgentEventsService],
})
export class InvoicesModule {}
