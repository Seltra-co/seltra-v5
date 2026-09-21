import { Module } from '@nestjs/common'
import { ApplicationController } from './application.controller'
import { ApplicationService } from './application.service'
import { ResendService } from '../resend/resend.service'

@Module({
  controllers: [ApplicationController],
  providers: [ApplicationService, ResendService],
})
export class ApplicationModule {}