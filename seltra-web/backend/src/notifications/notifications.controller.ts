import { Controller, Get, Headers, Patch, Query } from '@nestjs/common'
import { NotificationsService } from './notifications.service'

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@Headers('authorization') authorization?: string, @Query('tenantId') tenantId?: string) {
    return this.notifications.list(authorization, tenantId)
  }

  @Patch('read')
  markAllRead(@Headers('authorization') authorization?: string, @Query('tenantId') tenantId?: string) {
    return this.notifications.markAllRead(authorization, tenantId)
  }
}
