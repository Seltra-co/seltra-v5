import { Module } from '@nestjs/common'
import { BuilderModule } from '../builder/builder.module'
import { CoreInternalController } from './core-internal.controller'
import { CoreServiceGuard } from './core-service.guard'
import { PublishModule } from '../publish/publish.module'

@Module({ imports: [BuilderModule, PublishModule], controllers: [CoreInternalController], providers: [CoreServiceGuard] })
export class CoreInternalModule {}
