import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHmac, randomBytes } from 'node:crypto'

export type ExecutionMode = 'host' | 'docker' | 'cloudflare'
export type ExecutionRequest = {
  name: string
  workspaceRoot: string
  hostPort: number
  runtimeEnv: NodeJS.ProcessEnv
  runtimeEntry: string
  nativeHook: string
  runtimeRoot: string
  projectId: string
  intent: 'user_send' | 'user_approve' | 'preview_open' | 'restore' | 'e2e'
  caller?: string
  traceId?: string
}

export interface WorkspaceExecutionProvider {
  readonly mode: ExecutionMode
  assertReady(): Promise<void>
  spawn(request: ExecutionRequest): ChildProcess
  startRemote?(request: ExecutionRequest): Promise<{ child: ChildProcess; baseUrl: string; signRequest: (method: string, path: string) => Record<string, string>; syncFromExecution: (scope?: 'apps') => Promise<void> }>
  stop(name: string, child: ChildProcess, context?: { caller?: string; traceId?: string; reason?: 'delete' | 'idle' | 'destroy' }): Promise<void>
  release?(name: string, child: ChildProcess): void
  destroyWorkspace?(workspaceKey: string, context?: { caller?: string; traceId?: string; reason?: 'delete' | 'idle' | 'destroy' }): Promise<void>
  listWorkspaces?(): Promise<Array<{ workspaceKey: string; createdAt: number; lastSeenAt: number }>>
  readonly runtimePort?: number
}

/** Local-only compatibility provider. It must never be selected by a production Core. */
export class HostWorkspaceExecutionProvider implements WorkspaceExecutionProvider {
  readonly mode = 'host' as const
  async assertReady() {
    if (process.env.NODE_ENV === 'production' || process.env.RENDER !== undefined) {
      throw new Error('Unsafe host workspace execution is disabled in production; configure the isolated Docker provider.')
    }
  }
  spawn(request: ExecutionRequest) {
    return spawn(process.execPath, ['--require', request.nativeHook, request.runtimeEntry], {
      cwd: request.runtimeRoot, env: request.runtimeEnv, stdio: ['ignore', 'ignore', 'ignore'], windowsHide: true, detached: process.platform !== 'win32',
    })
  }
  async stop(_name: string, child: ChildProcess) { terminateProcessTree(child) }
}

const REMOTE_RUNTIME_ENV = new Set([
  'NODE_ENV', 'DYAD_WEB_RUNTIME', 'DYAD_WEB_RUNTIME_ENTRY', 'DYAD_WORKSPACE_ID', 'DYAD_USER_DATA', 'DYAD_APPS_DIR', 'DYAD_TMP_DIR',
  'RUNTIME_RPC_HOST', 'RUNTIME_RPC_PORT', 'RUNTIME_RPC_SECRET', 'RUNTIME_SECRETS_KEY', 'WORKSPACE_MODEL_TOKEN',
  'SELTRA_ENGINE_API_KEY', 'SELTRA_ENGINE_CREDIT_IDENTITY', 'MODEL_GATEWAY_URL', 'VITE_SELTRA_API_URL', 'VITE_SELTRA_STORE_SLUG',
  'PREVIEW_BASE_DOMAIN', 'PREVIEW_PUBLIC_SCHEME', 'PREVIEW_PUBLIC_PORT',
])

export class CloudflareSandboxProvider implements WorkspaceExecutionProvider {
  readonly mode = 'cloudflare' as const
  private readonly workspaceDownloads = new Map<string, Promise<void>>()
  readonly runtimePort = 8787
  private readonly gatewayUrl: string
  private readonly signingSecret: string
  private readonly handles = new Map<string, string>()
  private gatewayReachable = false

  constructor(env: NodeJS.ProcessEnv = process.env, private readonly fetchImpl: typeof fetch = fetch) {
    this.gatewayUrl = (env.SANDBOX_GATEWAY_URL ?? '').trim().replace(/\/$/, '')
    this.signingSecret = (env.SANDBOX_GATEWAY_SIGNING_SECRET ?? '').trim()
  }

  async assertReady() {
    if (!this.gatewayUrl) throw new Error('Cloudflare execution requires SANDBOX_GATEWAY_URL.')
    if (this.signingSecret.length < 32) throw new Error('Cloudflare execution requires SANDBOX_GATEWAY_SIGNING_SECRET.')
    let health: Response
    try { health = await this.fetchImpl(`${this.gatewayUrl}/healthz`, { signal: AbortSignal.timeout(5000) }) }
    catch { this.gatewayReachable = false; throw new Error('Cloudflare sandbox gateway is unreachable.') }
    this.gatewayReachable = health.ok
    if (!health.ok) throw new Error('Cloudflare sandbox gateway health check failed.')
  }

