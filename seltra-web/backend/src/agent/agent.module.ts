//apps/api/src/agent/agent.module.ts
import { Module } from '@nestjs/common'
import { AgentController } from './agent.controller'
import { AgentService } from './agent.service'
import { StoreModule } from '../store/store.module'
import { ContextEngine } from '../ai/context-engine.service'
import { AgentEventsService } from './agent-events.service'
import { MoolreService } from '../payment/moolre.service'

@Module({
  imports: [StoreModule],
  controllers: [AgentController],
  providers: [AgentService, ContextEngine, AgentEventsService, MoolreService],
  exports: [AgentEventsService],
})
export class AgentModule {}
