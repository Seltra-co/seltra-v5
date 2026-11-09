import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { CloudflareSandboxProvider } from '../../server/src/execution_provider'
import { WorkspaceSupervisor } from '../../server/src/workspace_supervisor'

const workspaceKey = '0123456789abcdef'
const projectId = 'project-1'

describe('lazy Cloudflare workspace creation', () => {
  it('boot health checks are read-only and restart creates only after the next user action', async () => {
    const requests: string[] = []
    let containerStarts = 0
    let containerRunning = false
    const provider = new CloudflareSandboxProvider({
      SANDBOX_GATEWAY_URL: 'https://gateway.test',
      SANDBOX_GATEWAY_SIGNING_SECRET: 'test-signing-secret-that-is-long-enough',
    }, async (input, init) => {
      const url = new URL(String(input))
      requests.push(`${init?.method ?? 'GET'} ${url.pathname}`)
      if (url.pathname === '/healthz') return Response.json({ ok: true })
      if (url.pathname.endsWith('/create')) {
        if (!containerRunning) containerStarts++
        containerRunning = true
        return Response.json({ sandboxId: 'one-instance', ready: true })
      }
      throw new Error(`Unexpected gateway request ${url.pathname}`)
    })
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'seltra-lazy-workspace-'))
    const root = path.resolve(process.cwd())
    const createSupervisor = () => new WorkspaceSupervisor({
      root,
      dataRoot,
      maxActive: 10,
      idleMs: 60 * 60 * 1000,
      publicApiUrl: 'http://localhost:3000',
      env: { CORE_SERVICE_SECRET: 'test-core-service-secret', CORE_PUBLIC_URL: 'https://core.test', GATEWAY_PORT: '8080' },
      executionProvider: provider,
    })

    try {
      const firstCore = createSupervisor()
      await firstCore.assertExecutionReady()
      expect(requests).toEqual(['GET /healthz'])
      expect(firstCore.getExisting(projectId, workspaceKey, 'user-1', 'store')).toBeNull()

      const firstRuntime = await firstCore.get(projectId, workspaceKey, 'store', 'user-1', 'engine-key', 'user_send', undefined, 'user_send')
      expect(firstRuntime.workspaceId).toBe(projectId)
      expect(containerStarts).toBe(1)
      await firstCore.close()

      const restartedCore = createSupervisor()
      await restartedCore.assertExecutionReady()
      expect(requests.filter((request) => request.endsWith('/create'))).toHaveLength(1)
      expect(restartedCore.getExisting(projectId, workspaceKey, 'user-1', 'store')).toBeNull()

      const restoredRuntime = await restartedCore.get(projectId, workspaceKey, 'store', 'user-1', 'engine-key', 'user_approve', undefined, 'user_approve')
      expect(restoredRuntime.workspaceId).toBe(projectId)
      expect(requests.filter((request) => request.endsWith('/create'))).toHaveLength(2)
      expect(containerStarts).toBe(1)
      await restartedCore.close()
    } finally {
      await rm(dataRoot, { recursive: true, force: true })
    }
  })
})