  async startRemote(request: ExecutionRequest) {
    const workspaceKey = request.runtimeEnv.DYAD_WORKSPACE_ID
    if (!workspaceKey || !/^[a-f0-9]{12,128}$/i.test(workspaceKey)) throw new Error('Cloudflare sandbox requires a valid workspace key.')
    // WorkspaceSupervisor is reached only after Core verifies active project entitlement; the signed gateway body binds that project identity to this create.
    if (!request.projectId || !/^[A-Za-z0-9_-]{1,128}$/.test(request.projectId)) throw new Error('Cloudflare sandbox requires an active project identity.')
    if (!['user_send', 'user_approve', 'preview_open', 'restore', 'e2e'].includes(request.intent)) throw new Error('Cloudflare sandbox create requires a user intent.')
    const runtimeEnv = Object.fromEntries(Object.entries(request.runtimeEnv).filter(([name, value]) => REMOTE_RUNTIME_ENV.has(name) && typeof value === 'string')) as Record<string, string>
    runtimeEnv.DYAD_USER_DATA = '/workspace/userData'
    runtimeEnv.DYAD_APPS_DIR = '/workspace/apps'
    runtimeEnv.DYAD_TMP_DIR = '/workspace/tmp'
    runtimeEnv.RUNTIME_RPC_HOST = '0.0.0.0'
    runtimeEnv.RUNTIME_RPC_PORT = String(this.runtimePort)
    const route = `/v1/workspaces/${workspaceKey}/create`
    console.info(JSON.stringify({ event: 'sandbox_create_entry', workspaceId: request.projectId, workspaceKey, intent: request.intent, caller: request.caller ?? 'unknown', ...(request.traceId ? { traceId: request.traceId } : {}), stack: new Error('Cloudflare sandbox create caller').stack?.split('\n').slice(1, 9).map((line) => line.replaceAll(this.gatewayUrl, '[gateway]').replaceAll(this.signingSecret, '[redacted]')).join('\n') }))
    const response = await this.send(route, 'POST', JSON.stringify({ workspaceKey, projectId: request.projectId, intent: request.intent, env: runtimeEnv }), 120_000, { caller: request.caller, traceId: request.traceId })
    if (!response.ok) throw new Error(`Cloudflare sandbox create failed (${response.status}).`)
    const result = await response.json().catch(() => ({})) as { sandboxId?: string }
    if (!result.sandboxId) throw new Error('Cloudflare sandbox create returned an invalid response.')
    this.handles.set(request.name, workspaceKey)
    try { await this.uploadWorkspace(request.workspaceRoot, workspaceKey) }
    catch (error) { this.release(request.name, createRemoteHandle()); throw error }
    return {
      child: createRemoteHandle(),
      baseUrl: `${this.gatewayUrl}/v1/workspaces/${workspaceKey}/runtime`,
      signRequest: (method: string, requestPath: string) => this.signRequest(method, requestPath),
      syncFromExecution: (scope?: 'apps') => this.downloadWorkspace(request.workspaceRoot, workspaceKey, scope),
    }
  }

  spawn(_request: ExecutionRequest): ChildProcess { throw new Error('Cloudflare sandboxes require startRemote().') }

  async stop(name: string, child: ChildProcess, context?: { caller?: string; traceId?: string; reason?: 'delete' | 'idle' | 'destroy' }) {
    const workspaceKey = this.handles.get(name)
    if (workspaceKey) {
      await this.destroyWorkspace(workspaceKey, context)
      this.handles.delete(name)
    }
    if (child.exitCode === null) (child as unknown as { exitCode: number | null }).exitCode = 0
  }

  release(name: string, child: ChildProcess) {
    this.handles.delete(name)
    if (child.exitCode === null) (child as unknown as { exitCode: number | null }).exitCode = 0
  }

