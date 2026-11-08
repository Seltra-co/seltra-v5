import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient({ log: ['error'] })
const localCore = 'http://127.0.0.1:8080'

function hostOnly(value) {
  try { return new URL(value).host } catch { return 'unconfigured' }
}

function hostPort(value) {
  try {
    const url = new URL(value)
    return `${url.hostname}:${url.port || (url.protocol === 'https:' ? '443' : '80')}`
  } catch { return 'unconfigured' }
}

function modelBaseUrl(value) {
  const url = new URL(value)
  url.pathname = `${url.pathname.replace(/\/+$/, '').replace(/\/v1$/i, '')}/v1`
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/$/, '')
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

function errorClassFromPayload(payload, status) {
  const code = payload && typeof payload === 'object' ? payload.error?.code ?? payload.code : undefined
  return typeof code === 'string' && /^[A-Z0-9_-]{1,64}$/.test(code) ? code : `HTTP_${status}`
}

async function measureModel(label, endpoint, token, plannerModel) {
  const started = performance.now()
  let status = 'ERR'
  let errorClass = 'NONE'
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: plannerModel, messages: [{ role: 'user', content: 'Reply OK.' }], max_tokens: 1, stream: false }),
      signal: AbortSignal.timeout(25_000),
    })
    status = response.status
    if (!response.ok) errorClass = errorClassFromPayload(await response.json().catch(() => ({})), response.status)
    else await response.body?.cancel().catch(() => undefined)
  } catch (error) {
    errorClass = error instanceof Error ? error.name : 'UNKNOWN_ERROR'
  }
  console.log(`MODEL ${label} pass=${typeof status === 'number' && status >= 200 && status < 300} host=${hostOnly(endpoint)} status=${status} errorClass=${errorClass} ms=${Math.round(performance.now() - started)}`)
}

async function main() {
  const databaseHost = hostOnly(process.env.DATABASE_URL ?? '')
let databaseConfig = { pooler: 'unknown', connectionLimit: 'default', poolTimeout: 'default' }
try {
  const databaseUrl = new URL(process.env.DATABASE_URL ?? '')
  databaseConfig = {
    pooler: /pooler/i.test(databaseUrl.hostname) ? 'yes' : 'no',
    connectionLimit: databaseUrl.searchParams.get('connection_limit') ?? 'default',
    poolTimeout: databaseUrl.searchParams.get('pool_timeout') ?? 'default',
  }
} catch {}
console.log(`DB host=${databaseHost} pooler=${databaseConfig.pooler} connectionLimit=${databaseConfig.connectionLimit} poolTimeout=${databaseConfig.poolTimeout}`)
  try {
    const samples = []
    for (let index = 0; index < 5; index++) {
      const started = performance.now()
      await prisma.$queryRaw`SELECT 1`
      samples.push(performance.now() - started)
    }
    console.log(`DB SELECT_1 pass=true minMs=${Math.round(Math.min(...samples))} medianMs=${Math.round(median(samples))} samples=5`)
    const lookupStarted = performance.now()
    const tenant = await prisma.tenant.findFirst({
      where: { status: 'active', coreWorkspaceKey: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    })
    console.log(`DB tenant_lookup pass=${Boolean(tenant)} ms=${Math.round(performance.now() - lookupStarted)}`)
    if (!tenant) throw new Error('NO_ACTIVE_WORKSPACE')

    const publicCore = process.env.DIAG_CORE_PUBLIC_URL || process.env.CORE_PUBLIC_URL
    const plannerModel = process.env.AI_MODEL_REASONING?.trim() || process.env.AI_MODEL_DEFAULT?.trim() || 'seltra-planner'
    if (!publicCore) throw new Error('CORE_PUBLIC_URL is not configured')
    const publicBase = modelBaseUrl(publicCore)
    console.log(`MODEL_GATEWAY_URL hostPort=${hostPort(publicBase)}`)

    let token
    const tokenStarted = performance.now()
    try {
      const modelTokenPath = '/internal/diag/workspace-model-token'
      console.log(`MODEL_TOKEN route=${modelTokenPath} hostPort=${hostPort(localCore)}`)
      const response = await fetch(`${localCore}${modelTokenPath}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-core-service-secret': process.env.CORE_SERVICE_SECRET ?? '' },
        body: JSON.stringify({ workspaceId: tenant.id }),
        signal: AbortSignal.timeout(180_000),
      })
      if (!response.ok) {
        console.log(`MODEL_TOKEN pass=false host=${hostOnly(localCore)} status=${response.status} errorClass=HTTP_${response.status} ms=${Math.round(performance.now() - tokenStarted)}`)
      } else {
        const result = await response.json()
        if (typeof result.token !== 'string' || !result.token) throw new Error('TOKEN_MISSING')
        token = result.token
        console.log(`MODEL_TOKEN pass=true host=${hostOnly(localCore)} status=${response.status} errorClass=NONE ms=${Math.round(performance.now() - tokenStarted)}`)
      }
    } catch (error) {
      console.log(`MODEL_TOKEN pass=false host=${hostOnly(localCore)} status=ERR errorClass=${error instanceof Error ? error.name : 'UNKNOWN_ERROR'} ms=${Math.round(performance.now() - tokenStarted)}`)
    }
    if (token) {
      await measureModel('public', `${publicBase}/chat/completions`, token, plannerModel)
      await measureModel('local', `${localCore}/v1/chat/completions`, token, plannerModel)
    } else {
      console.log(`MODEL public host=${hostOnly(publicBase)} status=SKIP errorClass=TOKEN_UNAVAILABLE ms=0`)
      console.log(`MODEL local host=${hostOnly(localCore)} status=SKIP errorClass=TOKEN_UNAVAILABLE ms=0`)
      process.exitCode = 1
    }
  } catch (error) {
    console.log(`DB pass=false host=${databaseHost} errorClass=${error instanceof Error ? error.name : 'UNKNOWN_ERROR'}`)
    process.exitCode = 1
  } finally {
    await prisma.$disconnect()
  }
}

await main()
