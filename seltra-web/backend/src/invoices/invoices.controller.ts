import { Body, Controller, Get, Headers, HttpCode, Param, Patch, Post, Query, Res } from '@nestjs/common'
import type { Response } from 'express'
import { InvoicesService } from './invoices.service'

@Controller('invoices')
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get()
  list(
    @Headers('authorization') authorization?: string,
    @Query('tenantId') tenantId?: string,
    @Query('page') page = '1',
    @Query('perPage') perPage = '10',
  ) {
    return this.invoices.list(authorization, tenantId, Number(page) || 1, Number(perPage) || 10)
  }

  @Post()
  create(@Headers('authorization') authorization: string | undefined, @Body() body: Parameters<InvoicesService['create']>[1]) {
    return this.invoices.create(authorization, body)
  }

  @Post(':id/send')
  @HttpCode(200)
  send(@Param('id') id: string, @Headers('authorization') authorization?: string, @Body() body?: { tenantId?: string }) {
    return this.invoices.send(authorization, id, body?.tenantId)
  }

  @Patch(':id/paid')
  markPaid(@Param('id') id: string, @Headers('authorization') authorization?: string, @Body() body?: { tenantId?: string }) {
    return this.invoices.markPaid(authorization, id, body?.tenantId)
  }

  @Get(':id/pdf')
  async document(@Param('id') id: string, @Res() res: Response) {
    const html = await this.invoices.renderDocument(id)
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.send(html)
  }
}