  async destroyWorkspace(workspaceKey: string, context?: { caller?: string; traceId?: string; reason?: 'delete' | 'idle' | 'destroy' }) {
    if (!/^[a-f0-9]{12,128}$/i.test(workspaceKey)) throw new Error('Invalid workspace key.')
    let lastStatus = 0
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await this.send(`/v1/workspaces/${workspaceKey}/destroy`, 'POST', '{}', 20_000, { ...context, reason: context?.reason ?? 'destroy' })
        lastStatus = response.status
        if (response.ok) return
      } catch {}
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)))
    }
    throw new Error(`Gateway workspace destroy failed (${lastStatus || 'network'}).`)
  }

  async listWorkspaces() {
    const response = await this.send('/v1/workspaces', 'GET')
    if (!response.ok) throw new Error(`Gateway workspace listing failed (${response.status}).`)
    const result = await response.json().catch(() => ({})) as { workspaces?: Array<{ workspaceKey?: unknown; createdAt?: unknown; lastSeenAt?: unknown }> }
    if (!Array.isArray(result.workspaces)) throw new Error('Gateway workspace listing returned an invalid response.')
    return result.workspaces.filter((row): row is { workspaceKey: string; createdAt: number; lastSeenAt: number } =>
      typeof row.workspaceKey === 'string' && /^[a-f0-9]{12,128}$/i.test(row.workspaceKey) && Number.isFinite(row.createdAt) && Number.isFinite(row.lastSeenAt),
    )
  }

  async health() {
    try { this.gatewayReachable = (await this.fetchImpl(`${this.gatewayUrl}/healthz`, { signal: AbortSignal.timeout(3000) })).ok }
    catch { this.gatewayReachable = false }
    return { reachable: this.gatewayReachable, configured: Boolean(this.gatewayUrl) }
  }

  signRequest(method: string, requestPath: string) {
    const timestamp = String(Date.now())
    const nonce = randomBytes(24).toString('base64url')
    const message = [method.toUpperCase(), requestPath, timestamp, nonce].join('\n')
    const signature = createHmac('sha256', this.signingSecret).update(message).digest('hex')
    return { 'x-sandbox-timestamp': timestamp, 'x-sandbox-nonce': nonce, 'x-sandbox-signature': signature }
  }

  private send(route: string, method: string, body = '', timeoutMs = 30_000, trace?: { caller?: string; traceId?: string; reason?: 'delete' | 'idle' | 'destroy' }) {
    return this.fetchImpl(`${this.gatewayUrl}${route}`, {
      method,
      headers: { ...this.signRequest(method, route), ...(body ? { 'content-type': 'application/json' } : {}), ...(trace?.caller ? { 'x-seltra-caller': trace.caller } : {}), ...(trace?.traceId ? { 'x-seltra-run-id': trace.traceId } : {}), ...(trace?.reason ? { 'x-sandbox-destroy-reason': trace.reason } : {}) },
      ...(body ? { body } : {}),
      signal: AbortSignal.timeout(timeoutMs),
    })
  }

  private async uploadWorkspace(root: string, workspaceKey: string) {
    const ignored = new Set(['node_modules', '.git', '.next', 'dist', 'out', 'logs', 'tmp']);
    const entries: Array<{ path: string; base64: string }> = [];
    let chunkBytes = 0;
    const flush = async () => {
      if (!entries.length) return;
      const route = `/v1/workspaces/${workspaceKey}/files`;
      const response = await this.send(route, 'PUT', JSON.stringify({ files: entries.splice(0) }), 30_000);
      if (!response.ok) throw new Error(`Cloudflare workspace file upload failed (${response.status}).`);
      chunkBytes = 0;
    };
    const walk = async (directory: string, relative = ''): Promise<void> => {
      for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        if (ignored.has(entry.name)) continue;
        const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
        const full = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) { await walk(full, childRelative); continue; }
        if (!entry.isFile()) continue;
        const encoded = (await fs.readFile(full)).toString('base64');
        const encodedBytes = Buffer.byteLength(encoded);
        if (encodedBytes > 1_250_000) throw new Error('A workspace file exceeds the Cloudflare upload limit.');
        if (chunkBytes + encodedBytes > 1_500_000) await flush();
        entries.push({ path: childRelative.replaceAll('\\', '/'), base64: encoded });
        chunkBytes += encodedBytes;
        if (entries.length >= 500) await flush();
      }
    };
    await walk(root);
    await flush();
  }

  private async downloadWorkspace(root: string, workspaceKey: string, scope?: 'apps'): Promise<void> {
    const active = this.workspaceDownloads.get(workspaceKey)
    if (active) {
      await active
      return this.downloadWorkspace(root, workspaceKey, scope)
    }
    const operation = this.performDownloadWorkspace(root, workspaceKey, scope)
    this.workspaceDownloads.set(workspaceKey, operation)
    try {
      await operation
    } finally {
      if (this.workspaceDownloads.get(workspaceKey) === operation) this.workspaceDownloads.delete(workspaceKey)
    }
  }

  private async performDownloadWorkspace(root: string, workspaceKey: string, scope?: 'apps') {
    const listRoute = `/v1/workspaces/${workspaceKey}/files?list=1`
    const listResponse = await this.send(listRoute, 'GET')
    if (!listResponse.ok) throw new Error(`Cloudflare workspace file listing failed (${listResponse.status}).`)
    const manifest = await listResponse.json().catch(() => ({})) as { files?: string[] }
    if (!Array.isArray(manifest.files) || manifest.files.some((name) => typeof name !== 'string' || !name || name.startsWith('/') || name.split(/[\\/]/).includes('..'))) throw new Error('Cloudflare workspace returned an invalid file listing.')
    const ignored = new Set(['node_modules', '.git', '.next', 'dist', 'out', 'logs', 'tmp'])
    const paths = manifest.files.filter((name) =>
      (!scope || name.replaceAll('\\', '/').startsWith(`${scope}/`)) &&
      !name.split(/[\\/]/).some((part) => ignored.has(part)),
    )
    const remotePaths = new Set(paths.map((name) => name.replaceAll('\\', '/')))
    const removeStale = async (directory: string, relative = ''): Promise<void> => {
      for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        if (ignored.has(entry.name) || entry.isSymbolicLink()) continue
        const childRelative = relative ? `${relative}/${entry.name}` : entry.name
        const full = path.join(directory, entry.name)
        if (entry.isDirectory()) {
          await removeStale(full, childRelative)
          const remaining = await fs.readdir(full).catch(() => ['unreadable'])
          if (!remaining.length) await fs.rmdir(full).catch(() => undefined)
        } else if (entry.isFile() && !remotePaths.has(childRelative.replaceAll('\\', '/'))) {
          await fs.rm(full, { force: true })
        }
      }
    }
    const staleRoot = scope ? path.join(root, scope) : root
    if (scope) await fs.mkdir(staleRoot, { recursive: true })
    await removeStale(staleRoot, scope ?? '')
    for (let offset = 0; offset < paths.length; offset += 20) {
      const batch = paths.slice(offset, offset + 20)
      const route = `/v1/workspaces/${workspaceKey}/files`
      const response = await this.send(route, 'POST', JSON.stringify({ paths: batch }))
      if (!response.ok) throw new Error(`Cloudflare workspace file download failed (${response.status}).`)
      const files = await response.json().catch(() => []) as Array<{ path: string; base64: string }>
      for (const file of files) {
        if (!file || typeof file.path !== 'string' || typeof file.base64 !== 'string' || !batch.includes(file.path)) throw new Error('Cloudflare workspace returned an invalid file batch.')
        const target = path.resolve(root, file.path)
        if (target !== root && !target.startsWith(`${path.resolve(root)}${path.sep}`)) throw new Error('Cloudflare workspace returned an unsafe file path.')
        await fs.mkdir(path.dirname(target), { recursive: true })
        await fs.writeFile(target, Buffer.from(file.base64, 'base64'))
      }
    }
  }
}

