import { Module } from '@nestjs/common'
import { ResendService } from '../resend/resend.service'
import { ApplicationsController } from './controllers/applications.controller'
import { DashboardController } from './controllers/dashboard.controller'
import { MerchantsController } from './controllers/merchants.controller'
import { TenantEventsService } from './events/tenant-events.service'
import { OpsApiKeyGuard } from './guards/ops-api-key.guard'
import { ApplicationsService } from './services/applications.service'
import { DashboardService } from './services/dashboard.service'
import { MerchantsService } from './services/merchants.service'
import { OpsAuditService } from './services/ops-audit.service'

@Module({
  controllers: [DashboardController, MerchantsController, ApplicationsController],
  providers: [
    OpsApiKeyGuard,
    DashboardService,
    MerchantsService,
    ApplicationsService,
    OpsAuditService,
    TenantEventsService,
    ResendService,
  ],
  exports: [TenantEventsService],
})
export class InternalOpsModule {}
