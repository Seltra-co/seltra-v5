import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

export type WorkspaceSyncFile = { path: string; content: string }

const IGNORED_DIRECTORY_NAMES = new Set(['.git', '.next', 'dist', 'node_modules', 'build', 'logs', 'out', 'temp', 'tmp', 'userdata'])

export async function readWorkspaceApps(
  appsRoot: string,
  isAllowed: (relativePath: string) => boolean,
): Promise<WorkspaceSyncFile[]> {
  const files: WorkspaceSyncFile[] = []
  const walk = async (directory: string, relative = ''): Promise<void> => {
    let entries: Array<import('node:fs').Dirent>
    try {
      entries = await fs.readdir(directory, { withFileTypes: true })
    } catch (error) {
      if (directory === appsRoot && (error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink() || IGNORED_DIRECTORY_NAMES.has(entry.name.toLowerCase())) continue
      if ((entry.name.startsWith('.') && entry.name !== '.dyad') || files.length >= 2000) continue
      const absolute = path.join(directory, entry.name)
      const relativePath = path.join(relative, entry.name).replaceAll('\\', '/')
      if (!isAllowed(relativePath)) continue
      if (entry.isDirectory()) {
        await walk(absolute, relativePath)
      } else if (entry.isFile()) {
        const stat = await fs.stat(absolute)
        if (stat.size > 10 * 1024 * 1024) throw Object.assign(new Error('Workspace file exceeds the sync limit.'), { code: 'file_exceeds_sync_limit' })
        if (isRasterImagePath(relativePath)) {
          if (stat.size > 6 * 1024 * 1024) throw Object.assign(new Error('Workspace image exceeds the sync limit.'), { code: 'image_exceeds_sync_limit' })
          files.push({ path: relativePath, content: `base64:${(await fs.readFile(absolute)).toString('base64')}` })
        } else {
          files.push({ path: relativePath, content: await fs.readFile(absolute, 'utf8') })
        }
      }
    }
  }
  await walk(appsRoot, 'apps')
  return files
}

function isRasterImagePath(relativePath: string): boolean {
  return /\.(?:png|jpe?g|webp|gif|avif)$/i.test(relativePath)
}

export function workspaceFileListHash(files: WorkspaceSyncFile[]): string {
  const rows = files.map(({ path: filePath, content }) => {
    const bytes = content.startsWith('base64:') ? Buffer.from(content.slice(7), 'base64') : Buffer.from(content, 'utf8')
    return `${filePath.replaceAll('\\', '/')}:${createHash('sha256').update(bytes).digest('hex')}`
  }).sort()
  return createHash('sha256').update(rows.join('\n')).digest('hex')
}

export type WorkspaceSyncResult = { filesCount: number; unchanged: boolean; verified: boolean; durationMs: number; syncFromExecutionMs: number }

/** Serializes sync requests and caches only manifests whose backend verification passed. */
export class WorkspaceSyncState {
  private lastSuccessfulHash?: string
  private active?: Promise<WorkspaceSyncResult>

  async synchronize(input: {
    appsRoot: string
    syncFromExecution?: (scope: 'apps') => Promise<void>
    isAllowed: (relativePath: string) => boolean
    syncBackend: (files: WorkspaceSyncFile[]) => Promise<{ verified: boolean }>
    onFailure: (reasonCode: string, error?: unknown) => void
    onSuccess?: (result: WorkspaceSyncResult) => void
  }): Promise<WorkspaceSyncResult> {
    if (this.active) return this.active
    const operation = this.perform(input)
    this.active = operation
    try {
      return await operation
    } finally {
      if (this.active === operation) this.active = undefined
    }
  }

  private async perform(input: Parameters<WorkspaceSyncState['synchronize']>[0]): Promise<WorkspaceSyncResult> {
    const startedAt = Date.now()
    const executionSyncStartedAt = performance.now()
    try {
      await input.syncFromExecution?.('apps')
    } catch (error) {
      input.onFailure('container_sync_failed', error)
      throw Object.assign(new Error('Container workspace sync failed.'), { code: 'container_sync_failed' })
    }
    const syncFromExecutionMs = Math.round((performance.now() - executionSyncStartedAt) * 100) / 100

    let files: WorkspaceSyncFile[]
    try {
      files = await readWorkspaceApps(input.appsRoot, input.isAllowed)
    } catch (error) {
      const reason = typeof (error as NodeJS.ErrnoException)?.code === 'string' ? (error as NodeJS.ErrnoException).code!.toLowerCase() : 'filesystem_error'
      input.onFailure(reason === 'file_exceeds_sync_limit' || reason === 'image_exceeds_sync_limit' ? reason : 'workspace_scan_failed', error)
      throw Object.assign(new Error('Workspace files could not be scanned.'), { code: 'workspace_scan_failed' })
    }

    const hash = workspaceFileListHash(files)
    if (hash === this.lastSuccessfulHash) {
      const result = { filesCount: files.length, unchanged: true, verified: true, durationMs: Date.now() - startedAt, syncFromExecutionMs }
      input.onSuccess?.(result)
      return result
    }

    try {
      const backend = await input.syncBackend(files)
      const result = { filesCount: files.length, unchanged: false, verified: backend.verified, durationMs: Date.now() - startedAt, syncFromExecutionMs }
      if (backend.verified) this.lastSuccessfulHash = hash
      input.onSuccess?.(result)
      return result
    } catch (error) {
      const reason = typeof (error as { code?: unknown })?.code === 'string' ? (error as { code: string }).code : 'backend_sync_failed'
      input.onFailure(reason, error)
      throw Object.assign(new Error('Backend workspace sync failed.'), { code: 'backend_sync_failed' })
    }
  }
}
