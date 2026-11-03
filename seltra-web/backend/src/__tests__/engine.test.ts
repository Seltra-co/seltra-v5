import { createHash, createHmac } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const mocks = {
  keys: [] as any[],
  usage: [] as any[],
  assets: [] as any[],
  balance: 100,
  userBalance: 100,
  userLifetimeUsed: 0,
  workspaceMirrors: new Map<string, any>(),
}

jest.mock('../db', () => ({
  prisma: {
    seltraEngineApiKey: {
      findMany: jest.fn(async () => mocks.keys.filter((key) => key.revokedAt === null)),
      findUnique: jest.fn(async ({ where }: any) => mocks.keys.find((key) => key.keyHash === where.keyHash) ?? null),
      update: jest.fn(async () => ({})),
      create: jest.fn(async ({ data }: any) => { mocks.keys.push(data); return data }),
    },
    seltraEngineUsage: { create: jest.fn(async ({ data }: any) => { mocks.usage.push(data); return data }) },
    seltraEngineAsset: { create: jest.fn(async ({ data }: any) => { mocks.assets.push(data); return data }) },
    creditLedger: { create: jest.fn(async () => ({})) },
    userCreditLedger: { create: jest.fn(async () => ({})) },
    tenant: { findFirst: jest.fn(async ({ where }: any) => where.id === 'tenant-1' && where.ownerId === 'user-1' ? { id: 'tenant-1' } : null) },
    userCredit: {
      findUnique: jest.fn(async () => ({ userId: 'user-1', balance: mocks.userBalance, lifetimeGranted: 60000, lifetimeUsed: mocks.userLifetimeUsed, windowStartedAt: new Date('2026-11-01T00:00:00.000Z') })),
      findUniqueOrThrow: jest.fn(async () => ({ userId: 'user-1', balance: mocks.userBalance, lifetimeGranted: 60000, lifetimeUsed: mocks.userLifetimeUsed, windowStartedAt: new Date('2026-11-01T00:00:00.000Z') })),
      update: jest.fn(async ({ data }: any) => { if (data.balance?.increment) mocks.userBalance += data.balance.increment; if (data.balance?.decrement) mocks.userBalance -= data.balance.decrement; if (data.lifetimeUsed?.increment) mocks.userLifetimeUsed += data.lifetimeUsed.increment; return { userId: 'user-1', balance: mocks.userBalance, lifetimeGranted: 60000, lifetimeUsed: mocks.userLifetimeUsed, windowStartedAt: new Date('2026-11-01T00:00:00.000Z') } }),
      updateMany: jest.fn(async ({ data }: any) => { if (mocks.userBalance < data.balance.decrement) return { count: 0 }; mocks.userBalance -= data.balance.decrement; if (data.lifetimeUsed?.increment) mocks.userLifetimeUsed += data.lifetimeUsed.increment; return { count: 1 } }),
    },
    workspaceCredit: {
      findUnique: jest.fn(async () => ({ balance: mocks.balance })),
      findUniqueOrThrow: jest.fn(async () => ({ balance: mocks.balance })),
      update: jest.fn(async ({ data }: any) => { if (data.balance?.increment) mocks.balance += data.balance.increment; if (data.balance?.decrement) mocks.balance -= data.balance.decrement; return { balance: mocks.balance } }),
      updateMany: jest.fn(async ({ data }: any) => { if (mocks.balance < data.balance.decrement) return { count: 0 }; mocks.balance -= data.balance.decrement; return { count: 1 } }),
      upsert: jest.fn(async ({ where, create, update }: any) => { const current = mocks.workspaceMirrors.get(where.workspaceId); const next = current ? { ...current, ...update } : create; mocks.workspaceMirrors.set(where.workspaceId, next); return next }),
    },
    $transaction: jest.fn(async (callback: any) => callback(require('../db').prisma)),
  },
}))

import { HttpException } from '@nestjs/common'
import { SeltraEngineService } from '../engine/engine.service'

const key = `sk_seltra_${Buffer.alloc(32, 7).toString('base64url')}`
const hash = (value: string) => createHash('sha256').update(process.env.SELTRA_ENGINE_API_KEY_HASH_SALT!).update(':').update(value).digest('hex')
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]).toString('base64')
const identity = { id: 'key-1', workspaceId: 'workspace-1', userId: 'user-1', tenantId: 'tenant-1' }
const creditIdentityToken = (claims = { userId: 'user-1', tenantId: 'tenant-1', expiresAt: Date.now() + 60_000 }) => {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
  return `${payload}.${createHmac('sha256', process.env.CORE_SERVICE_SECRET!).update(payload).digest('base64url')}`
}

