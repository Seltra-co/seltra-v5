import { createHmac, randomBytes } from 'node:crypto'
import { spawnSync, type ChildProcess } from 'node:child_process'
import fs from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'
import { filterChildEnvironment } from './security.js'
import { createWorkspaceExecutionProvider, type ExecutionRequest, type WorkspaceExecutionProvider } from './execution_provider.js'
import { seltraEngineModelBaseUrl } from './model_gateway_url.js'

export type WorkspaceRuntime = {
  workspaceId: string
  workspaceKey: string
  storeSlug: string
  userId: string
  baseUrl: string
  rpcSecret: string
  runtimeSecretsKey: string
  modelToken: string
  signGatewayRequest?: (method: string, path: string) => Record<string, string>
  syncFromExecution?: () => Promise<void>
  child: ChildProcess
  executionName: string
  traceId?: string
  touchedAt: number
}

type Options = {
  root: string
  dataRoot: string
  maxActive: number
  idleMs: number
  publicApiUrl: string
  env: NodeJS.ProcessEnv
  executionProvider?: WorkspaceExecutionProvider
  restoreBeforeStart?: (workspaceKey: string, workspaceRoot: string) => Promise<string | undefined>
  persistBeforeIdleStop?: (runtime: WorkspaceRuntime) => Promise<boolean>
  onWorkspaceCleanupPending?: (workspaceId: string, workspaceKey: string) => Promise<void>
}

const RUNTIME_STARTUP_TIMEOUT_MS = 120_000

function terminateTree(child: ChildProcess) {
  if (child.exitCode !== null || !child.pid) return
  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
    return
  }
  try { process.kill(-child.pid, 'SIGTERM') } catch { child.kill('SIGTERM') }
}

function reservePort() {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') return reject(new Error('Could not reserve a runtime port.'))
      server.close((error) => error ? reject(error) : resolve(address.port))
    })
  })
}

async function waitForRuntime(port: number, child: ChildProcess) {
  const deadline = Date.now() + RUNTIME_STARTUP_TIMEOUT_MS
  let spawnError: Error | undefined
  const onError = (error: Error) => { spawnError = error }
  child.once('error', onError)
  try {
    while (Date.now() < deadline) {
      if (spawnError) throw new Error(`Workspace runtime could not be started: ${spawnError.message}`)
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error(`Workspace runtime exited during startup (code ${child.exitCode ?? 'none'}, signal ${child.signalCode ?? 'none'}).`)
      }
      try {
        await new Promise<void>((resolve, reject) => {
          const socket = net.createConnection(port, '127.0.0.1')
          socket.once('connect', () => { socket.end(); resolve() })
          socket.once('error', reject)
        })
        return
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 200))
      }
    }
    throw new Error('Workspace runtime did not become ready within 120 seconds.')
  } finally {
    child.off('error', onError)
  }
}

async function getOrCreateSecretsKey(filename: string, restoredKey?: string) {
  if (restoredKey && !/^[a-f0-9]{64}$/i.test(restoredKey)) throw new Error('Restored workspace secret key has an invalid format.')
  if (restoredKey) {
    await fs.mkdir(path.dirname(filename), { recursive: true, mode: 0o700 })
    await fs.writeFile(filename, restoredKey, { mode: 0o600 })
    return restoredKey
  }
  try { return (await fs.readFile(filename, 'utf8')).trim() } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const key = randomBytes(32).toString('hex')
  await fs.mkdir(path.dirname(filename), { recursive: true, mode: 0o700 })
  await fs.writeFile(filename, key, { flag: 'wx', mode: 0o600 }).catch(async (error) => {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  })
  return (await fs.readFile(filename, 'utf8')).trim()
}

export class WorkspaceSupervisor {
  private readonly runtimes = new Map<string, WorkspaceRuntime>()
  private readonly starts = new Map<string, Promise<WorkspaceRuntime>>()
  private readonly startsByWorkspaceKey = new Map<string, Promise<WorkspaceRuntime>>()
  private readonly destroyingWorkspaceKeys = new Map<string, number>()
  private readonly timer: NodeJS.Timeout
  private readonly executionProvider: WorkspaceExecutionProvider

  constructor(private readonly options: Options) {
    this.executionProvider = options.executionProvider ?? createWorkspaceExecutionProvider(options.env)
    this.timer = setInterval(() => void this.collectIdle(), 60_000)
    this.timer.unref()
  }

