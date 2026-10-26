import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { BuilderController } from './builder.controller'
import { BuilderService } from './builder.service'
import { CoreServiceGuard } from '../core-internal/core-service.guard'

@Module({ imports: [AuthModule], controllers: [BuilderController], providers: [BuilderService, CoreServiceGuard], exports: [BuilderService] })
export class BuilderModule {}
