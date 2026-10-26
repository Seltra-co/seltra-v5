import { Module } from '@nestjs/common'
import { BuilderModule } from '../builder/builder.module'
import { CoreInternalController } from './core-internal.controller'
import { CoreServiceGuard } from './core-service.guard'

@Module({ imports: [BuilderModule], controllers: [CoreInternalController], providers: [CoreServiceGuard] })
export class CoreInternalModule {}
