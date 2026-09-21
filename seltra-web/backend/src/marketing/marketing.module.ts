import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { MarketingController } from './marketing.controller'
import { MarketingService } from './marketing.service'
import { MoolreService } from '../payment/moolre.service'
import { ResendService } from '../resend/resend.service'
import { AgentEventsService } from '../agent/agent-events.service'

@Module({
  imports: [JwtModule.register({ secret: process.env.JWT_SECRET || 'change-me' })],
  controllers: [MarketingController],
  providers: [MarketingService, MoolreService, ResendService, AgentEventsService],
})
export class MarketingModule {}