  async get(workspaceId: string, workspaceKey: string, storeSlug: string, userId: string, engineApiKey: string, caller = 'unknown', traceId?: string, intent: ExecutionRequest['intent'] = 'user_send') {
    const destroyUntil = this.destroyingWorkspaceKeys.get(workspaceKey)
    if (destroyUntil && destroyUntil > Date.now()) throw Object.assign(new Error('Workspace is being deleted.'), { code: 'WORKSPACE_DESTROYED', status: 410 })
    if (destroyUntil) this.destroyingWorkspaceKeys.delete(workspaceKey)
    const active = this.runtimes.get(workspaceId)
    if (active && active.child.exitCode === null) {
      if (active.workspaceKey !== workspaceKey) throw Object.assign(new Error('Workspace key does not match the active runtime.'), { code: 'WORKSPACE_KEY_MISMATCH', status: 403 })
      if (active.storeSlug !== storeSlug) throw Object.assign(new Error('Store slug changed. Restart the workspace runtime before continuing.'), { code: 'STORE_SLUG_MISMATCH', status: 409 })
      if (active.userId !== userId) throw Object.assign(new Error('Workspace owner changed. Restart the workspace runtime before continuing.'), { code: 'WORKSPACE_OWNER_MISMATCH', status: 403 })
      active.touchedAt = Date.now(); return active
    }
    const pending = this.starts.get(workspaceId)
    if (pending) return pending
    const pendingByWorkspace = this.startsByWorkspaceKey.get(workspaceKey)
    if (pendingByWorkspace) {
      const runtime = await pendingByWorkspace
      if (runtime.storeSlug !== storeSlug) throw Object.assign(new Error('Store slug changed. Restart the workspace runtime before continuing.'), { code: 'STORE_SLUG_MISMATCH', status: 409 })
      if (runtime.userId !== userId) throw Object.assign(new Error('Workspace owner changed. Restart the workspace runtime before continuing.'), { code: 'WORKSPACE_OWNER_MISMATCH', status: 403 })
      this.runtimes.set(workspaceId, runtime)
      return runtime
    }
    console.info(JSON.stringify({ event: 'workspace_create_requested', projectId: workspaceId, workspaceKey, caller, ...(traceId ? { traceId } : {}), at: new Date().toISOString() }))
    const start = this.start(workspaceId, workspaceKey, storeSlug, userId, engineApiKey, caller, traceId, intent)
    this.starts.set(workspaceId, start)
    this.startsByWorkspaceKey.set(workspaceKey, start)
    try { return await start } finally {
      if (this.starts.get(workspaceId) === start) this.starts.delete(workspaceId)
      if (this.startsByWorkspaceKey.get(workspaceKey) === start) this.startsByWorkspaceKey.delete(workspaceKey)
    }
  }

  getByKey(workspaceKey: string) {
    for (const runtime of this.runtimes.values()) {
      if (runtime.workspaceKey === workspaceKey && runtime.child.exitCode === null) {
        runtime.touchedAt = Date.now()
        return runtime
      }
    }
    return null
  }

  getExisting(workspaceId: string, workspaceKey: string, userId: string, storeSlug: string) {
    const runtime = this.runtimes.get(workspaceId)
    if (!runtime || runtime.child.exitCode !== null || runtime.workspaceKey !== workspaceKey || runtime.userId !== userId || runtime.storeSlug !== storeSlug) return null
    runtime.touchedAt = Date.now()
    return runtime
  }

  async assertExecutionReady(): Promise<void> { await this.executionProvider.assertReady() }
  get executionMode(): 'host' | 'docker' | 'cloudflare' { return this.executionProvider.mode }
  async executionHealth() {
    const provider = this.executionProvider as WorkspaceExecutionProvider & { health?: () => Promise<{ reachable: boolean; configured: boolean }> }
    return provider.health ? provider.health() : { reachable: true, configured: true }
  }

  listRuntimes(): WorkspaceRuntime[] { return [...this.runtimes.values()] }

  async destroyWorkspace(workspaceKey: string, caller = 'unknown', traceId?: string, reason: 'delete' | 'idle' | 'destroy' = 'destroy') {
    this.destroyingWorkspaceKeys.set(workspaceKey, Date.now() + 60_000)
    // A delete can race a cold start after its entitlement check; wait for that keyed create, then destroy its one runtime.
    const starting = this.startsByWorkspaceKey.get(workspaceKey)
    if (starting) await starting.catch(() => undefined)
    const pending = [...this.runtimes.entries()].find(([, runtime]) => runtime.workspaceKey === workspaceKey)
    const provider = this.executionProvider as WorkspaceExecutionProvider & { destroyWorkspace?: (key: string) => Promise<void> }
    if (pending) {
      this.runtimes.delete(pending[0])
      console.info(JSON.stringify({ event: 'workspace_destroy_requested', projectId: pending[0], workspaceKey, reason, caller, ...(traceId ? { traceId } : {}), at: new Date().toISOString() }))
      await this.executionProvider.stop(pending[1].executionName, pending[1].child, { caller, traceId, reason })
      console.info(JSON.stringify({ event: 'workspace_stopped', projectId: pending[0], workspaceKey, reason, caller, ...(traceId ? { traceId } : {}), at: new Date().toISOString() }))
      return
    }
    if (!provider.destroyWorkspace) return
    console.info(JSON.stringify({ event: 'workspace_destroy_requested', workspaceKey, reason, caller, ...(traceId ? { traceId } : {}), at: new Date().toISOString() }))
    await provider.destroyWorkspace(workspaceKey, { caller, traceId, reason })
    console.info(JSON.stringify({ event: 'workspace_stopped', workspaceKey, reason, caller, ...(traceId ? { traceId } : {}), at: new Date().toISOString() }))
  }

