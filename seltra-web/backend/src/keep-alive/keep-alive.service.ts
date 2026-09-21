//keep-alive/keep-alive.service.ts
import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'

@Injectable()
export class KeepAliveService {
  private readonly logger = new Logger(KeepAliveService.name)

  /**
   * Render free tier spins down after 15 minutes of inactivity.
   * We self-ping every 14 minutes so the server never hits that threshold.
   *
   * UptimeRobot monitors /health from outside every 5 minutes —
   * this internal cron is a belt-and-suspenders backup for gaps between pings.
   */
  @Cron('0 */14 * * * *') // every 14 minutes
  async keepAlive() {
    const baseUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${process.env.PORT || 8000}`
    const url = `${baseUrl}/api/v1/health`

    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 8000) // 8s timeout

      const res = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        headers: { 'x-ping-source': 'seltra-keep-alive' },
      })

      clearTimeout(timeoutId)

      if (res.ok) {
        this.logger.log(`[KeepAlive] ✓ Server is awake — ${url} responded ${res.status}`)
      } else {
        this.logger.warn(`[KeepAlive] ⚠ Unexpected status ${res.status} from ${url}`)
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      this.logger.error(`[KeepAlive] ✗ Ping failed: ${message}`)
    }
  }
}
