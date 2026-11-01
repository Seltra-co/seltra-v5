import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { BuilderController } from './builder.controller'
import { BuilderService } from './builder.service'
import { CoreServiceGuard } from '../core-internal/core-service.guard'
import { CreditsService } from '../credits/credits.service'

@Module({ imports: [AuthModule], controllers: [BuilderController], providers: [BuilderService, CoreServiceGuard, CreditsService], exports: [BuilderService] })
export class BuilderModule {}
