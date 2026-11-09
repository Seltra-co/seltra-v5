import { destroyCoreWorkspace } from '../store/workspace-cleanup'

describe('destroyCoreWorkspace', () => {
  const originalUrl = process.env.CORE_PUBLIC_URL
  const originalSecret = process.env.CORE_SERVICE_SECRET
  const originalFetch = global.fetch

  afterEach(() => {
    process.env.CORE_PUBLIC_URL = originalUrl
    process.env.CORE_SERVICE_SECRET = originalSecret
    global.fetch = originalFetch
    jest.restoreAllMocks()
  })

  it('retries transient gateway errors and succeeds idempotently through Core', async () => {
    process.env.CORE_PUBLIC_URL = 'https://core.example.test'
    process.env.CORE_SERVICE_SECRET = 'test-only-core-service-secret-0123456789'
    global.fetch = jest.fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 })) as typeof fetch

    await destroyCoreWorkspace('0123456789abcdef')

    expect(global.fetch).toHaveBeenCalledTimes(2)
    expect(global.fetch).toHaveBeenLastCalledWith(
      'https://core.example.test/internal/workspaces/destroy',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ workspaceKey: '0123456789abcdef', caller: 'store_delete' }) }),
    )
  })
})
