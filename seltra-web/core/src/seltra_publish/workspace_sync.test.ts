import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { WorkspaceSyncState } from '../../server/src/workspace_sync.js'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe('gateway workspace apps sync', () => {
  it('syncs container-only app files once and skips an unchanged tick', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'seltra-workspace-sync-'))
    temporaryRoots.push(root)
    const containerApps = path.join(root, 'container', 'apps')
    const hostApps = path.join(root, 'host', 'apps')
    const containerFiles = Array.from({ length: 13 }, (_, index) => ({
      path: path.join('catalog', 'src', `file-${index}.tsx`),
      content: `export default function App${index}() { return null }`,
    }))
    for (const file of containerFiles) {
      const containerFile = path.join(containerApps, file.path)
      await fs.mkdir(path.dirname(containerFile), { recursive: true })
      await fs.writeFile(containerFile, file.content)
    }
    for (const ignored of ['node_modules', '.next', 'dist', '.git']) {
      const ignoredFile = path.join(containerApps, 'catalog', ignored, 'ignored.txt')
      await fs.mkdir(path.dirname(ignoredFile), { recursive: true })
      await fs.writeFile(ignoredFile, 'ignored')
    }

    const syncFromExecution = vi.fn(async (scope: 'apps') => {
      const startedAt = performance.now()
      expect(scope).toBe('apps')
      for (const file of containerFiles) {
        const containerFile = path.join(containerApps, file.path)
        const hostFile = path.join(hostApps, file.path)
        await fs.mkdir(path.dirname(hostFile), { recursive: true })
        await fs.copyFile(containerFile, hostFile)
      }
      if (process.env.REPORT_WORKSPACE_SYNC_TIMING === '1') {
        console.info(JSON.stringify({ event: 'fake_container_sync_timing', filesCount: containerFiles.length, durationMs: Math.round((performance.now() - startedAt) * 100) / 100 }))
      }
    })
    const syncBackend = vi.fn(async (files: Array<{ path: string; content: string }>) => {
      expect(files).toHaveLength(13)
      expect(files.map((file) => file.path).sort()).toEqual(containerFiles.map((file) => path.join('apps', file.path).replaceAll('\\', '/')).sort())
      return { verified: true }
    })
    const onFailure = vi.fn()
    const state = new WorkspaceSyncState()
    const input = {
      appsRoot: hostApps,
      syncFromExecution,
      isAllowed: () => true,
      syncBackend,
      onFailure,
    }

    const first = await state.synchronize(input)
    const second = await state.synchronize(input)

    expect(first).toMatchObject({ filesCount: 13, unchanged: false, verified: true })
    expect(second).toMatchObject({ filesCount: 13, unchanged: true, verified: true })
    expect(syncFromExecution).toHaveBeenCalledTimes(2)
    expect(syncBackend).toHaveBeenCalledTimes(1)
    expect(onFailure).not.toHaveBeenCalled()
  })
})