function service() {
  return new SeltraEngineService()
}

beforeEach(() => {
  process.env.SELTRA_ENGINE_API_KEY_HASH_SALT = '0123456789abcdef0123456789abcdef'
  process.env.CORE_SERVICE_SECRET = 'core-service-secret-for-test-only'
  process.env.SELTRA_ENGINE_MAX_IMAGES_PER_REQUEST = '2'
  process.env.SELTRA_ENGINE_UPSTREAM_TIMEOUT_MS = '60000'
  process.env.SELTRA_ENGINE_MAX_UPSTREAM_MB = '16'
  process.env.SELTRA_ENGINE_RATE_LIMIT_PER_MINUTE = '60'
  process.env.AI_MODEL_IMAGE = '@cf/test/image'
  process.env.AI_MODEL_VISION = '@cf/test/vision'
  process.env.AI_MODEL_REASONING = '@cf/test/reasoning'
  process.env.CLOUDFLARE_ACCOUNT_ID = 'account-test'
  process.env.CLOUDFLARE_API_TOKEN = 'provider-test-token'
  process.env.SELTRA_ENGINE_STORAGE_DIR = join(tmpdir(), `seltra-engine-test-${process.pid}`)
  mocks.keys = [{ id: 'key-1', workspaceId: 'workspace-1', keyHash: hash(key), revokedAt: null }]
  mocks.usage = []
  mocks.assets = []
  mocks.balance = 100
  mocks.userBalance = 100
  mocks.userLifetimeUsed = 0
  mocks.workspaceMirrors = new Map()
  jest.restoreAllMocks()
  return mkdir(process.env.SELTRA_ENGINE_STORAGE_DIR!, { recursive: true })
})

afterEach(async () => {
  await rm(process.env.SELTRA_ENGINE_STORAGE_DIR!, { recursive: true, force: true })
})

