const mockProjectFiles = new Map<string, { path: string; contentHash: string; inlineContent?: string }>()
const mockApp = { id: 1, coreAppId: 7, corePath: '/workspace/apps/catalog', name: 'Catalog' }
const mockProjectFileFindMany = jest.fn(async (args?: { where?: { path?: { in?: string[] } }; select?: Record<string, boolean> }) => {
  const requested = args?.where?.path?.in
  const rows = [...mockProjectFiles.values()].filter((file) => !requested || requested.includes(file.path))
  return args?.select && !args.select.inlineContent ? rows.map(({ path, contentHash }) => ({ path, contentHash })) : rows
})
const mockProjectFileUpsert = jest.fn(async ({ where, create, update }: { where: { projectId_path: { path: string } }; create: { path: string; contentHash: string; inlineContent?: string }; update: { contentHash: string; inlineContent?: string } }) => {
  const old = mockProjectFiles.get(where.projectId_path.path)
  mockProjectFiles.set(where.projectId_path.path, { ...old, ...(old ? update : create), path: where.projectId_path.path })
})
const mockRunEventCreate = jest.fn()
const mockProjectAssetCreate = jest.fn()
const mockProjectAssetFindFirst = jest.fn().mockResolvedValue(null)
const mockProjectAssetUpdate = jest.fn()
const mockTx = {
  runEvent: { findUnique: jest.fn().mockResolvedValue(null), create: mockRunEventCreate },
  tenantApp: { findUnique: jest.fn().mockResolvedValue(mockApp) },
  projectFile: { upsert: mockProjectFileUpsert },
  projectAsset: { findFirst: mockProjectAssetFindFirst, update: mockProjectAssetUpdate },
  $queryRaw: jest.fn().mockResolvedValue([{ lastEventSeq: 1 }]),
}
const mockTransaction = jest.fn((callback: (tx: typeof mockTx) => unknown, _options?: unknown) => callback(mockTx))

jest.mock('../db', () => ({
  prisma: {
    run: {
      findUnique: jest.fn().mockResolvedValue({ id: 'run-1', projectId: 'tenant-1' }),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    tenant: { findFirst: jest.fn().mockResolvedValue({ id: 'tenant-1' }) },
    tenantApp: {
      findUnique: jest.fn().mockResolvedValue(mockApp),
      findMany: jest.fn().mockResolvedValue([mockApp]),
    },
    projectFile: { findMany: (...args: unknown[]) => mockProjectFileFindMany(...args as Parameters<typeof mockProjectFileFindMany>), upsert: (...args: unknown[]) => mockProjectFileUpsert(...args as Parameters<typeof mockProjectFileUpsert>) },
    projectAsset: { findMany: jest.fn().mockResolvedValue([]), create: mockProjectAssetCreate, findFirst: mockProjectAssetFindFirst, update: mockProjectAssetUpdate },
    fileBlob: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
    projectSnapshot: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn() },
    $transaction: (callback: (tx: typeof mockTx) => unknown, options?: unknown) => mockTransaction(callback, options),
  },
}))
jest.mock('../auth/resolve-user', () => ({ resolveUserIdFromAuthorization: jest.fn().mockResolvedValue('user-1') }))

import { RunService } from '../build/run.service'
import { BuilderService } from '../builder/builder.service'

const contentHash = (content: string) => require('node:crypto').createHash('sha256').update(content).digest('hex') as string

