// apps/api/src/app.module.ts
import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { ScheduleModule } from '@nestjs/schedule'
import { AppController } from './app.controller'
import { AppService } from './app.service'
import { AgentModule } from './agent/agent.module'
import { AuthModule } from './auth/auth.module'
import { StoreModule } from './store/store.module'
import { OrdersModule } from './orders/orders.module'
import { HealthModule } from './health/health.module'
import { KeepAliveModule } from './keep-alive/keep-alive.module'
import { ConversationsModule } from './conversations/conversations.module'
import { PaymentModule } from './payment/payment.module'
import { ApplicationModule } from './application/application.module'
import { ResendService } from './resend/resend.service';
import { InternalOpsModule } from './internal-ops/internal-ops.module'
import { NotificationsModule } from './notifications/notifications.module'
import { InvoicesModule } from './invoices/invoices.module'
import { MarketingModule } from './marketing/marketing.module'

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    ScheduleModule.forRoot(),   // enables @Cron decorators globally
    AuthModule,
    AgentModule,
    StoreModule,
    PaymentModule,
    OrdersModule,
    ConversationsModule,
    ApplicationModule,
    NotificationsModule,
    InvoicesModule,
    MarketingModule,
    InternalOpsModule,
    HealthModule,
    KeepAliveModule,
  ],
  controllers: [AppController],
  providers: [AppService, ResendService],
})
export class AppModule {}