describe('Seltra Engine service', () => {
  it('rejects missing, malformed, wrong, and revoked API keys and accepts the stored hash', async () => {
    const engine = service()
    expect(await engine.authenticate(undefined)).toBeNull()
    expect(await engine.authenticate('Bearer nope')).toBeNull()
    expect(await engine.authenticate(`Bearer sk_seltra_${Buffer.alloc(32, 8).toString('base64url')}`)).toBeNull()
    expect(await engine.authenticate(`Bearer ${key}`)).toEqual({ id: 'key-1', workspaceId: 'workspace-1' })
    mocks.keys[0].revokedAt = new Date()
    expect(await engine.authenticate(`Bearer ${key}`)).toBeNull()
  })

  it('binds Engine billing identity to a signed, unexpired Seltra project claim', async () => {
    const engine = service()
    expect(await engine.authenticate(`Bearer ${key}`, creditIdentityToken())).toEqual(identity)
    expect(await engine.authenticate(`Bearer ${key}`, creditIdentityToken({ userId: 'user-1', tenantId: 'tenant-1', expiresAt: Date.now() - 1 }))).toEqual({ id: 'key-1', workspaceId: 'workspace-1' })
  })

  it('does not fall back to the separate workspace balance when user identity is missing', async () => {
    const fetchMock = jest.spyOn(global, 'fetch')
    await expect(service().generateImages({ id: 'key-1', workspaceId: 'workspace-1' }, { prompt: 'requires a Seltra user' }, 'request-no-identity'))
      .rejects.toMatchObject({ status: 403 })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(mocks.balance).toBe(100)
    expect(mocks.userBalance).toBe(100)
  })

  it('generates and persists an image in the response shape parsed by core', async () => {
    process.env.AI_MODEL_IMAGE = '@cf/black-forest-labs/flux-2-klein-4b'
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({ success: true, result: { image: png } }), { headers: { 'content-type': 'application/json' } }))
    const result = await service().generateImages(identity, { prompt: 'A green glass perfume bottle' }, 'request-1')
    expect(result.data[0].b64_json).toBe(png)
    expect(result.created).toEqual(expect.any(Number))
    expect(mocks.assets).toHaveLength(1)
    expect(mocks.usage).toHaveLength(1)
    expect(mocks.userBalance).toBe(97)
    expect(mocks.userLifetimeUsed).toBe(3)
    expect(mocks.balance).toBe(100)
    expect(mocks.workspaceMirrors.get('user-1')).toMatchObject({ balance: 97, lifetimeGranted: 60000, lifetimeUsed: 3 })
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://api.cloudflare.com/client/v4/accounts/account-test/ai/run/@cf/black-forest-labs/flux-2-klein-4b')
    const requestBody = fetchMock.mock.calls[0][1]?.body as FormData
    expect(requestBody.get('prompt')).toBe('A green glass perfume bottle')
    expect(requestBody.get('width')).toBe('1024')
    expect(requestBody.get('height')).toBe('1024')
  })

  it('accepts binary image responses from Workers AI', async () => {
    const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3])
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(bytes, { headers: { 'content-type': 'image/png' } }))
    const result = await service().generateImages(identity, { prompt: 'binary image' }, 'request-binary')
    expect(Buffer.from(result.data[0].b64_json, 'base64')).toEqual(bytes)
  })

  it('falls back from a 401 primary image model to Cloudflare FLUX Klein', async () => {
    process.env.AI_MODEL_IMAGE = '@cf/primary/image-model'
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, result: { image: png } }), { headers: { 'content-type': 'application/json' } }))

    const result = await service().generateImages(identity, { prompt: 'fallback product image' }, 'request-fallback')

    expect(result.data[0].b64_json).toBe(png)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[1][0])).toBe('https://api.cloudflare.com/client/v4/accounts/account-test/ai/run')
    const fallbackBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body))
    expect(fallbackBody.model).toBe('black-forest-labs/flux-3-image-klein')
    expect(fallbackBody.input.prompt).toBe('fallback product image')
  })

  it('rejects invalid image requests and provider bytes without writing usage', async () => {
    await expect(service().generateImages(identity, { prompt: 'x'.repeat(2049) }, 'request-2')).rejects.toBeInstanceOf(HttpException)
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({ result: { image: Buffer.from('not an image').toString('base64') } }), { headers: { 'content-type': 'application/json' } }))
    await expect(service().generateImages(identity, { prompt: 'bad output' }, 'request-3')).rejects.toBeInstanceOf(HttpException)
    expect(mocks.usage).toHaveLength(0)
    expect(mocks.balance).toBe(100)
    expect(mocks.userBalance).toBe(100)
    expect(mocks.userLifetimeUsed).toBe(0)
    expect(mocks.workspaceMirrors.get('user-1')).toMatchObject({ balance: 100, lifetimeGranted: 60000, lifetimeUsed: 0 })
  })

  it('rejects oversized provider responses and releases reserved credits', async () => {
    process.env.SELTRA_ENGINE_MAX_UPSTREAM_MB = '1'
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response('too large', { headers: { 'content-type': 'image/png', 'content-length': String(2 * 1024 * 1024) } }))
    await expect(service().generateImages(identity, { prompt: 'large response' }, 'request-large'))
      .rejects.toMatchObject({ status: 502 })
    expect(mocks.balance).toBe(100)
    expect(mocks.usage).toHaveLength(0)
  })

  it('rejects image requests without credits before calling the provider', async () => {
    mocks.userBalance = 0
    const fetchMock = jest.spyOn(global, 'fetch')
    await expect(service().generateImages(identity, { prompt: 'needs credits' }, 'request-no-credits')).rejects.toMatchObject({ status: 402 })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(mocks.usage).toHaveLength(0)
    expect(mocks.assets).toHaveLength(0)
    expect(mocks.balance).toBe(100)
  })

  it('returns validated structured vision output and retries malformed JSON once', async () => {
    const valid = JSON.stringify({ summary: 'The home route crashes.', findings: [{ severity: 'critical', issue: 'Provider missing', evidence: 'useShop must be used inside ShopProvider', probableCause: 'Index is rendered outside its provider.', suggestedFix: 'Wrap Index in ShopProvider.', verification: 'Reload the route and confirm the exception is gone.' }] })
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: 'not json' } }], usage: { prompt_tokens: 20, completion_tokens: 10 } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: valid } }], usage: { prompt_tokens: 25, completion_tokens: 40 } })))
    const result = await service().chatCompletions(identity, { model: 'seltra-vision', messages: [{ role: 'user', content: [{ type: 'text', text: 'diagnose' }, { type: 'image_url', image_url: { url: `data:image/png;base64,${png}` } }] }] }, 'request-4')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(JSON.parse((result as any).choices[0].message.content)).toMatchObject({ summary: 'The home route crashes.' })
    expect(mocks.usage).toHaveLength(1)
  })

  it('returns 429-style retry timing for per-key/IP request limiting', () => {
    process.env.SELTRA_ENGINE_RATE_LIMIT_PER_MINUTE = '1'
    const engine = service()
    const identity = { id: 'key-1', workspaceId: 'workspace-1' }
    expect(engine.enforceRateLimit(identity, '127.0.0.1')).toBe(0)
    expect(engine.enforceRateLimit(identity, '127.0.0.1')).toBeGreaterThan(0)
  })
})
