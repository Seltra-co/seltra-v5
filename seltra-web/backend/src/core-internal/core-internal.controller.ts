import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common'
import { IsBoolean, IsInt, IsString, IsOptional, Min } from 'class-validator'
import { ApiExcludeController } from '@nestjs/swagger'
import { BuilderService } from '../builder/builder.service'
import { CoreServiceGuard } from './core-service.guard'

class CoreUsageDto {
  @IsString() tenantId!: string
  @IsString() workspaceId!: string
  @IsString() userId!: string
  @IsString() role!: string
  @IsString() model!: string
  @IsOptional() @IsInt() @Min(0) tokens?: number
  @IsOptional() @IsInt() @Min(0) tokensIn?: number
  @IsOptional() @IsInt() @Min(0) tokensOut?: number
  @IsBoolean() cached!: boolean
  @IsBoolean() ok!: boolean
  @IsString() runId!: string
}

class WsTicketDto {
  @IsString() ticket!: string
}

@ApiExcludeController()
@UseGuards(CoreServiceGuard)
@Controller('internal/core')
export class CoreInternalController {
  constructor(private readonly builder: BuilderService) {}

  @Get('entitlement/:tenantId')
  entitlement(@Param('tenantId') tenantId: string) {
    return this.builder.entitlement(tenantId)
  }

  @Post('usage')
  usage(@Body() body: CoreUsageDto) {
    return this.builder.reportUsage(body)
  }

  @Post('ws-ticket/redeem')
  redeemWsTicket(@Body() body: WsTicketDto) {
    return this.builder.redeemWsTicket(body.ticket)
  }
}
