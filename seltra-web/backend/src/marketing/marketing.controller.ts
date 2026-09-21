import { Body, Controller, Get, Headers, Post, Query } from '@nestjs/common'
import { MarketingService } from './marketing.service'

@Controller('marketing')
export class MarketingController {
  constructor(private readonly marketing: MarketingService) {}

  @Get('history')
  history(
    @Headers('authorization') authorization?: string,
    @Query('tenantId') tenantId?: string,
    @Query('page') page = '1',
    @Query('perPage') perPage = '10',
  ) {
    return this.marketing.history(authorization, tenantId, Number(page) || 1, Number(perPage) || 10)
  }

  @Get('templates')
  templates(
    @Headers('authorization') authorization?: string,
    @Query('tenantId') tenantId?: string,
    @Query('page') page = '1',
    @Query('perPage') perPage = '9',
  ) {
    return this.marketing.templates(authorization, tenantId, Number(page) || 1, Number(perPage) || 9)
  }

  @Post('send')
  send(@Headers('authorization') authorization: string | undefined, @Body() body: Parameters<MarketingService['send']>[1]) {
    return this.marketing.send(authorization, body)
  }

  @Post('templates')
  createTemplate(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: Parameters<MarketingService['createTemplate']>[1],
  ) {
    return this.marketing.createTemplate(authorization, body)
  }
}
