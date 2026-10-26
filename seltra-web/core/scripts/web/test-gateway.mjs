import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(path.join(root, 'server', 'package.json'))
const { SignJWT } = await import(pathToFileURL(require.resolve('jose')))
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'seltra-core-gateway-'))
const tokenSecret = 'core-token-secret-for-gateway-test-32-bytes'
const serviceSecret = 'core-service-secret-for-gateway-test-32-bytes'
const tenantId = 'tenant-test-1'
const userId = 'seltra-user-test-1'
const workspaceKey = 'a1b2c3d4e5f6'
let gateway
let gatewayOutput = ''

const internal = createServer((request, response) => {
  if (request.headers['x-core-service-secret'] !== serviceSecret) {
    response.writeHead(401).end()
    return
  }
  if (request.method === 'GET' && request.url === `/api/v5/internal/core/entitlement/${tenantId}`) {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ active: true, tenantId, userId, coreWorkspaceKey: workspaceKey, storeSlug: 'merchant-test', email: 'merchant@example.test', plan: 'free' }))
    return
  }
  response.writeHead(404).end()
})
await new Promise((resolve) => internal.listen(0, '127.0.0.1', resolve))
const internalPort = internal.address().port
const probe = createServer()
await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve))
const gatewayPort = probe.address().port
await new Promise((resolve) => probe.close(resolve))

try {
  gateway = spawn(process.execPath, [path.join(root, 'server/dist/main.mjs')], {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: 'test', GATEWAY_HOST: '127.0.0.1', GATEWAY_PORT: String(gatewayPort),
      GATEWAY_ALLOWED_ORIGINS: 'http://localhost:3000', GATEWAY_PUBLIC_HOSTS: 'localhost,127.0.0.1',
      CORE_TOKEN_SECRET: tokenSecret, CORE_SERVICE_SECRET: serviceSecret,
      NEST_INTERNAL_URL: `http://127.0.0.1:${internalPort}`,
      DATA_ROOT: path.join(temp, 'data'), CONTROL_DIR: path.join(temp, 'control'),
      PREVIEW_BASE_DOMAIN: 'localhost', PREVIEW_PUBLIC_SCHEME: 'http', PREVIEW_PUBLIC_PORT: String(gatewayPort),
    },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  })
  gateway.stdout.on('data', (chunk) => { gatewayOutput += chunk.toString() })
  gateway.stderr.on('data', (chunk) => { gatewayOutput += chunk.toString() })
  const base = `http://127.0.0.1:${gatewayPort}`
  const deadline = Date.now() + 30_000
  let ready = false
  while (Date.now() < deadline && gateway.exitCode === null) {
    try { if ((await fetch(`${base}/healthz`)).ok) { ready = true; break } } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  assert.equal(ready, true, `gateway starts with Seltra service credentials\n${gatewayOutput}`)
  assert.equal((await fetch(`${base}/login`)).status, 404, 'legacy login page is retired')
  assert.equal((await fetch(`${base}/api/auth/me`)).status, 401, 'Core API requires a Seltra-signed token')

  const token = await new SignJWT({ workspaceId: tenantId, coreWorkspaceKey: workspaceKey, storeSlug: 'merchant-test', email: 'merchant@example.test', plan: 'free' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuer('seltra-api').setAudience('seltra-core').setSubject(userId).setIssuedAt().setExpirationTime('5m').sign(new TextEncoder().encode(tokenSecret))
  const me = await fetch(`${base}/api/auth/me`, { headers: { authorization: `Bearer ${token}` } })
  assert.equal(me.status, 200, 'valid Seltra token maps to its Tenant workspace')
  assert.equal((await me.json()).workspace.id, tenantId)
  assert.equal((await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { authorization: `Bearer ${token}`, origin: 'http://localhost:3000' } })).status, 404, 'legacy login endpoint is retired')

  const wrongAudience = await new SignJWT({ workspaceId: tenantId, coreWorkspaceKey: workspaceKey, storeSlug: 'merchant-test', email: 'merchant@example.test', plan: 'free' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuer('seltra-api').setAudience('other-service').setSubject(userId).setIssuedAt().setExpirationTime('5m').sign(new TextEncoder().encode(tokenSecret))
  assert.equal((await fetch(`${base}/api/auth/me`, { headers: { authorization: `Bearer ${wrongAudience}` } })).status, 401, 'wrong audience is rejected')

  const preflight = await fetch(`${base}/api/auth/me`, { method: 'OPTIONS', headers: { origin: 'http://localhost:3000', 'access-control-request-method': 'GET' } })
  assert.equal(preflight.status, 204)
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'http://localhost:3000')
  assert.equal((await fetch(`${base}/api/auth/me`, { method: 'OPTIONS', headers: { origin: 'https://attacker.example' } })).status, 403)
  console.log('Core gateway identity boundary PASS: Seltra bearer auth, tenant mapping, CORS, and retired login routes.')
} finally {
  if (gateway && gateway.exitCode === null) {
    if (process.platform === 'win32') spawnSync('taskkill.exe', ['/PID', String(gateway.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
    gateway.kill('SIGTERM')
    await Promise.race([new Promise((resolve) => gateway.once('exit', resolve)), new Promise((resolve) => setTimeout(resolve, 2_000))])
  }
  internal.closeAllConnections()
  await new Promise((resolve) => internal.close(resolve))
  await fs.rm(temp, { recursive: true, force: true })
}
