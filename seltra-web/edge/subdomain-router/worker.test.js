import test, { beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import worker, { routeCache } from './worker.js'

const originalFetch = globalThis.fetch
let calls
let route

beforeEach(() => {
  calls = []
  route = undefined
  routeCache.clear()
})
afterEach(() => { globalThis.fetch = originalFetch })

function env() {
  return { ROUTES: { async get(key) { assert.equal(key, 'routes/shop.json'); return route ? { json: async () => route } : null } } }
}
function validRoute(overrides = {}) {
  return { slug: 'shop', tenantId: 'tenant_1', appId: 'app_1', origin: 'shop-abc123.vercel.app', deploymentId: 'dep_123456', vercelDeploymentId: 'dpl_12345678', sha: 'a'.repeat(40), updatedAt: new Date().toISOString(), ...overrides }
}

test('non-seltra host passes through without rewriting', async () => {
  globalThis.fetch = async (request) => { calls.push(request.url); return new Response('ok') }
  await worker.fetch(new Request('https://elsewhere.example/a'), env())
  assert.deepEqual(calls, ['https://elsewhere.example/a'])
})

test('reserved and invalid subdomains keep the legacy mapping', async () => {
  globalThis.fetch = async (request) => { calls.push(request.url); return new Response('legacy') }
  await worker.fetch(new Request('https://dashboard.seltra.co/'), env())
  assert.equal(calls[0], 'https://seltra-merchant.vercel.app/')
  await worker.fetch(new Request('https://bad_slug.seltra.co/a?b=1'), env())
  assert.equal(calls[1], 'https://seltra-merchant.vercel.app/store/bad_slug/a?b=1')
})

test('missing or invalid slug-mismatch route falls back to the legacy store path', async () => {
  globalThis.fetch = async (request) => { calls.push(request.url); return new Response('legacy') }
  route = validRoute({ slug: 'someone-else' })
  await worker.fetch(new Request('https://shop.seltra.co/products'), env())
  assert.equal(calls[0], 'https://seltra-merchant.vercel.app/store/shop/products')
})

test('route proxy streams response, rewrites redirects/cookies and strips provider headers', async () => {
  route = validRoute()
  globalThis.fetch = async (request, options) => {
    calls.push({ url: request.url, options, headers: request.headers })
    const headers = new Headers({ 'content-type': 'text/html', 'x-vercel-id': 'private', 'x-matched-path': '/hidden', location: 'https://shop-abc123.vercel.app/login?next=%2F', 'x-seltra-deployment': 'forged' })
    headers.append('set-cookie', 'a=1; Domain=.seltra.co; Path=/; Secure')
    headers.append('set-cookie', 'b=2; domain=seltra.co; HttpOnly')
    return new Response('app body', { status: 200, headers })
  }
  const request = new Request('https://shop.seltra.co/products?q=1', { headers: { 'x-vercel-client': 'forged', 'x-seltra-internal': 'forged', 'x-forwarded-for': '198.51.100.99', 'x-real-ip': '198.51.100.99', forwarded: 'for=198.51.100.99', 'cf-connecting-ip': '203.0.113.8' } })
  const response = await worker.fetch(request, env())
  assert.equal(calls[0].url, 'https://shop-abc123.vercel.app/products?q=1')
  assert.equal(calls[0].options.redirect, 'manual')
  assert.equal(calls[0].headers.get('x-vercel-client'), null)
  assert.equal(calls[0].headers.get('x-seltra-internal'), null)
  assert.equal(calls[0].headers.get('x-forwarded-host'), 'shop.seltra.co')
  assert.equal(calls[0].headers.get('x-forwarded-for'), '203.0.113.8')
  assert.equal(calls[0].headers.get('x-real-ip'), '203.0.113.8')
  assert.equal(calls[0].headers.get('forwarded'), null)
  assert.equal(await response.text(), 'app body')
  assert.equal(response.headers.get('x-vercel-id'), null)
  assert.equal(response.headers.get('x-matched-path'), null)
  assert.equal(response.headers.get('x-seltra-deployment'), 'dep_123456')
  assert.equal(response.headers.get('location'), 'https://shop.seltra.co/login?next=%2F')
  const cookies = response.headers.getSetCookie()
  assert.equal(cookies.length, 2)
  assert.ok(cookies.every((cookie) => !/domain=/i.test(cookie)))
})

test('upstream failures and Vercel deployment errors return a generic no-store 503', async () => {
  route = validRoute()
  globalThis.fetch = async () => { throw new Error('internal upstream URL should not be reflected') }
  let response = await worker.fetch(new Request('https://shop.seltra.co/'), env())
  assert.equal(response.status, 503)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.doesNotMatch(await response.text(), /vercel\.app|internal upstream/)
  globalThis.fetch = async () => new Response('private', { status: 404, headers: { 'x-vercel-error': 'DEPLOYMENT_NOT_FOUND' } })
  response = await worker.fetch(new Request('https://shop.seltra.co/'), env())
  assert.equal(response.status, 503)
})

test('HEAD and bodyless upstream statuses do not construct invalid response bodies', async () => {
  route = validRoute()
  globalThis.fetch = async (request) => new Response(null, { status: request.method === 'HEAD' ? 200 : 204 })
  const head = await worker.fetch(new Request('https://shop.seltra.co/', { method: 'HEAD' }), env())
  const noContent = await worker.fetch(new Request('https://shop.seltra.co/', { method: 'GET' }), env())
  assert.equal(head.status, 200)
  assert.equal(noContent.status, 204)
  assert.equal(noContent.body, null)
})

test('routed POST requests preserve their streaming body and method', async () => {
  route = validRoute()
  globalThis.fetch = async (request) => {
    calls.push({ method: request.method, body: await request.text() })
    return new Response('ok')
  }
  await worker.fetch(new Request('https://shop.seltra.co/api/orders', { method: 'POST', body: '{"item":"tea"}', headers: { 'content-type': 'application/json' } }), env())
  assert.deepEqual(calls[0], { method: 'POST', body: '{"item":"tea"}' })
})

test('legacy fallback strips spoofed control/forwarding headers and sanitizes provider response headers/cookies', async () => {
  globalThis.fetch = async (request) => {
    calls.push({ seltra: request.headers.get('x-seltra-admin'), vercel: request.headers.get('x-vercel-client'), forwarded: request.headers.get('x-forwarded-for') })
    return new Response('legacy', { headers: { 'x-vercel-id': 'private', 'x-seltra-deployment': 'forged', 'set-cookie': 'session=1; Domain=.seltra.co; Path=/' } })
  }
  const response = await worker.fetch(new Request('https://shop.seltra.co/', { headers: { 'x-seltra-admin': 'forged', 'x-vercel-client': 'forged', 'x-forwarded-for': '198.51.100.99' } }), env())
  assert.deepEqual(calls[0], { seltra: null, vercel: null, forwarded: null })
  assert.equal(response.headers.get('x-vercel-id'), null)
  assert.equal(response.headers.get('x-seltra-deployment'), null)
  assert.doesNotMatch(response.headers.get('set-cookie') || '', /domain=/i)
})
