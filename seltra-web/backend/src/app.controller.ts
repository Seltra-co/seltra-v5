import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { prisma } from './db'

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getServerInfo(): any {
    return this.appService.getServerInfo();
  }

  @Get('public/metrics')
  async getPublicMetrics() {
    return { merchants: await prisma.merchantApplication.count({ where: { status: 'approved' } }) }
  }
}
