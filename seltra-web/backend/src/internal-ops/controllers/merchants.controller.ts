//seltra-web/backend/src/internal-ops/controllers/merchants.controller.ts
import { Body, Controller, Delete, Get, Header, Headers, Param, Patch, Query, Res, UseFilters, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common'
import { ApiBadRequestResponse, ApiConsumes, ApiHeader, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam, ApiProduces, ApiSecurity, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger'
import type { Response } from 'express'
import { MerchantPatchDto } from '../dto/merchant-patch.dto'
import { MerchantsQueryDto } from '../dto/merchants-query.dto'
import { MerchantDetailResponseDto, MerchantRemovalResponseDto, MerchantsListResponseDto, OpsErrorResponseDto } from '../dto/swagger-response.dto'
import { MerchantMessagingResponseDto,MerchantsMessagingListResponseDto } from '../dto/merchants-messaging-response.dto'
import { OpsExceptionFilter } from '../filters/ops-exception.filter'
import { OpsApiKeyGuard } from '../guards/ops-api-key.guard'
import { MerchantsService } from '../services/merchants.service'
import { OpsAuditService } from '../services/ops-audit.service'

const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true })

@ApiTags('Internal Ops Merchants')
@ApiSecurity('internal-api-key')
@ApiUnauthorizedResponse({ description: 'Missing, invalid, or rate-limited internal API key.', type: OpsErrorResponseDto })
@Controller('internal/ops/merchants')
@UseGuards(OpsApiKeyGuard)
@UseFilters(OpsExceptionFilter)
@UsePipes(pipe)
export class MerchantsController {
  constructor(
    private readonly merchants: MerchantsService,
    private readonly audit: OpsAuditService,
  ) {}

  //Dashboard fetch merchants stores list endpoint for the internal ops API
  //@req GET /internal/ops/merchants 
  //x-internal-api-key
  //x-ops-actor
  @Get()
  @ApiOperation({
    summary: 'List merchant stores',
    description: 'Returns paginated merchant store rows with GMV, order count, and activity metadata.',
  })
  @ApiOkResponse({ description: 'Paginated merchant list.', type: MerchantsListResponseDto })
  list(@Query() query: MerchantsQueryDto) {
    return this.merchants.list(query)
  }


//Dashboard fetch merchants for bulk messaging (email, sms) endpoint for the internal ops API
//@req GET /internal/ops/merchants/messaging
//x-internal-api-key
//x-ops-actor
@Get('messaging')
@ApiOperation({
  summary: 'List merchants for messaging',
  description: 'Returns merchant applications (approved or pending) with contact details for bulk email/SMS messaging.',
})
@ApiOkResponse({
  description: 'Fetched merchants for messaging successfully.',
  type: MerchantsMessagingListResponseDto,
})
messaging() {
  return this.merchants.messaging()
}

//Dashboard fetch a merchant for single messaging (email, sms) endpoint for the internal ops API
//@req GET /internal/ops/merchants/:merchantId/messaging
//x-internal-api-key
//x-ops-actor
@Get(':merchantId/messaging')
@ApiOperation({
  summary: 'Fetch a single merchant for messaging',
  description: 'Returns a single merchant application with contact details for single-recipient email/SMS messaging.',
})
@ApiParam({
  name: 'merchantId',
  description: 'MerchantApplication ID (not a tenant ID).',
  example: 'b7cf0dc7-7757-4a07-8a5e-c06d0193dc10',
})
@ApiOkResponse({
  description: 'Merchant contact details for messaging.',
  type: MerchantMessagingResponseDto,
})
@ApiNotFoundResponse({
  description: 'Merchant application was not found.',
  type: OpsErrorResponseDto,
})
singleMessaging(@Param('merchantId') merchantId: string) {
  return this.merchants.singleMessaging(merchantId)
}


