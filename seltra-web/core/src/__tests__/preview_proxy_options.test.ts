import { createRequire } from 'node:module'
import * as http from 'node:http'
import { resolve } from 'node:path'
import { previewProxyOptions } from '../../server/src/preview_proxy_options'

const requireFromServer = createRequire(resolve(process.cwd(), 'server', 'package.json'))
const httpProxy = requireFromServer('http-proxy') as any

async function proxyHostFor(options: ReturnType<typeof previewProxyOptions>, browserHost: string) {
  let receivedHost = ''
  const upstream = http.createServer((request, response) => {
    receivedHost = request.headers.host ?? ''
    response.end('ok')
  })
  const proxy = httpProxy.createProxyServer({ changeOrigin: false })
  const frontend = http.createServer((request, response) => proxy.web(request, response, options))
  await Promise.all([listen(upstream), listen(frontend)])
  const targetPort = (upstream.address() as { port: number }).port
  const frontendPort = (frontend.address() as { port: number }).port
  const proxyOptions = { ...options, target: `http://127.0.0.1:${targetPort}` }
  // Recreate the server with the actual ephemeral target so the same options used by Core are exercised.
  frontend.removeAllListeners('request')
  frontend.on('request', (request, response) => proxy.web(request, response, proxyOptions))
  try {
    await new Promise<void>((resolve, reject) => {
      const request = http.request({ host: '127.0.0.1', port: frontendPort, headers: { host: browserHost } }, (response) => {
        response.resume()
        response.once('end', resolve)
      })
      request.once('error', reject)
      request.end()
    })
    return { receivedHost, targetHost: `127.0.0.1:${targetPort}` }
  } finally {
    proxy.close()
    await Promise.all([close(frontend), close(upstream)])
  }
}

function listen(server: http.Server) {
  return new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
}

function close(server: http.Server) {
  return new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
}

describe('preview proxy options', () => {
  it('uses the remote target Host and enables TLS verification', async () => {
    const options = previewProxyOptions('http://127.0.0.1:1', true)
    expect(options).toMatchObject({ changeOrigin: true, secure: true })
    const received = await proxyHostFor(options, 'ws-workspace-app-7.localhost:8080')
    expect(received.receivedHost).toBe(received.targetHost)
  })

  it('preserves the local preview Host override', async () => {
    const localHost = 'app-7.localhost:5173'
    const options = previewProxyOptions('http://127.0.0.1:1', false, { host: localHost })
    const received = await proxyHostFor(options, 'ws-workspace-app-7.localhost:8080')
    expect(received.receivedHost).toBe(localHost)
    expect(options).not.toHaveProperty('changeOrigin')
  })
})
