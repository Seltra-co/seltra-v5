import { readFile } from 'node:fs/promises'
import { createHmac, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import path from 'node:path'

const root = process.cwd()
const require = createRequire(path.join(root, 'seltra-web/backend/package.json'))
const { parse } = require('dotenv')
const [backendText, coreText] = await Promise.all([
  readFile(path.join(root, 'seltra-web/backend/.env'), 'utf8'),
  readFile(path.join(root, 'seltra-web/core/.env.web'), 'utf8'),
])
const env = { ...parse(coreText), ...parse(backendText), ...process.env }
const backendUrl = new URL(process.env.SELTRA_BACKEND_URL || 'http://127.0.0.1:3001')
const loopback = ['localhost', '127.0.0.1', '::1'].includes(backendUrl.hostname)
if (env.NODE_ENV === 'production' || env.RENDER || !loopback) throw new Error('Refusing local builder repro outside a local DEV backend.')
if (!env.JWT_SECRET || env.JWT_SECRET.length < 16 || !env.DATABASE_URL) throw new Error('Local session minting requires configured backend JWT and database settings.')
const localDbUrl = new URL(env.DATABASE_URL)
const dbHostIsLoopback = ['localhost', '127.0.0.1', '::1'].includes(localDbUrl.hostname)
if (!dbHostIsLoopback) throw new Error('Refusing the repro because the configured database is not local.')
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } })
const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
const now = Math.floor(Date.now() / 1000)
function mint(userId) {
  const header = encode({ alg: 'HS256', typ: 'JWT' })
  const payload = encode({ sub: userId, iat: now, exp: now + 600, jti: randomUUID() })
  const input = `${header}.${payload}`
  return `${input}.${createHmac('sha256', env.JWT_SECRET).update(input).digest('base64url')}`
}
try {
  const tenants = await prisma.tenant.findMany({ where: { status: 'active', ownerId: { not: null } }, select: { id: true, ownerId: true, tenantApps: { select: { coreAppId: true, name: true, status: true, corePath: true, previewUrl: true }, take: 1, orderBy: { updatedAt: 'desc' } } }, take: 5, orderBy: { createdAt: 'desc' } })
  if (!tenants.length) throw new Error('No active local tenant is available for the repro.')
  const tenant = tenants[0]
  const token = mint(tenant.ownerId)
  const randomProjectId = randomUUID()
  const cases = [
    { label: 'real_tenant', id: tenant.id, app: tenant.tenantApps[0] },
    { label: 'project_id_lookup', id: randomProjectId, app: undefined },
  ]
  for (const testCase of cases) {
    const get = await fetch(`${backendUrl.origin}/api/v5/builder/apps?tenantId=${encodeURIComponent(testCase.id)}`, { headers: { authorization: `Bearer ${token}`, 'x-request-id': `a5-${testCase.label}-${randomUUID()}` } })
    const getBody = await get.json().catch(() => null)
    console.log(JSON.stringify({ route: 'GET /api/v5/builder/apps', case: testCase.label, status: get.status, bodyCode: getBody?.code ?? getBody?.error?.code ?? null, resultCount: Array.isArray(getBody?.data ?? getBody) ? (getBody?.data ?? getBody).length : null }))
    const app = testCase.app
    const coreAppId = app?.coreAppId ?? 1
    const state = await fetch(`${backendUrl.origin}/api/v5/builder/apps/state`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-request-id': `a5-${testCase.label}-state-${randomUUID()}` }, body: JSON.stringify({ tenantId: testCase.id, coreAppId, name: app?.name ?? 'Local repro probe', status: app?.status ?? 'draft', corePath: app?.corePath ?? undefined, previewUrl: app?.previewUrl ?? undefined, eventType: 'app.reconnected' }) })
    const stateBody = await state.json().catch(() => null)
    console.log(JSON.stringify({ route: 'POST /api/v5/builder/apps/state', case: testCase.label, status: state.status, bodyCode: stateBody?.code ?? stateBody?.error?.code ?? null }))
  }
} finally {
  await prisma.$disconnect()
}