function createRemoteHandle(): ChildProcess {
  const handle = {
    exitCode: null as number | null,
    signalCode: null as NodeJS.Signals | null,
    pid: undefined,
    once() { return handle },
    off() { return handle },
  }
  return handle as unknown as ChildProcess
}

/**
 * Container boundary for the existing runtime. The configured Docker network must be
 * created with --internal and host firewall rules must expose only the Core model/RPC
 * gateway to that network. No Core source, secrets, socket or sibling workspace is mounted.
 */
export class DockerWorkspaceExecutionProvider implements WorkspaceExecutionProvider {
  readonly mode = 'docker' as const
  readonly runtimePort = 8787
  private readonly image = process.env.WORKSPACE_RUNTIME_IMAGE
  private imageId?: string
  private readonly network = process.env.WORKSPACE_DOCKER_NETWORK
  private readonly hostGateway = process.env.WORKSPACE_DOCKER_HOST_GATEWAY

  async assertReady() {
    if (!this.image || !this.network || !this.hostGateway) {
      throw new Error('Docker isolation requires WORKSPACE_RUNTIME_IMAGE, WORKSPACE_DOCKER_NETWORK and WORKSPACE_DOCKER_HOST_GATEWAY.')
    }
    const inspected = spawnSync('docker', ['network', 'inspect', this.network], { encoding: 'utf8', windowsHide: true, timeout: 10_000 })
    if (inspected.status !== 0) throw new Error('Configured Docker workspace network is unavailable.')
    if (!dockerNetworkIsInternal(inspected.stdout)) throw new Error('Docker workspace network must be configured as internal (egress denied).')
    const version = spawnSync('docker', ['image', 'inspect', this.image, '--format', '{{.Id}}'], { encoding: 'utf8', windowsHide: true, timeout: 10_000 })
    if (version.status !== 0 || !/^sha256:[a-f0-9]{64}\s*$/i.test(version.stdout)) throw new Error('Workspace runtime image is missing or not inspectable.')
    this.imageId = version.stdout.trim()
  }

