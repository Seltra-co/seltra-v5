//seltra-web/backend/src/internal-ops/controllers/applications.controller.ts
import { Body, Controller, Get, Headers, Param, Post, Query, UseFilters, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common'
import { ApiBadRequestResponse, ApiHeader, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam, ApiSecurity, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger'
import { ApplicationsQueryDto } from '../dto/applications-query.dto'
import { RejectApplicationDto } from '../dto/reject-application.dto'
import { ApplicationApprovalResponseDto, ApplicationRejectionResponseDto, ApplicationsListResponseDto, OpsErrorResponseDto } from '../dto/swagger-response.dto'
import { OpsExceptionFilter } from '../filters/ops-exception.filter'
import { OpsApiKeyGuard } from '../guards/ops-api-key.guard'
import { ApplicationsService } from '../services/applications.service'
import { OpsAuditService } from '../services/ops-audit.service'

const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true })

@ApiTags('Internal Ops Applications')
@ApiSecurity('internal-api-key')
@ApiUnauthorizedResponse({ description: 'Missing, invalid, or rate-limited internal API key.', type: OpsErrorResponseDto })
@Controller('internal/ops/applications')
@UseGuards(OpsApiKeyGuard)
@UseFilters(OpsExceptionFilter)
@UsePipes(pipe)
export class ApplicationsController {
  constructor(
    private readonly applications: ApplicationsService,
    private readonly audit: OpsAuditService,
  ) {}

  //Dashboard fetch merchant applications list endpoint for the internal ops API
  //@req GET /internal/ops/applications?status=pending&page=1&pageSize=10
  //x-internal-api-key
  //x-ops-actor
  @Get()
  @ApiOperation({
    summary: 'List merchant applications',
    description: 'Returns paginated merchant applications for internal review, optionally filtered by status and search text.',
  })
  @ApiOkResponse({ description: 'Paginated application list.', type: ApplicationsListResponseDto })
  list(@Query() query: ApplicationsQueryDto) {
    return this.applications.list(query)
  }

  //Dashboard fetch merchant applications pipeline counts endpoint for the internal ops API
  //@req GET /internal/ops/applications/pipeline-counts
  //x-internal-api-key
  //x-ops-actor
  // @Get('pipeline-counts')
  // pipelineCounts() {
  //   return this.applications.pipelineCounts()
  // }

  //Dashboard approve merchant application endpoint for the internal ops API
  //@req POST /internal/ops/applications/:id/approve
  //x-internal-api-key
  //x-ops-actor
  @Post(':id/approve')
  @ApiOperation({
    summary: 'Approve a merchant application',
    description: 'Approves a pending application, creates or updates the merchant user, generates a merchant ID, and attempts to send approval credentials.',
  })
  @ApiParam({ name: 'id', description: 'Merchant application ID.', example: 'clx9app123' })
  @ApiHeader({ name: 'x-ops-actor', description: 'Human-readable ops actor recorded in the audit log.', required: true, example: 'ops@seltra.co' })
  @ApiOkResponse({ description: 'Application approved and credentials workflow attempted.', type: ApplicationApprovalResponseDto })
  @ApiBadRequestResponse({ description: 'Application is not pending or is missing required approval data.', type: OpsErrorResponseDto })
  @ApiNotFoundResponse({ description: 'Application was not found.', type: OpsErrorResponseDto })
  async approve(@Param('id') id: string, @Headers('x-ops-actor') actor?: string) {
    const actorLabel = this.audit.requireActor(actor)
    const result = await this.applications.approve(id)
    await this.audit.record(actorLabel, 'application.approve', 'merchant_application', id, result)
    return result
  }

  //Dashboard reject merchant application endpoint for the internal ops API
  //@req POST /internal/ops/applications/:id/reject
  //x-internal-api-key
  //x-ops-actor
  @Post(':id/reject')
  @ApiOperation({
    summary: 'Reject a merchant application',
    description: 'Marks an application as rejected and stores the supplied review reason.',
  })
  @ApiParam({ name: 'id', description: 'Merchant application ID.', example: 'clx9app123' })
  @ApiHeader({ name: 'x-ops-actor', description: 'Human-readable ops actor recorded in the audit log.', required: true, example: 'ops@seltra.co' })
  @ApiOkResponse({ description: 'Application rejected.', type: ApplicationRejectionResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid rejection reason or missing actor header.', type: OpsErrorResponseDto })
  @ApiNotFoundResponse({ description: 'Application was not found.', type: OpsErrorResponseDto })
  async reject(
    @Param('id') id: string,
    @Body() body: RejectApplicationDto,
    @Headers('x-ops-actor') actor?: string,
  ) {
    const actorLabel = this.audit.requireActor(actor)
    const result = await this.applications.reject(id, body.reason)
    await this.audit.record(actorLabel, 'application.reject', 'merchant_application', id, { reason: body.reason })
    return result
  }
}
