import { createHash, createHmac } from 'node:crypto'
import { JwtService } from '@nestjs/jwt'

const mocks = {
  tenant: { id: 'tenant-1', ownerId: 'user-1', creditWorkspaceId: 'user-1', coreWorkspaceKey: 'core-key-1', slug: 'rush-grab', status: 'active', owner: { plan: 'free', email: 'builder@example.test' } },
  keys: [] as Array<Record<string, any>>,
  workspaceUpserts: [] as unknown[],
}

jest.mock('../db', () => ({
  prisma: {
    tenant: {
      findUnique: jest.fn(async () => mocks.tenant),
      findFirst: jest.fn(async () => ({ ...mocks.tenant })),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    workspaceCredit: {
      upsert: jest.fn(async (args: unknown) => { mocks.workspaceUpserts.push(args); return {} }),
    },
    seltraEngineApiKey: {
      findFirst: jest.fn(async ({ where }: any) => mocks.keys.find((key) => key.tenantId === where.tenantId && key.revokedAt === null) ?? null),
      findMany: jest.fn(async () => mocks.keys.filter((key) => key.revokedAt === null)),
      updateMany: jest.fn(async ({ where, data }: any) => {
        for (const key of mocks.keys) if (key.tenantId === where.tenantId && key.revokedAt === null) key.revokedAt = data.revokedAt
        return { count: 1 }
      }),
      update: jest.fn(async () => ({})),
      create: jest.fn(async ({ data }: any) => { const key = { id: `key-${mocks.keys.length + 1}`, ...data, revokedAt: null }; mocks.keys.push(key); return key }),
    },
  },
}))

import { SeltraEngineService } from '../engine/engine.service'
import { decryptEngineApiKey, hashEngineApiKey, provisionEngineKey } from '../engine/engine-key'
import { BuilderService } from '../builder/builder.service'

const creditIdentity = () => {
  const claims = { userId: 'user-1', tenantId: 'tenant-1', expiresAt: Date.now() + 60_000 }
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
  const signature = createHmac('sha256', process.env.CORE_SERVICE_SECRET!).update(payload).digest('base64url')
  return `${payload}.${signature}`
}

beforeEach(() => {
  process.env.SELTRA_ENGINE_API_KEY_HASH_SALT = '0123456789abcdef0123456789abcdef'
  process.env.ENGINE_KEY_ENCRYPTION_SECRET = 'test-encryption-secret-0123456789abcdef'
  process.env.CORE_SERVICE_SECRET = 'core-service-secret-for-test-only'
  process.env.CORE_TOKEN_SECRET = 'core-token-secret-for-websocket-ticket-tests'
  process.env.JWT_SECRET = 'session-jwt-secret-for-websocket-ticket-tests'
  mocks.tenant = { id: 'tenant-1', ownerId: 'user-1', creditWorkspaceId: 'user-1', coreWorkspaceKey: 'core-key-1', slug: 'rush-grab', status: 'active', owner: { plan: 'free', email: 'builder@example.test' } }
  mocks.keys = []
  mocks.workspaceUpserts = []
})

describe('workspace Engine keys', () => {
  it('issues and redeems a signed websocket ticket through the Backend service flow', async () => {
    const jwt = new JwtService()
    const credits = {
      ensureAccount: jest.fn(async () => ({ windowAllowance: 100, balance: 100 })),
      getAccountSnapshot: jest.fn(async () => ({ windowAllowance: 100, balance: 100 })),
    }
    const builder = new BuilderService(jwt, credits as never)
    const sessionToken = await jwt.signAsync(
      { sub: 'user-1' },
      { secret: process.env.JWT_SECRET },
    )

    const issued = await builder.createWsTicket(
      `Bearer ${sessionToken}`,
      'tenant-1',
    )
    const redeemed = await builder.redeemWsTicket(issued.ticket)

    expect(issued.expiresIn).toBe(30)
    expect(redeemed).toMatchObject({
      workspaceId: 'tenant-1',
      userId: 'user-1',
      coreWorkspaceKey: 'core-key-1',
      storeSlug: 'rush-grab',
      email: 'builder@example.test',
      plan: 'free',
    })
    expect(redeemed.engineApiKey).toMatch(/^sk_seltra_[A-Za-z0-9_-]{40,}$/)
    await expect(builder.redeemWsTicket(issued.ticket)).rejects.toThrow(
      'Invalid websocket ticket.',
    )
  })

  it('provisions an idempotent tenant-scoped key encrypted at rest and accepted by Engine auth', async () => {
    const key = await provisionEngineKey('tenant-1')
    const stored = mocks.keys[0]
    expect(key).toMatch(/^sk_seltra_[A-Za-z0-9_-]{40,}$/)
    expect(stored).toMatchObject({
      tenantId: 'tenant-1',
      workspaceId: 'user-1',
      label: 'rush-grab',
      keyHash: createHash('sha256').update(process.env.SELTRA_ENGINE_API_KEY_HASH_SALT!).update(':').update(key).digest('hex'),
    })
    expect(stored.encryptedKey).not.toContain(key)
    expect(decryptEngineApiKey(stored.encryptedKey)).toBe(key)
    expect(await provisionEngineKey('tenant-1')).toBe(key)
    expect(mocks.keys).toHaveLength(1)

    const engine = new SeltraEngineService()
    await expect(engine.authenticate(`Bearer ${key}`, creditIdentity())).resolves.toMatchObject({
      id: stored.id,
      workspaceId: 'user-1',
      tenantId: 'tenant-1',
      userId: 'user-1',
    })
    await expect(engine.authenticate(`Bearer ${key}`, (() => {
      const payload = Buffer.from(JSON.stringify({ userId: 'user-1', tenantId: 'other-tenant', expiresAt: Date.now() + 60_000 })).toString('base64url')
      return `${payload}.${createHmac('sha256', process.env.CORE_SERVICE_SECRET!).update(payload).digest('base64url')}`
    })())).resolves.toBeNull()
  })

  it('rejects encrypted key tampering', () => {
    const encrypted = 'v1.invalid.invalid.invalid'
    expect(() => decryptEngineApiKey(encrypted)).toThrow()
    expect(() => hashEngineApiKey('sk_seltra_test', 'short')).toThrow()
  })

  it('accepts tenant and credit-account IDs for owned usage, but rejects unrelated IDs', async () => {
    const credits = { commitUsage: jest.fn(async () => undefined) }
    const builder = new BuilderService({} as never, credits as never)
    await expect(builder.reportUsage({
      tenantId: 'tenant-1', workspaceId: 'tenant-1', userId: 'user-1',
      role: 'default', tokensIn: 4, tokensOut: 2, ok: true,
    })).resolves.toEqual({ recorded: true })
    expect(credits.commitUsage).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1', projectId: 'tenant-1' }))
    await expect(builder.reportUsage({
      tenantId: 'tenant-1', workspaceId: 'some-other-account', userId: 'user-1',
      role: 'default', tokensIn: 4, tokensOut: 2, ok: true,
    })).rejects.toThrow('The reported credit account does not match the authenticated user.')
  })
})
