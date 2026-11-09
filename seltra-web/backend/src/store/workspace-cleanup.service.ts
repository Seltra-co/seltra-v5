import { Injectable } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { prisma } from '../db'
import { destroyCoreWorkspace } from './workspace-cleanup'

@Injectable()
export class WorkspaceCleanupService {
  private running = false

  @Cron('*/15 * * * * *')
  async retryPendingCleanup() {
    if (this.running) return
    this.running = true
    try {
      const pending = await prisma.workspaceCleanup.findMany({
        where: { nextAttemptAt: { lte: new Date() } },
        orderBy: { nextAttemptAt: 'asc' },
        take: 25,
      })
      for (const cleanup of pending) {
        try {
          await destroyCoreWorkspace(cleanup.workspaceKey, 'cleanup_retry')
          await prisma.workspaceCleanup.delete({ where: { id: cleanup.id } })
        } catch (error) {
          const attempts = cleanup.attempts + 1
          const delayMs = Math.min(60 * 60_000, 5_000 * 2 ** Math.min(attempts, 9))
          const code = error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : 'GATEWAY_DESTROY_FAILED'
          await prisma.workspaceCleanup.update({
            where: { id: cleanup.id },
            data: { attempts, lastErrorCode: code, nextAttemptAt: new Date(Date.now() + delayMs) },
          })
        }
      }
    } catch (error) {
      console.error('[WorkspaceCleanup] Cleanup sweep failed', error instanceof Error ? error.name : 'unknown')
    } finally {
      this.running = false
    }
  }
}
