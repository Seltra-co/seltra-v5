import { randomBytes } from 'node:crypto'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import fs from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'

export type WorkspaceRuntime = {
  workspaceId: string
  workspaceKey: string
  storeSlug: string
  baseUrl: string
  rpcSecret: string
  modelToken: string
  child: ChildProcess
  touchedAt: number
}

type Options = { root: string; dataRoot: string; maxActive: number; idleMs: number; publicApiUrl: string; env: NodeJS.ProcessEnv }

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
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('Workspace runtime exited during startup.')
    try {
      await new Promise<void>((resolve, reject) => {
        const socket = net.createConnection(port, '127.0.0.1')
        socket.once('connect', () => { socket.end(); resolve() })
        socket.once('error', reject)
      })
      return
    } catch { await new Promise((resolve) => setTimeout(resolve, 200)) }
  }
  throw new Error('Workspace runtime did not become ready within 60 seconds.')
}

async function getOrCreateSecretsKey(root: string) {
  const filename = path.join(root, 'runtime-secrets.key')
  try { return (await fs.readFile(filename, 'utf8')).trim() } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const key = randomBytes(32).toString('hex')
  await fs.writeFile(filename, key, { flag: 'wx', mode: 0o600 }).catch(async (error) => {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  })
  return (await fs.readFile(filename, 'utf8')).trim()
}

export class WorkspaceSupervisor {
  private readonly runtimes = new Map<string, WorkspaceRuntime>()
  private readonly starts = new Map<string, Promise<WorkspaceRuntime>>()
  private readonly timer: NodeJS.Timeout

  constructor(private readonly options: Options) {
    this.timer = setInterval(() => void this.collectIdle(), 60_000)
    this.timer.unref()
  }

  async get(workspaceId: string, workspaceKey: string, storeSlug: string) {
    const active = this.runtimes.get(workspaceId)
    if (active && active.child.exitCode === null) {
      if (active.workspaceKey !== workspaceKey) throw Object.assign(new Error('Workspace key does not match the active runtime.'), { code: 'WORKSPACE_KEY_MISMATCH', status: 403 })
      if (active.storeSlug !== storeSlug) throw Object.assign(new Error('Store slug changed. Restart the workspace runtime before continuing.'), { code: 'STORE_SLUG_MISMATCH', status: 409 })
      active.touchedAt = Date.now(); return active
    }
    const pending = this.starts.get(workspaceId)
    if (pending) return pending
    const start = this.start(workspaceId, workspaceKey, storeSlug)
    this.starts.set(workspaceId, start)
    try { return await start } finally { this.starts.delete(workspaceId) }
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

  private async start(workspaceId: string, workspaceKey: string, storeSlug: string): Promise<WorkspaceRuntime> {
    if (this.runtimes.size >= this.options.maxActive) {
      throw Object.assign(new Error('Builder capacity is full. Try again shortly.'), { code: 'WORKSPACE_CAPACITY', status: 429 })
    }
    const port = await reservePort()
    const root = path.join(this.options.dataRoot, 'ws', workspaceKey)
    const userData = path.join(root, 'userData')
    const apps = path.join(root, 'apps')
    const temp = path.join(root, 'tmp')
    await Promise.all([userData, apps, temp, path.join(root, 'logs')].map((dir) => fs.mkdir(dir, { recursive: true })))
    const secretsKey = await getOrCreateSecretsKey(root)
    const rpcSecret = randomBytes(32).toString('hex')
    const modelToken = randomBytes(32).toString('hex')
    const runtimeEnv = { ...this.options.env }
    for (const key of ['CORE_TOKEN_SECRET', 'CORE_SERVICE_SECRET', 'NEST_INTERNAL_URL', 'MODEL_API_KEY', 'MODEL_ACCOUNT_ID', 'DATABASE_URL', 'FIGMA_ACCESS_TOKEN']) delete runtimeEnv[key]
    const child = spawn(process.execPath, [
      '--require', path.join(this.options.root, 'scripts/web/native-require-hook.cjs'),
      path.join(this.options.root, 'dist/runtime/runtime_main.js'),
    ], {
      cwd: this.options.root,
      env: {
        ...runtimeEnv,
        NODE_ENV: 'production',
        DYAD_WEB_RUNTIME: '1',
        DYAD_WEB_RUNTIME_ENTRY: '1',
        DYAD_WORKSPACE_ID: workspaceKey,
        DYAD_USER_DATA: userData,
        DYAD_APPS_DIR: apps,
        DYAD_TMP_DIR: temp,
        RUNTIME_RPC_HOST: '127.0.0.1',
        RUNTIME_RPC_PORT: String(port),
        RUNTIME_RPC_SECRET: rpcSecret,
        RUNTIME_SECRETS_KEY: secretsKey,
        WORKSPACE_MODEL_TOKEN: modelToken,
        MODEL_GATEWAY_URL: `http://127.0.0.1:${this.options.env.GATEWAY_PORT}/v1`,
        VITE_SELTRA_API_URL: this.options.publicApiUrl.replace(/\/$/, ''),
        VITE_SELTRA_STORE_SLUG: storeSlug,
      },
      stdio: ['ignore', 'ignore', 'ignore'],
      windowsHide: true,
      detached: process.platform !== 'win32',
    })
    const runtime = { workspaceId, workspaceKey, storeSlug, baseUrl: `http://127.0.0.1:${port}`, rpcSecret, modelToken, child, touchedAt: Date.now() }
    this.runtimes.set(workspaceId, runtime)
    child.once('exit', () => { if (this.runtimes.get(workspaceId) === runtime) this.runtimes.delete(workspaceId) })
    try { await waitForRuntime(port, child) } catch (error) { child.kill(); this.runtimes.delete(workspaceId); throw error }
    return runtime
  }

  private async collectIdle() {
    const cutoff = Date.now() - this.options.idleMs
    for (const [id, runtime] of this.runtimes) {
      if (runtime.touchedAt < cutoff && !this.starts.has(id)) {
        this.runtimes.delete(id)
        terminateTree(runtime.child)
      }
    }
  }

  async close() {
    clearInterval(this.timer)
    const children = [...this.runtimes.values()].map(({ child }) => child)
    this.runtimes.clear()
    for (const child of children) terminateTree(child)
  }
}