  //Dashboard export csv  endpoint
  //@req GET /internal/ops/merchants/export.csv
  //x-internal-api-key
  //x-ops-actor
  @Get('export.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @ApiOperation({
    summary: 'Export merchant stores as CSV',
    description: 'Exports filtered merchant rows. The export is capped at 5,000 rows.',
  })
  @ApiProduces('text/csv')
  @ApiOkResponse({
    description: 'CSV file containing merchant rows.',
    content: {
      'text/csv': {
        schema: {
          type: 'string',
          example: 'store,slug,owner_name,owner_email,type,status,gmv,orders,last_active,joined\nGlow Circle Beauty,glow-circle-beauty,Ama Mensah,ama@example.com,Beauty,active,1200.00,42,today,2026-07-09T12:34:56.000Z',
        },
      },
    },
  })
  @ApiBadRequestResponse({ description: 'Export filters are invalid or the export cap was exceeded.', type: OpsErrorResponseDto })
  async exportCsv(
    @Query() query: MerchantsQueryDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const csv = await this.merchants.exportCsv(query)

    response.setHeader(
      'Content-Disposition',
      'attachment; filename="merchants.csv"',
    )

    return csv
  }

  //Dashboard fetch merchant store detail endpoint for the internal ops API
  //@req GET /internal/ops/merchants/:tenantId
  //x-internal-api-key
  //x-ops-actor
  @Get(':tenantId')
  @ApiOperation({ summary: 'Get merchant store detail' })
  @ApiParam({ name: 'tenantId', description: 'Tenant ID for the merchant store.', example: 'clx9tenant123' })
  @ApiOkResponse({ description: 'Merchant store detail.', type: MerchantDetailResponseDto })
  @ApiNotFoundResponse({ description: 'Tenant was not found or has been removed.', type: OpsErrorResponseDto })
  detail(@Param('tenantId') tenantId: string) {
    return this.merchants.detail(tenantId)
  }

  //Dashboard update merchant store endpoint for the internal ops API
  //@req PATCH /internal/ops/merchants/:tenantId
  //x-internal-api-key
  //x-ops-actor
  @Patch(':tenantId')
  @ApiOperation({
    summary: 'Update merchant store',
    description: 'Updates merchant store metadata and records the change in the ops audit log.',
  })
  @ApiParam({ name: 'tenantId', description: 'Tenant ID for the merchant store.', example: 'clx9tenant123' })
  @ApiHeader({ name: 'x-ops-actor', description: 'Human-readable ops actor recorded in the audit log.', required: true, example: 'ops@seltra.co' })
  @ApiConsumes('application/json')
  @ApiOkResponse({ description: 'Updated merchant store detail.', type: MerchantDetailResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid patch body or missing actor header.', type: OpsErrorResponseDto })
  @ApiNotFoundResponse({ description: 'Tenant was not found.', type: OpsErrorResponseDto })
  async update(
    @Param('tenantId') tenantId: string,
    @Body() body: MerchantPatchDto,
    @Headers('x-ops-actor') actor?: string,
  ) {
    const actorLabel = this.audit.requireActor(actor)
    const result = await this.merchants.update(tenantId, body)
    await this.audit.record(actorLabel, 'merchant.update', 'tenant', tenantId, body)
    return result
  }

  //Dashboard remove merchant store endpoint for the internal ops API
  //@req DELETE /internal/ops/merchants/:tenantId
  //x-internal-api-key
  //x-ops-actor
  @Delete(':tenantId')
  @ApiOperation({
    summary: 'Remove merchant store',
    description: 'Soft-removes a merchant store by setting its tenant status to removed and records the action in the ops audit log.',
  })
  @ApiParam({ name: 'tenantId', description: 'Tenant ID for the merchant store.', example: 'clx9tenant123' })
  @ApiHeader({ name: 'x-ops-actor', description: 'Human-readable ops actor recorded in the audit log.', required: true, example: 'ops@seltra.co' })
  @ApiOkResponse({ description: 'Merchant store removed.', type: MerchantRemovalResponseDto })
  @ApiBadRequestResponse({ description: 'Missing actor header.', type: OpsErrorResponseDto })
  @ApiNotFoundResponse({ description: 'Tenant was not found.', type: OpsErrorResponseDto })
  async remove(@Param('tenantId') tenantId: string, @Headers('x-ops-actor') actor?: string) {
    const actorLabel = this.audit.requireActor(actor)
    const result = await this.merchants.remove(tenantId)
    await this.audit.record(actorLabel, 'merchant.remove', 'tenant', tenantId, { status: 'removed' })
    return result
  }
 
  
}
