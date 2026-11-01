import { Controller, Get, Headers, Param } from '@nestjs/common'
import { RunService } from './run.service'

@Controller('projects')
export class ProjectController {
  constructor(private readonly runs: RunService) {}

  @Get(':id/active-run')
  active(@Param('id') id: string, @Headers('authorization') authorization?: string) {
    return this.runs.active(id, authorization)
  }

  @Get(':id/files')
  files(@Param('id') id: string, @Headers('authorization') authorization?: string) {
    return this.runs.files(id, authorization)
  }

  @Get(':id/snapshots')
  snapshots(@Param('id') id: string, @Headers('authorization') authorization?: string) {
    return this.runs.snapshots(id, authorization)
  }

  @Get(':id/restore')
  restore(@Param('id') id: string, @Headers('authorization') authorization?: string) {
    return this.runs.restore(id, authorization)
  }
}
