//apps/api/src/orders/orders.module.ts
import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { OrdersController } from './orders.controller'
import { OrdersService } from './orders.service'
import { TenantEventsService } from '../internal-ops/events/tenant-events.service'
import { OrderAgentService } from './order-agent.service'
import { MoolreService } from '../payment/moolre.service'
import { AgentEventsService } from '../agent/agent-events.service'

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'change-me',
    }),
  ],
  controllers: [OrdersController],
  providers: [OrdersService, TenantEventsService, OrderAgentService, MoolreService, AgentEventsService],
})
export class OrdersModule {}