  private async start(workspaceId: string, workspaceKey: string, storeSlug: string, userId: string, engineApiKey: string, caller: string, traceId: string | undefined, intent: ExecutionRequest['intent']): Promise<WorkspaceRuntime> {
    await this.executionProvider.assertReady()
    if (this.runtimes.size >= this.options.maxActive) {
      throw Object.assign(new Error('Builder capacity is full. Try again shortly.'), { code: 'WORKSPACE_CAPACITY', status: 429 })
    }
    const port = await reservePort()
    const root = path.join(this.options.dataRoot, 'ws', workspaceKey)
    const userData = path.join(root, 'userData')
    const apps = path.join(root, 'apps')
    const temp = path.join(root, 'tmp')
    await Promise.all([userData, apps, temp, path.join(root, 'logs')].map((dir) => fs.mkdir(dir, { recursive: true })))
    const restoredSecretsKey = await this.options.restoreBeforeStart?.(workspaceKey, root)
    const secretsKey = await getOrCreateSecretsKey(path.join(this.options.dataRoot, '.control', `${workspaceKey}.secrets-key`), restoredSecretsKey)
    const rpcSecret = randomBytes(32).toString('hex')
    const modelToken = randomBytes(32).toString('hex')
    const identitySecret = this.options.env.CORE_SERVICE_SECRET
    if (!identitySecret) throw new Error('CORE_SERVICE_SECRET is required to bind Engine usage to the authenticated user.')
    const creditIdentityPayload = Buffer.from(JSON.stringify({ userId, tenantId: workspaceId, expiresAt: Date.now() + 24 * 60 * 60 * 1000 })).toString('base64url')
    const creditIdentitySignature = createHmac('sha256', identitySecret).update(creditIdentityPayload).digest('base64url')
    const filteredRuntimeEnv = filterChildEnvironment(this.options.env)
    for (const key of ['CORE_TOKEN_SECRET', 'CORE_SERVICE_SECRET', 'NEST_INTERNAL_URL', 'MODEL_API_KEY', 'MODEL_ACCOUNT_ID', 'DATABASE_URL', 'FIGMA_ACCESS_TOKEN', 'SELTRA_ENGINE_API_KEY', 'DYAD_PRO_API_KEY']) delete filteredRuntimeEnv[key]
    const executionName = `seltra-ws-${workspaceKey.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48)}`
    const runtimeEnv: NodeJS.ProcessEnv = {
        ...filteredRuntimeEnv,
        NODE_ENV: 'production',
        DYAD_WEB_RUNTIME: '1',
        DYAD_WEB_RUNTIME_ENTRY: '1',
        DYAD_WORKSPACE_ID: workspaceKey,
        DYAD_USER_DATA: userData,
        DYAD_APPS_DIR: apps,
        DYAD_TMP_DIR: temp,
        RUNTIME_RPC_HOST: this.executionProvider.mode === 'docker' ? '0.0.0.0' : '127.0.0.1',
        RUNTIME_RPC_PORT: String(this.executionProvider.runtimePort ?? port),
        RUNTIME_RPC_SECRET: rpcSecret,
        RUNTIME_SECRETS_KEY: secretsKey,
        WORKSPACE_MODEL_TOKEN: modelToken,
        SELTRA_ENGINE_API_KEY: engineApiKey,
        SELTRA_ENGINE_CREDIT_IDENTITY: `${creditIdentityPayload}.${creditIdentitySignature}`,
        MODEL_GATEWAY_URL: this.executionProvider.mode === 'cloudflare'
          ? seltraEngineModelBaseUrl(this.options.env.CORE_PUBLIC_URL ?? '')
          : this.executionProvider.mode === 'docker'
          ? `http://host.docker.internal:${this.options.env.GATEWAY_PORT}/v1`
          : `http://127.0.0.1:${this.options.env.GATEWAY_PORT}/v1`,
        VITE_SELTRA_API_URL: this.options.publicApiUrl.replace(/\/$/, ''),
        VITE_SELTRA_STORE_SLUG: storeSlug,
      }
    const request: ExecutionRequest = { name: executionName, workspaceRoot: root, hostPort: port, runtimeEnv, caller, traceId, projectId: workspaceId, intent,
      runtimeEntry: path.join(this.options.root, 'dist/runtime/runtime_main.js'),
      nativeHook: path.join(this.options.root, 'scripts/web/native-require-hook.cjs'), runtimeRoot: this.options.root }
    let remote: Awaited<ReturnType<NonNullable<WorkspaceExecutionProvider['startRemote']>>> | undefined
    try {
      remote = this.executionProvider.startRemote ? await this.executionProvider.startRemote(request) : undefined
    } catch (error) {
      if (this.executionProvider.mode === 'cloudflare') await this.options.onWorkspaceCleanupPending?.(workspaceId, workspaceKey).catch(() => undefined)
      throw error
    }
    const child = remote?.child ?? this.executionProvider.spawn(request)
    const runtime = { workspaceId, workspaceKey, storeSlug, userId, baseUrl: remote?.baseUrl ?? `http://127.0.0.1:${port}`, rpcSecret, runtimeSecretsKey: secretsKey, modelToken, signGatewayRequest: remote?.signRequest, syncFromExecution: remote?.syncFromExecution, child, executionName, traceId, touchedAt: Date.now() }
    this.runtimes.set(workspaceId, runtime)
      console.info(JSON.stringify({ event: 'workspace_container_started', projectId: workspaceId, workspaceKey, caller, ...(traceId ? { traceId } : {}), provider: this.executionProvider.mode, instanceId: runtime.executionName, at: new Date().toISOString() }))
    console.info(JSON.stringify({ event: 'workspace_container_ready', projectId: workspaceId, workspaceKey, caller, ...(traceId ? { traceId } : {}), at: new Date().toISOString(), provider: this.executionProvider.mode }))
    child.once('exit', (code, signal) => {
      console.info(JSON.stringify({ event: 'workspace_container_stopped', projectId: workspaceId, workspaceKey, reason: 'runtime_process_exit', caller, ...(traceId ? { traceId } : {}), exitCode: code, signal, at: new Date().toISOString() }))
      if (this.runtimes.get(workspaceId) === runtime) this.runtimes.delete(workspaceId)
    })
    try { if (!remote) await waitForRuntime(port, child) } catch (error) {
      console.error(JSON.stringify({
        event: 'workspace_runtime_start_failed',
        error: error instanceof Error ? error.message : String(error),
      }))
      try {
        if (remote) this.executionProvider.release?.(executionName, child)
        else await this.executionProvider.stop(executionName, child, { caller, traceId, reason: 'destroy' })
      } catch {
        if (this.executionProvider.mode === 'cloudflare') await this.options.onWorkspaceCleanupPending?.(workspaceId, workspaceKey).catch(() => undefined)
      }
      this.runtimes.delete(workspaceId)
      throw error
    }
    return runtime
  }