describe('workspace file keys and verification evidence', () => {
  beforeEach(() => {
    mockProjectFiles.clear()
    mockProjectFileUpsert.mockClear()
    mockProjectFileFindMany.mockClear()
    mockProjectAssetCreate.mockClear()
    mockProjectAssetFindFirst.mockReset().mockResolvedValue(null)
    mockProjectAssetUpdate.mockReset()
    mockTransaction.mockClear()
    mockTx.runEvent.findUnique.mockReset().mockResolvedValue(null)
    mockTx.runEvent.create.mockReset()
    mockTx.$queryRaw.mockReset().mockResolvedValue([{ lastEventSeq: 1 }])
    mockTx.tenantApp.findUnique.mockReset().mockResolvedValue(mockApp)
  })

  it('deduplicates file.written evidence and a sync of the same bytes into one project file row', async () => {
    const content = 'export default function Index() { return null }'
    const path = 'apps/catalog/src/pages/Index.tsx'
    const run = new RunService({} as never)
    const builder = new BuilderService({} as never, {} as never)

    await run.append('run-1', { type: 'file.written', payload: { appId: 7, path: 'src/pages/Index.tsx', bytes: Buffer.byteLength(content), sha256: contentHash(content) } }, 'Bearer test')
    await builder.syncWorkspaceFiles({ tenantId: 'tenant-1', files: [{ path, content }] })

    expect([...mockProjectFiles.keys()]).toEqual([path])
    expect(mockProjectFileUpsert).toHaveBeenCalledTimes(1)
    expect(mockTransaction.mock.calls[0]?.[1]).toEqual({ maxWait: 10_000, timeout: 20_000 })
  })

  it('counts an uppercase pages/Index.tsx route as routed', async () => {
    const files = [
      { path: 'apps/catalog/package.json', content: JSON.stringify({ scripts: { dev: 'vite', build: 'vite build' } }) },
      { path: 'apps/catalog/src/pages/Index.tsx', content: 'export default function Index() { return null }' },
    ]
    for (const file of files) mockProjectFiles.set(file.path, { path: file.path, inlineContent: file.content, contentHash: contentHash(file.content) })
    mockProjectFileFindMany.mockImplementationOnce(async () => [...mockProjectFiles.values()])
    const builder = new BuilderService({} as never, {} as never)

    const result = await builder.verifyWorkspaceFiles({ tenantId: 'tenant-1', files: [...mockProjectFiles.values()].map((file) => ({ path: file.path, sha256: file.contentHash })) })

    expect(result.pagesRouted).toBe(true)
  })

  it('accepts a Vite main.tsx importing App.tsx as routed', async () => {
    const files = [
      { path: 'apps/catalog/package.json', content: JSON.stringify({ scripts: { dev: 'vite', build: 'vite build' } }) },
      { path: 'apps/catalog/src/main.tsx', content: "import App from './App'; import { createRoot } from 'react-dom/client'; createRoot(document.getElementById('root')!).render(<App />)" },
      { path: 'apps/catalog/src/App.tsx', content: 'export default function App() { return null }' },
    ]
    for (const file of files) mockProjectFiles.set(file.path, { path: file.path, inlineContent: file.content, contentHash: contentHash(file.content) })
    mockProjectFileFindMany.mockImplementationOnce(async () => [...mockProjectFiles.values()])
    const builder = new BuilderService({} as never, {} as never)

    const result = await builder.verifyWorkspaceFiles({ tenantId: 'tenant-1', files: [...mockProjectFiles.values()].map((file) => ({ path: file.path, sha256: file.contentHash })) })

    expect(result.pagesRouted).toBe(true)
    expect(result.verified).toBe(true)
  })

  it('syncs QA screenshots as files without registering them as generated merchant assets', async () => {
    const builder = new BuilderService({} as never, {} as never)
    const content = Buffer.from('png-bytes').toString('base64')
    await builder.syncWorkspaceFiles({ tenantId: 'tenant-1', coreAppId: 7, files: [{ path: 'apps/catalog/.dyad/media/qa-screenshot.png', content: `base64:${content}` }] })

    expect(mockProjectFiles.has('apps/catalog/.dyad/media/qa-screenshot.png')).toBe(true)
    expect(mockProjectAssetCreate).not.toHaveBeenCalled()
  })

  it('persists regenerated image outcomes only for the active slot and safe asset paths', async () => {
    mockProjectAssetFindFirst.mockResolvedValue({ id: 'asset-1', status: 'generating' })
    mockProjectAssetUpdate.mockResolvedValue({ id: 'asset-1', status: 'generated' })
    const builder = new BuilderService({} as never, {} as never)

    await builder.completeAssetRetry('Bearer user-token', 'tenant-1', '7', 'hero', { status: 'generated', url: 'public/assets/hero-2.webp' })

    expect(mockProjectAssetUpdate).toHaveBeenCalledWith({
      where: { id: 'asset-1' },
      data: { status: 'generated', sourceUrl: 'public/assets/hero-2.webp', license: null, attribution: null, error: null },
    })
    await expect(builder.completeAssetRetry('Bearer user-token', 'tenant-1', '7', 'hero', { status: 'generated', url: 'https://example.test/hero.png' }))
      .rejects.toThrow('Generated asset result is invalid.')
  })

  it('accepts browser QA evidence with clean arrays and a valid persisted screenshot', async () => {
    const run = new RunService({} as never)
    const events = [
      { type: 'build.result', payload: { executed: true, exitCode: 0 } },
      { type: 'browser.qa', payload: { status: 'passed', consoleErrors: [], failedRequests: [], screenshotPath: '.dyad/media/qa-screenshot.png', screenshotBytes: 8, screenshotSha256: contentHash('png-bytes') } },
      { type: 'manifest.verified', payload: { verified: true, pagesRouted: true, assetsVerified: true, packageScriptsValid: true, mismatches: [] } },
      { type: 'preview.ready', payload: { status: 200, previewUrl: 'https://preview.example.test/' } },
    ]
    const tx = {
      runEvent: { findMany: jest.fn().mockResolvedValue(events) },
      tenantApp: { findMany: jest.fn().mockResolvedValue([{ status: 'preview_ready', previewUrl: 'https://preview.example.test/' }]) },
      projectFile: { count: jest.fn().mockResolvedValue(1) },
      projectAsset: { findMany: jest.fn().mockResolvedValue([]) },
    }

    const failures = await (run as any).completionFailures(tx, 'run-1', 'tenant-1') as string[]
    expect(failures).not.toContain('browser.qa must record a clean browser result and a saved screenshot')
  })

  it('allows degraded completion only with preview/build proof and a documented image fallback', async () => {
    const run = new RunService({} as never)
    const events = [
      { type: 'build.result', payload: { executed: true, exitCode: 0 } },
      { type: 'browser.qa', payload: { status: 'passed', consoleErrors: [], failedRequests: [], screenshotPath: '.dyad/media/qa-screenshot.png', screenshotBytes: 8, screenshotSha256: contentHash('png-bytes') } },
      { type: 'manifest.verified', payload: { verified: true, pagesRouted: true, assetsVerified: true, packageScriptsValid: true, mismatches: [] } },
      { type: 'preview.ready', payload: { status: 200, previewUrl: 'https://preview.example.test/' } },
      { type: 'asset.updated', payload: { slot: 'hero', state: 'fallback' } },
    ]
    const tx = {
      runEvent: { findMany: jest.fn().mockResolvedValue(events) },
      tenantApp: { findMany: jest.fn().mockResolvedValue([{ status: 'preview_ready', previewUrl: 'https://preview.example.test/' }]) },
      projectFile: { count: jest.fn().mockResolvedValue(1) },
      projectAsset: { findMany: jest.fn().mockResolvedValue([{ status: 'fallback', sourceUrl: 'data:image/svg+xml,...' }]) },
    }

    await expect((run as any).completionFailures(tx, 'run-1', 'tenant-1', true)).resolves.toEqual([])
    await expect((run as any).completionFailures({ ...tx, runEvent: { findMany: jest.fn().mockResolvedValue(events.slice(0, -1)) } }, 'run-1', 'tenant-1', true))
      .resolves.toContain('degraded completion must document a placeholder image or unavailable browser QA')

    const unavailableQaEvents = events.slice(0, -1).map((event) => event.type === 'browser.qa'
      ? { ...event, payload: { status: 'unavailable' } }
      : event)
    await expect((run as any).completionFailures({ ...tx, runEvent: { findMany: jest.fn().mockResolvedValue(unavailableQaEvents) } }, 'run-1', 'tenant-1', true))
      .resolves.toEqual([])

    const missingProof = await (run as any).completionFailures({
      ...tx,
      runEvent: { findMany: jest.fn().mockResolvedValue([{ type: 'asset.updated', payload: { slot: 'hero', state: 'fallback' } }]) },
      tenantApp: { findMany: jest.fn().mockResolvedValue([]) },
      projectFile: { count: jest.fn().mockResolvedValue(0) },
    }, 'run-1', 'tenant-1', true) as string[]
    expect(missingProof).toContain('build.result must record an executed build with exitCode 0')
    expect(missingProof).toContain('manifest.verified must confirm routes, referenced assets, package scripts, and a clean workspace diff')
    expect(missingProof).toContain('the run has no persisted file manifest rows')
    expect(missingProof).toContain('preview.ready must record HTTP 200 and a preview URL')
  })
})
