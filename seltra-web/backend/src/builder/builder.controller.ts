import { Body, Controller, Get, Headers, Post, Query, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { BuilderSessionDto, SyncTenantAppDto } from './builder.dto'
import { BuilderService } from './builder.service'
import { CoreServiceGuard } from '../core-internal/core-service.guard'

@ApiTags('builder')
@ApiBearerAuth()
@Controller('builder')
export class BuilderController {
  constructor(private readonly builder: BuilderService) {}

  @Post('session')
  createSession(@Headers('authorization') authorization: string | undefined, @Body() body: BuilderSessionDto) {
    return this.builder.createSession(authorization, body.tenantId)
  }

  @Post('ws-ticket')
  createWsTicket(@Headers('authorization') authorization: string | undefined, @Body() body: BuilderSessionDto) {
    return this.builder.createWsTicket(authorization, body.tenantId)
  }

  @Get('apps')
  listApps(@Headers('authorization') authorization: string | undefined, @Query('tenantId') tenantId: string) {
    return this.builder.listApps(authorization, tenantId)
  }

  @Post('apps/sync')
  @UseGuards(CoreServiceGuard)
  syncApp(@Body() body: SyncTenantAppDto) {
    return this.builder.syncApp(body)
  }
}