  private async collectIdle() {
    const cutoff = Date.now() - this.options.idleMs
    for (const [id, runtime] of this.runtimes) {
      if (runtime.touchedAt < cutoff && !this.starts.has(id)) {
        if (this.options.persistBeforeIdleStop) {
          const saved = await this.options.persistBeforeIdleStop(runtime).catch(() => false)
          if (!saved) {
            runtime.touchedAt = Date.now()
            continue
          }
        }
        this.runtimes.delete(id)
        if (this.executionProvider.mode === 'cloudflare') {
          this.executionProvider.release?.(runtime.executionName, runtime.child)
          console.info(JSON.stringify({ event: 'workspace_runtime_handle_released', projectId: id, workspaceKey: runtime.workspaceKey, reason: 'idle_timeout', caller: 'workspace_supervisor', at: new Date().toISOString() }))
          continue
        }
        console.info(JSON.stringify({ event: 'workspace_idle_destroy_requested', projectId: id, workspaceKey: runtime.workspaceKey, reason: 'idle_timeout', at: new Date().toISOString() }))
        await this.executionProvider.stop(runtime.executionName, runtime.child, { caller: 'workspace_supervisor', reason: 'idle' })
      }
    }
  }

  async close() {
    clearInterval(this.timer)
    const runtimes = [...this.runtimes.values()]
    this.runtimes.clear()
    await Promise.all(runtimes.map((runtime) => this.executionProvider.mode === 'cloudflare'
      ? this.executionProvider.release?.(runtime.executionName, runtime.child)
      : this.executionProvider.stop(runtime.executionName, runtime.child, { caller: 'workspace_supervisor', reason: 'destroy' })))
  }
}
