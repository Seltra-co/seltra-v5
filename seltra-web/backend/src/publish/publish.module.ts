import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { PublishController } from './publish.controller'
import { LegacyStoreGuard } from './legacy-store.guard'
import { PublishService } from './publish.service'

@Module({
  imports: [AuthModule],
  controllers: [PublishController],
  providers: [PublishService, LegacyStoreGuard],
  exports: [PublishService],
})
export class PublishModule {}
