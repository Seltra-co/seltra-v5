//apps/api/src/health/health.controller.ts
import { Controller, Get, ServiceUnavailableException } from '@nestjs/common'
import { prisma } from '../db'

@Controller('health')
export class HealthController {
  @Get()
  check() {
    return {
      success: true,
      status: 'ok',
      service: 'seltra-api',
      timestamp: new Date().toISOString(),
      uptime: Math.floor(process.uptime()),
      environment: process.env.NODE_ENV || 'development',
    }
  }

  @Get('ready')
  async readiness() {
    try {
      await prisma.$queryRaw`SELECT 1`
      return {
        success: true,
        status: 'ready',
        service: 'seltra-api',
        dependencies: { database: 'ok' },
        timestamp: new Date().toISOString(),
      }
    } catch {
      throw new ServiceUnavailableException({
        success: false,
        status: 'not_ready',
        service: 'seltra-api',
        dependencies: { database: 'unavailable' },
      })
    }
  }
}