  spawn(request: ExecutionRequest) {
    if (!this.imageId || !this.network || !this.hostGateway) throw new Error('Docker execution provider has not passed readiness checks.')
    const args = [
      'run', '--rm', '--init', '--name', request.name,
      '--network', this.network,
      '--add-host', `host.docker.internal:${this.hostGateway}`,
      '--publish', `127.0.0.1:${request.hostPort}:8787`,
      '--mount', `type=bind,src=${path.resolve(request.workspaceRoot)},dst=/workspace,rw`,
      '--workdir', '/workspace', '--user', `${process.getuid?.() ?? 10001}:${process.getgid?.() ?? 10001}`, '--read-only',
      '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
      '--memory', process.env.WORKSPACE_MEMORY_LIMIT || '2g',
      '--cpus', process.env.WORKSPACE_CPU_LIMIT || '2',
      '--pids-limit', process.env.WORKSPACE_PIDS_LIMIT || '256',
      '--tmpfs', '/tmp:rw,noexec,nosuid,size=512m',
      '--tmpfs', '/opt/dyad/tmp:rw,noexec,nosuid,size=256m',
    ]
    const allowed = [
      'NODE_ENV', 'DYAD_WEB_RUNTIME', 'DYAD_WEB_RUNTIME_ENTRY', 'DYAD_WORKSPACE_ID', 'DYAD_USER_DATA', 'DYAD_APPS_DIR', 'DYAD_TMP_DIR',
      'RUNTIME_RPC_HOST', 'RUNTIME_RPC_PORT', 'RUNTIME_RPC_SECRET', 'RUNTIME_SECRETS_KEY', 'WORKSPACE_MODEL_TOKEN',
      'SELTRA_ENGINE_API_KEY', 'SELTRA_ENGINE_CREDIT_IDENTITY', 'MODEL_GATEWAY_URL', 'VITE_SELTRA_API_URL', 'VITE_SELTRA_STORE_SLUG',
    ]
    const cliEnv = { ...dockerCliEnvironment() }
    for (const name of allowed) if (request.runtimeEnv[name] !== undefined) { args.push('--env', name); cliEnv[name] = request.runtimeEnv[name] }
    args.push(this.imageId)
    return spawn('docker', args, { env: cliEnv, stdio: ['ignore', 'ignore', 'ignore'], windowsHide: true, detached: process.platform !== 'win32' })
  }

  async stop(name: string, child: ChildProcess) {
    await new Promise<void>((resolve) => {
      const stopper = spawn('docker', ['stop', '--time', '10', name], { env: dockerCliEnvironment(), stdio: 'ignore', windowsHide: true })
      stopper.once('exit', () => resolve()); stopper.once('error', () => resolve())
    })
    terminateProcessTree(child)
  }
}

export function createWorkspaceExecutionProvider(env: NodeJS.ProcessEnv = process.env): WorkspaceExecutionProvider {
  const production = env.NODE_ENV === 'production' || env.RENDER !== undefined
  const mode = env.EXECUTION_PROVIDER || 'cloudflare'
  if (mode === 'cloudflare') return new CloudflareSandboxProvider(env)
  if (mode === 'host' && !production) return new HostWorkspaceExecutionProvider()
  if (mode === 'host') throw new Error('Host workspace execution is not permitted in production.')
  throw new Error('EXECUTION_PROVIDER must be cloudflare or host (local development only).')
}

export function dockerNetworkIsInternal(inspectOutput: string): boolean {
  try { const networks = JSON.parse(inspectOutput) as Array<{ Internal?: boolean }>; return networks.length === 1 && networks[0]?.Internal === true }
  catch { return false }
}

function dockerCliEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH }
  for (const name of ['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_CONFIG', 'HOME', 'USERPROFILE', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP']) {
    if (process.env[name]) env[name] = process.env[name]
  }
  return env
}

function terminateProcessTree(child: ChildProcess) {
  if (child.exitCode !== null || !child.pid) return
  if (process.platform === 'win32') { spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); return }
  try { process.kill(-child.pid, 'SIGTERM') } catch { child.kill('SIGTERM') }
}
