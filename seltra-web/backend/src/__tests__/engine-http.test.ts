import { Module, RequestMethod, type INestApplication } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { SeltraEngineController } from '../engine/engine.controller'
import { SeltraEngineService } from '../engine/engine.service'

const engineMock = {
  authenticate: jest.fn(async (header?: string) => header === 'Bearer valid-key' ? { id: 'key-1', workspaceId: 'workspace-1' } : null),
  enforceRateLimit: jest.fn(() => 0),
  models: jest.fn(() => ({ object: 'list', data: [] })),
  chatCompletions: jest.fn(async () => ({ id: 'chat-1', choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] })),
  proxyChat: jest.fn(async () => ({ id: 'chat-2', choices: [{ message: { role: 'assistant', content: 'streamed' }, finish_reason: 'stop' }] })),
  generateImages: jest.fn(async () => ({ created: 1, data: [{ b64_json: 'abc' }] })),
  assetFile: jest.fn(async () => null),
}

@Module({
  controllers: [SeltraEngineController],
  providers: [{ provide: SeltraEngineService, useValue: engineMock }],
})
class EngineHttpTestModule {}

describe('Seltra Engine HTTP contract', () => {
  let app: INestApplication
  let baseUrl: string

  beforeAll(async () => {
    app = await NestFactory.create(EngineHttpTestModule, { logger: false })
    app.setGlobalPrefix('api/v5', { exclude: [{ path: 'v1/(.*)', method: RequestMethod.ALL }] })
    await app.listen(0, '127.0.0.1')
    const address = app.getHttpServer().address() as { port: number }
    baseUrl = `http://127.0.0.1:${address.port}`
  })
  afterAll(async () => app.close())

  it('serves unauthenticated health and echoes a request id', async () => {
    const response = await fetch(`${baseUrl}/v1/health`, { headers: { 'X-Request-ID': 'health-1' } })
    expect(response.status).toBe(200)
    expect(response.headers.get('x-request-id')).toBe('health-1')
    expect(await response.json()).toMatchObject({ status: 'ok', service: 'seltra-engine', request_id: 'health-1' })
  })

  it('rejects unauthenticated protected endpoints and returns explicit 501 for unsupported tools', async () => {
    const missing = await fetch(`${baseUrl}/v1/images/generations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: 'test' }) })
    expect(missing.status).toBe(401)
    expect((await missing.json() as any).error.code).toBe('invalid_api_key')
    const unsupported = await fetch(`${baseUrl}/v1/tools/web-search`, { method: 'POST', headers: { Authorization: 'Bearer valid-key', 'Content-Type': 'application/json' }, body: JSON.stringify({ query: 'test' }) })
    expect(unsupported.status).toBe(501)
    expect((await unsupported.json() as any).error.code).toBe('not_implemented')
  })

  it('returns JSON completions or OpenAI-compatible SSE for streaming callers', async () => {
    const headers = { Authorization: 'Bearer valid-key', 'Content-Type': 'application/json' }
    const json = await fetch(`${baseUrl}/v1/chat/completions`, { method: 'POST', headers, body: JSON.stringify({ model: 'seltra-vision', messages: [{ role: 'user', content: 'hello' }] }) })
    expect(json.status).toBe(200)
    expect((await json.json() as any).choices[0].message.content).toBe('ok')
    const stream = await fetch(`${baseUrl}/v1/chat/completions`, { method: 'POST', headers, body: JSON.stringify({ model: 'seltra-default', stream: true, messages: [{ role: 'user', content: 'hello' }] }) })
    expect(stream.headers.get('content-type')).toContain('text/event-stream')
    const text = await stream.text()
    expect(text).toContain('"content":"streamed"')
    expect(text).toContain('data: [DONE]')
  })
})
