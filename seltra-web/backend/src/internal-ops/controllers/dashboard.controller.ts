//seltra-web/backend/src/internal-ops/controllers/dashboard.controller.ts
import { Controller, Get, Query, UseFilters, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common'
import { ApiExtraModels, ApiOkResponse, ApiOperation, ApiSecurity, ApiTags, ApiUnauthorizedResponse, getSchemaPath } from '@nestjs/swagger'
import { DaysDto, LimitDto } from '../dto/pagination.dto'
import { TopMerchantsQueryDto } from '../dto/merchants-query.dto'
import {
  ActivitySeriesPointDto,
  DashboardFootprintResponseDto,
  DashboardOverviewResponseDto,
  EmptyMessageResponseDto,
  GmvSeriesPointDto,
  HealthResponseDto,
  OpsErrorResponseDto,
  RecentEventDto,
  RecentMerchantApplicationDto,
  SystemStatusResponseDto,
  TopMerchantsResponseDto,
} from '../dto/swagger-response.dto'
import { OpsExceptionFilter } from '../filters/ops-exception.filter'
import { OpsApiKeyGuard } from '../guards/ops-api-key.guard'
import { DashboardService } from '../services/dashboard.service'

const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true })

@ApiTags('Internal Ops Dashboard')
@ApiSecurity('internal-api-key')
@ApiUnauthorizedResponse({ description: 'Missing, invalid, or rate-limited internal API key.', type: OpsErrorResponseDto })
@ApiExtraModels(RecentEventDto, RecentMerchantApplicationDto, EmptyMessageResponseDto)
@Controller('internal/ops')
@UseGuards(OpsApiKeyGuard)
@UseFilters(OpsExceptionFilter)
@UsePipes(pipe)
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  //Health check endpoint for the internal ops API
  //@req GET /internal/ops/health
  @Get('health')
  @ApiOperation({ summary: 'Check internal ops API health' })
  @ApiOkResponse({ description: 'Internal ops API is reachable.', type: HealthResponseDto })
  health() {
    return { ok: true, service: 'seltra-merchant-backend', time: new Date().toISOString() }
  }

  //Dashboard overview endpoint for the internal ops API
  //@req GET /internal/ops/dashboard/overview
  //x-internal-api-key
  //x-ops-actor
  @Get('dashboard/overview')
  @ApiOperation({ summary: 'Get dashboard overview metrics' })
  @ApiOkResponse({ description: 'High-level commerce, merchant, and AI activity counters.', type: DashboardOverviewResponseDto })
  overview() {
    return this.dashboard.overview()
  }

  //Dashboard footprint endpoint for the internal ops API
  //@req GET /internal/ops/dashboard/footprint
  //x-internal-api-key
  //x-ops-actor
  @Get('dashboard/footprint')
  @ApiOperation({ summary: 'Get merchant geographic footprint' })
  @ApiOkResponse({ description: 'Merchant counts grouped by normalized country and city.', type: DashboardFootprintResponseDto })
  footprint() {
    return this.dashboard.footprint()
  }

  //Dashboard GMV series endpoint for the internal ops API
  //@req GET /internal/ops/dashboard/gmv-series?days=30
  //x-internal-api-key
  //x-ops-actor
  @Get('dashboard/gmv-series')
  @ApiOperation({ summary: 'Get GMV time series' })
  @ApiOkResponse({ description: 'Daily GMV and paid-order counts for the requested window.', type: [GmvSeriesPointDto] })
  gmvSeries(@Query() query: DaysDto) {
    return this.dashboard.gmvSeries(query.days)
  }

  //Dashboard activity series endpoint for the internal ops API
  //@req GET /internal/ops/dashboard/activity-series?days=30
  //x-internal-api-key
  //x-ops-actor
  @Get('dashboard/activity-series')
  @ApiOperation({ summary: 'Get platform activity time series' })
  @ApiOkResponse({ description: 'Daily tenant event counts for the requested window.', type: [ActivitySeriesPointDto] })
  activitySeries(@Query() query: DaysDto) {
    return this.dashboard.activitySeries(query.days)
  }

  //Dashboard top merchants endpoint for the internal ops API
  //@req GET /internal/ops/dashboard/top-merchants?limit=5&days=30
  //x-internal-api-key
  //x-ops-actor
  @Get('dashboard/top-merchants')
  @ApiOperation({ summary: 'Get top merchants by GMV' })
  @ApiOkResponse({ description: 'Top merchants ranked by paid order GMV.', type: TopMerchantsResponseDto })
  topMerchants(@Query() query: TopMerchantsQueryDto) {
    return this.dashboard.topMerchants(query)
  }

  //Dashboard recent events endpoint for the internal ops API
  //@req GET /internal/ops/dashboard/recent-events?limit=10
  //x-internal-api-key
  //x-ops-actor
  @Get('dashboard/recent-events')
  @ApiOperation({ summary: 'Get recent merchant events' })
  @ApiOkResponse({
    description: 'Recent tenant events, or an empty-state message when no events exist.',
    schema: {
      oneOf: [
        { type: 'array', items: { $ref: getSchemaPath(RecentEventDto) } },
        { $ref: getSchemaPath(EmptyMessageResponseDto) },
      ],
    },
  })
  recentEvents(@Query() query: LimitDto) {
    return this.dashboard.recentEvents(query.limit)
  }

  //Dashboard system status endpoint for the internal ops API
  //@req GET /internal/ops/dashboard/system-status
  //x-internal-api-key
  //x-ops-actor
  @Get('dashboard/system-status')
  @ApiOperation({ summary: 'Get internal system status' })
  @ApiOkResponse({ description: 'Health status for API, agent, storefront, payments, and database checks.', type: SystemStatusResponseDto })
  systemStatus() {
    return this.dashboard.systemStatus()
  }

  //Dashboard recent merchant applications endpoint for the internal ops API
  //@req GET /internal/ops/dashboard/recent-merchant-applications?limit=10
  //x-internal-api-key
  //x-ops-actor
  @Get('dashboard/recent-merchant-applications')
  @ApiOperation({ summary: 'Get recent merchant applications' })
  @ApiOkResponse({
    description: 'Recent merchant applications, or an empty-state message when none exist.',
    schema: {
      oneOf: [
        { type: 'array', items: { $ref: getSchemaPath(RecentMerchantApplicationDto) } },
        { $ref: getSchemaPath(EmptyMessageResponseDto) },
      ],
    },
  })
  recentMerchantApplications(@Query() query: LimitDto) {
    return this.dashboard.recentMerchantApplications(query.limit)
  }
  
}
