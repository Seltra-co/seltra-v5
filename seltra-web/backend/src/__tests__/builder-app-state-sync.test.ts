import { JwtService } from '@nestjs/jwt'

const mockTenantFindFirst = jest.fn()
const mockTenantAppUpsert = jest.fn()
const mockAgentEventCreate = jest.fn()
const mockProjectAssetFindMany = jest.fn()
const mockProjectAssetCreateMany = jest.fn()
const mockTx = {
  tenantApp: { upsert: (...args: unknown[]) => mockTenantAppUpsert(...args) },
  agentEvent: { create: (...args: unknown[]) => mockAgentEventCreate(...args) },
  projectAsset: {
    findMany: (...args: unknown[]) => mockProjectAssetFindMany(...args),
    createMany: (...args: unknown[]) => mockProjectAssetCreateMany(...args),
  },
}

jest.mock('../db', () => ({
  prisma: {
    tenant: { findFirst: (...args: unknown[]) => mockTenantFindFirst(...args) },
    $transaction: (callback: (tx: typeof mockTx) => unknown) => callback(mockTx),
  },
}))

jest.mock('../auth/resolve-user', () => ({ resolveUserIdFromAuthorization: jest.fn().mockResolvedValue('user-1') }))

import { BuilderService } from '../builder/builder.service'

describe('builder app-state sync', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = 'builder-app-state-sync-test-secret'
    mockTenantFindFirst.mockReset().mockResolvedValue({ id: 'tenant-1' })
    mockTenantAppUpsert.mockReset().mockResolvedValue({ id: 'app-1', name: 'Catalog' })
    mockAgentEventCreate.mockReset().mockResolvedValue({})
    mockProjectAssetFindMany.mockReset().mockResolvedValue([])
    mockProjectAssetCreateMany.mockReset().mockResolvedValue({ count: 0 })
  })

  it('persists blueprint visuals in one batched write', async () => {
    const jwt = new JwtService()
    const token = await jwt.signAsync({ sub: 'user-1' }, { secret: process.env.JWT_SECRET })
    const service = new BuilderService(jwt, {} as never)

    await service.syncCoreAppState(token, {
      tenantId: 'tenant-1',
      coreAppId: 7,
      blueprint: {
        visuals: [
          { id: 'hero', type: 'image', prompt: 'Hero image' },
          { id: 'collection', type: 'image', prompt: 'Collection image' },
          { id: 'hero', type: 'image', prompt: 'Duplicate hero' },
        ],
      },
    })

    expect(mockProjectAssetFindMany).toHaveBeenCalledTimes(1)
    expect(mockProjectAssetCreateMany).toHaveBeenCalledTimes(1)
    expect(mockProjectAssetCreateMany).toHaveBeenCalledWith({
      data: [
        { projectId: 'tenant-1', kind: 'image', prompt: 'Hero image', storageRef: 'core:7:hero' },
        { projectId: 'tenant-1', kind: 'image', prompt: 'Collection image', storageRef: 'core:7:collection' },
      ],
    })
  })
})
