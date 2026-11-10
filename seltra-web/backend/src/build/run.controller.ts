import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Post, Query, Sse, UseGuards } from '@nestjs/common'
import { RunService, PersistedRunState } from './run.service'
import { CoreServiceGuard } from '../core-internal/core-service.guard'

@Controller('runs')
export class RunController {
  constructor(private readonly runs: RunService) {}

  @Post('internal/:id/events')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CoreServiceGuard)
  appendInternal(@Param('id') id: string, @Body() body: { type: string; phase?: string; agent?: string; payload?: Record<string, unknown>; state?: PersistedRunState; eventKey?: string }) {
    return this.runs.appendInternal(id, {
      type: body.type,
      phase: body.phase,
      agent: body.agent,
      payload: body.payload ?? {},
      state: body.state,
      eventKey: body.eventKey,
    })
  }

  @Post()
  start(@Body() body: { projectId: string; workspaceId?: string; idempotencyKey?: string }, @Headers('authorization') authorization?: string, @Headers('idempotency-key') headerKey?: string) {
    return this.runs.start(body.projectId, body.workspaceId, authorization, body.idempotencyKey ?? headerKey)
  }

  @Get(':id/snapshot')
  snapshot(@Param('id') id: string, @Headers('authorization') authorization?: string) {
    return this.runs.snapshot(id, authorization)
  }

  @Sse(':id/events')
  events(@Param('id') id: string, @Query('after') after?: string, @Headers('authorization') authorization?: string, @Headers('last-event-id') lastEventId?: string) {
    const fromHeader = Number(lastEventId ?? 0)
    const fromQuery = Number(after ?? 0)
    const sequence = Number.isFinite(fromHeader) && fromHeader > 0 ? fromHeader : (Number.isFinite(fromQuery) ? Math.max(0, fromQuery) : 0)
    return this.runs.stream(id, authorization, sequence)
  }

  @Post(':id/events')
  @HttpCode(HttpStatus.OK)
  append(@Param('id') id: string, @Body() body: { type: string; phase?: string; agent?: string; payload?: Record<string, unknown>; state?: PersistedRunState; eventKey?: string }, @Headers('authorization') authorization?: string) {
    return this.runs.append(id, {
      type: body.type,
      phase: body.phase,
      agent: body.agent,
      payload: body.payload ?? {},
      state: body.state,
      eventKey: body.eventKey,
    }, authorization)
  }

  @Post(':id/stop')
  stop(@Param('id') id: string, @Headers('authorization') authorization?: string) {
    return this.runs.stop(id, authorization)
  }

  @Post(':id/continue')
  continueRun(@Param('id') id: string, @Headers('authorization') authorization?: string) {
    return this.runs.continueRun(id, authorization)
  }

  @Get(':id')
  activeByProject(@Param('id') projectId: string, @Headers('authorization') authorization?: string, @Query('project') project?: string) {
    return this.runs.active(project ? project : projectId, authorization)
  }
}
