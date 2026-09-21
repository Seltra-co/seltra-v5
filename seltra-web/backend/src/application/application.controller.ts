import { Body, Controller, Get, Post, Query } from '@nestjs/common'
import type { ApplicationDto } from './application.dto'
import { ApplicationService } from './application.service'

@Controller('application')
export class ApplicationController {
  constructor(private readonly applicationService: ApplicationService) {}

  @Post('submit')
  submit(@Body() body: ApplicationDto) {
    return this.applicationService.submitApplication(body)
  }

  @Get('verify-merchant-id')
  verifyMerchantId(@Query('id') merchantId: string) {
    return this.applicationService.verifyMerchantId(merchantId)
  }
}
