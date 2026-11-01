import { Module } from '@nestjs/common'
import { SeltraEngineController } from './engine.controller'
import { SeltraEngineService } from './engine.service'

@Module({ controllers: [SeltraEngineController], providers: [SeltraEngineService] })
export class SeltraEngineModule {}
