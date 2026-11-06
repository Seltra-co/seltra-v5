const ROOT_DOMAIN = 'seltra.co'
const LEGACY_ORIGIN = 'https://seltra-merchant.vercel.app'
const RESERVED = new Set([
  'www', 'web', 'api', 'admin', 'app', 'mail', 'send', 'dashboard', 'login', 'auth',
  'status', 'help', 'support', 'blog', 'cdn', 'assets', 'static',
])
const STATIC_PREFIXES = ['/_next/', '/favicon.ico', '/manifest.webmanifest', '/robots.txt', '/sitemap.xml']
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/
const ORIGIN_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.vercel\.app$/
const DEPLOYMENT_RE = /^[A-Za-z0-9_-]{6,80}$/
const ROUTE_TTL_MS = 5_000
const ROUTE_CACHE_MAX = 500
const routeCache = new Map()

function normalizeOrigin(value) {
  if (typeof value !== 'string') return null
  const host = value.toLowerCase()
  return ORIGIN_RE.test(host) ? host : null
}

function validateRoute(value, slug) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const origin = normalizeOrigin(value.origin)
  if (!origin || value.slug !== slug || !DEPLOYMENT_RE.test(String(value.deploymentId || ''))) return null
  if (typeof value.tenantId !== 'string' || !value.tenantId || typeof value.appId !== 'string' || !value.appId) return null
  if (typeof value.vercelDeploymentId !== 'string' || !/^dpl_[A-Za-z0-9_-]{6,80}$/.test(value.vercelDeploymentId)) return null
  if (typeof value.sha !== 'string' || !/^[a-f0-9]{40,64}$/i.test(value.sha)) return null
  return { ...value, origin }
}

async function getRoute(env, slug) {
  const now = Date.now()
  const cached = routeCache.get(slug)
  if (cached && now - cached.at < ROUTE_TTL_MS) return cached.value
  let value = null
  try {
    const object = await env.ROUTES.get(`routes/${slug}.json`)
    if (object) value = validateRoute(await object.json(), slug)
  } catch {
    value = null
  }
  if (routeCache.size >= ROUTE_CACHE_MAX) routeCache.clear()
  routeCache.set(slug, { value, at: now })
  return value
}

function unavailable() {
  return new Response('<!doctype html><meta charset="utf-8"><title>Temporarily unavailable</title><body style="font-family:system-ui;text-align:center;padding:4rem"><h1>This store is temporarily unavailable</h1><p>Please try again in a moment.</p></body>', {
    status: 503,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'retry-after': '10' },
  })
}

function stripDomain(cookie) {
  return cookie.replace(/;\s*domain\s*=\s*(?:"[^"]*"|[^;]*)/ig, '')
}

function prepareForwardedHeaders(request, publicHost) {
  const headers = new Headers(request.headers)
  for (const key of [...headers.keys()]) {
    const name = key.toLowerCase()
    if (name.startsWith('x-vercel-') || name.startsWith('x-seltra-') || name.startsWith('x-forwarded-') || ['forwarded', 'x-real-ip', 'x-client-ip', 'true-client-ip', 'x-cluster-client-ip'].includes(name)) headers.delete(key)
  }
  headers.set('x-forwarded-host', publicHost)
  headers.set('x-forwarded-proto', 'https')
  const clientIp = request.headers.get('cf-connecting-ip')
  if (clientIp) {
    headers.set('x-forwarded-for', clientIp)
    headers.set('x-real-ip', clientIp)
  }
  return headers
}

function cleanProviderResponse(response, publicHost, origin, deploymentId, head = false) {
  const headers = new Headers(response.headers)
  for (const key of [...headers.keys()]) {
    const name = key.toLowerCase()
    if (name.startsWith('x-vercel-') || name === 'x-matched-path' || name === 'x-seltra-deployment') headers.delete(key)
  }
  const location = headers.get('location')
  if (location) headers.set('location', rewriteLocation(location, origin, publicHost))
  const cookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : (response.headers.get('set-cookie') ? [response.headers.get('set-cookie')] : [])
  if (cookies.length) {
    headers.delete('set-cookie')
    for (const cookie of cookies) headers.append('set-cookie', stripDomain(cookie))
  }
  if (deploymentId) headers.set('x-seltra-deployment', deploymentId)
  const bodyless = head || response.status === 204 || response.status === 304
  return new Response(bodyless ? null : response.body, { status: response.status, statusText: response.statusText, headers })
}

function rewriteLocation(location, origin, publicHost) {
  if (!location) return location
  try {
    const target = new URL(location, `https://${origin}`)
    if (target.hostname.toLowerCase() !== origin) return location
    target.hostname = publicHost
    return target.toString()
  } catch {
    return location
  }
}

async function proxyToApp(request, url, publicHost, route) {
  const upstreamUrl = new URL(url.pathname + url.search, `https://${route.origin}`)
  const headers = prepareForwardedHeaders(request, publicHost)
  let upstream
  try {
    const forwarded = new Request(upstreamUrl, request)
    for (const key of [...forwarded.headers.keys()]) forwarded.headers.delete(key)
    for (const [key, value] of headers) forwarded.headers.set(key, value)
    upstream = await fetch(forwarded, { redirect: 'manual' })
  } catch {
    return unavailable()
  }
  if (upstream.headers.has('x-vercel-error') || upstream.status >= 500) return unavailable()
  return cleanProviderResponse(upstream, publicHost, route.origin, route.deploymentId, request.method === 'HEAD')
}

function hasBody(method) {
  return !['GET', 'HEAD'].includes(method)
}

async function legacyRequest(request, url, host, subdomain) {
  const reserved = RESERVED.has(subdomain) || subdomain.includes('.')
  const staticAsset = STATIC_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))
  const targetPath = reserved || staticAsset ? url.pathname : `/store/${subdomain}${url.pathname === '/' ? '' : url.pathname}`
  const target = new URL(targetPath + url.search, LEGACY_ORIGIN)
  const headers = prepareForwardedHeaders(request, host)
  const forwarded = new Request(target, request)
  for (const key of [...forwarded.headers.keys()]) forwarded.headers.delete(key)
  for (const [key, value] of headers) forwarded.headers.set(key, value)
  try {
    const response = await fetch(forwarded, { redirect: 'manual' })
    if (response.status >= 500 || response.headers.has('x-vercel-error')) return unavailable()
    return cleanProviderResponse(response, host, 'seltra-merchant.vercel.app', null, request.method === 'HEAD')
  } catch { return unavailable() }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const host = url.hostname.toLowerCase()
    if (host !== ROOT_DOMAIN && !host.endsWith(`.${ROOT_DOMAIN}`)) return fetch(request)
    if (host === ROOT_DOMAIN) return fetch(request)
    const subdomain = host.slice(0, -(ROOT_DOMAIN.length + 1))
    const reserved = RESERVED.has(subdomain) || subdomain.includes('.')
    const isStatic = STATIC_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))
    if (!reserved && !isStatic && SLUG_RE.test(subdomain) && env.ROUTES) {
      const route = await getRoute(env, subdomain)
      if (route) return proxyToApp(request, url, host, route)
    }
    return legacyRequest(request, url, host, subdomain)
  },
}

export { getRoute, proxyToApp, routeCache, validateRoute }
