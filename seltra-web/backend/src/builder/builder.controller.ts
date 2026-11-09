import { Body, Controller, Get, Headers, Post, Query, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { BuilderIntentDto, BuilderSessionDto, SyncCoreAppStateDto, SyncTenantAppDto } from './builder.dto'
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

  @Post('intent')
  promptIntent(@Headers('authorization') authorization: string | undefined, @Body() body: BuilderIntentDto) {
    return this.builder.promptIntent(authorization, body.prompt)
  }

  @Get('credits')
  getCredits(@Headers('authorization') authorization: string | undefined, @Query('tenantId') tenantId?: string) {
    return this.builder.getCredits(authorization, tenantId)
  }

  @Post('ws-ticket')
  createWsTicket(@Headers('authorization') authorization: string | undefined, @Headers('x-seltra-run-id') runId: string | undefined, @Body() body: BuilderSessionDto) {
    return this.builder.createWsTicket(authorization, body.tenantId, body.coreToken, runId)
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

  @Post('apps/state')
  syncCoreAppState(@Headers('authorization') authorization: string | undefined, @Body() body: SyncCoreAppStateDto) {
    return this.builder.syncCoreAppState(authorization, body)
  }

  @Post('workspace/files-sync')
  @UseGuards(CoreServiceGuard)
  syncWorkspaceFiles(@Body() body: { tenantId: string; workspaceId?: string; coreAppId?: number; runId?: string; files: Array<{ path: string; content: string }> }) {
    return this.builder.syncWorkspaceFiles(body)
  }
}
