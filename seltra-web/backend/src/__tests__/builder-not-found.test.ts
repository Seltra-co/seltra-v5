import { JwtService } from '@nestjs/jwt'
import { NotFoundException } from '@nestjs/common'

const mockFindFirst = jest.fn()
const mockFindMany = jest.fn()

jest.mock('../db', () => ({
  prisma: {
    tenant: { findFirst: (...args: unknown[]) => mockFindFirst(...args) },
    tenantApp: { findMany: (...args: unknown[]) => mockFindMany(...args) },
  },
}))

import { BuilderService } from '../builder/builder.service'

describe('builder workspace lookup not found responses', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = 'builder-not-found-tests-jwt-secret'
    mockFindFirst.mockReset().mockResolvedValue(null)
    mockFindMany.mockReset()
  })

  it('returns 404 for app list lookup using a project ID that is not an owned tenant ID', async () => {
    const jwt = new JwtService()
    const token = await jwt.signAsync({ sub: 'user-1' }, { secret: process.env.JWT_SECRET })
    const service = new BuilderService(jwt, {} as never)
    await expect(service.listApps(`Bearer ${token}`, 'project-id-not-a-tenant')).rejects.toBeInstanceOf(NotFoundException)
  })

  it('returns 404 for app state sync using a project ID that is not an owned tenant ID', async () => {
    const jwt = new JwtService()
    const token = await jwt.signAsync({ sub: 'user-1' }, { secret: process.env.JWT_SECRET })
    const service = new BuilderService(jwt, {} as never)
    await expect(service.syncCoreAppState(`Bearer ${token}`, { tenantId: 'project-id-not-a-tenant', coreAppId: 1 })).rejects.toBeInstanceOf(NotFoundException)
  })
})
