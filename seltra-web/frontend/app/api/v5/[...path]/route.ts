import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PRODUCTION_API = 'https://seltra-merchant-backend.onrender.com'
const RETRYABLE_CONNECTION_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'EPIPE', 'ETIMEDOUT'])

function isRetryableConnectionError(error: unknown): boolean {
  if (error instanceof AggregateError) return error.errors.some(isRetryableConnectionError)
  if (!error || typeof error !== 'object') return false
  const value = error as { code?: unknown; cause?: unknown }
  return (typeof value.code === 'string' && RETRYABLE_CONNECTION_CODES.has(value.code)) || isRetryableConnectionError(value.cause)
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function upstreamBase() {
  return (
    process.env.API_PROXY_TARGET?.replace(/\/$/, '') ||
    process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, '') ||
    PRODUCTION_API
  )
}

async function proxy(req: NextRequest, path: string[]) {
  const target = `${upstreamBase()}/api/v5/${path.join('/')}${req.nextUrl.search}`
  const headers = new Headers()
  const contentType = req.headers.get('content-type')
  const authorization = req.headers.get('authorization')
  const cookie = req.headers.get('cookie')
  const suppliedRequestId = req.headers.get('x-request-id')
  const requestId = suppliedRequestId && /^[A-Za-z0-9._:-]{1,128}$/.test(suppliedRequestId) ? suppliedRequestId : randomUUID()
  const idempotencyKey = req.headers.get('idempotency-key')
  const lastEventId = req.headers.get('last-event-id')
  const runId = req.headers.get('x-seltra-run-id')
  if (contentType) headers.set('content-type', contentType)
  if (authorization) headers.set('authorization', authorization)
  if (cookie) headers.set('cookie', cookie)
  headers.set('x-request-id', requestId)
  if (idempotencyKey) headers.set('idempotency-key', idempotencyKey)
  if (lastEventId) headers.set('last-event-id', lastEventId)
  if (runId && /^[a-f0-9-]{36}$/i.test(runId)) headers.set('x-seltra-run-id', runId)

  const init: RequestInit = {
    method: req.method,
    headers,
    redirect: 'manual',
    signal: req.signal,
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = await req.arrayBuffer()
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const upstream = await fetch(target, init)
      const responseHeaders = new Headers()
      const upstreamType = upstream.headers.get('content-type')
      const setCookie = upstream.headers.get('set-cookie')
      const upstreamRequestId = upstream.headers.get('x-request-id')
      if (upstreamType) responseHeaders.set('content-type', upstreamType)
      if (upstreamType?.includes('text/event-stream')) {
        responseHeaders.set('cache-control', 'no-cache, no-transform')
        responseHeaders.set('x-accel-buffering', 'no')
        if (upstream.status >= 400) console.warn(JSON.stringify({ event: 'backend_api_proxy_error', requestId, path: `/api/v5/${path.join('/')}`, status: upstream.status }))
        return new NextResponse(upstream.body, { status: upstream.status, headers: responseHeaders })
      }
      const body = await upstream.arrayBuffer()
      if (setCookie) responseHeaders.set('set-cookie', setCookie)
      responseHeaders.set('x-request-id', upstreamRequestId && /^[A-Za-z0-9._:-]{1,128}$/.test(upstreamRequestId) ? upstreamRequestId : requestId)
      if (upstream.status >= 400) console.warn(JSON.stringify({ event: 'backend_api_proxy_error', requestId, path: `/api/v5/${path.join('/')}`, status: upstream.status }))
      return new NextResponse(body, {
        status: upstream.status,
        headers: responseHeaders,
      })
    } catch (error) {
      if (!isRetryableConnectionError(error) || attempt === 2) {
        const message = error instanceof Error ? error.message : 'Proxy failed'
        return NextResponse.json(
          { message: `We couldn't reach Seltra (${message}). Please try again.` },
          { status: 502 },
        )
      }
      await wait(150 * (attempt + 1))
    }
  }

  return NextResponse.json({ message: "We couldn't reach Seltra. Please try again." }, { status: 502 })
}

type Ctx = { params: Promise<{ path: string[] }> }

export async function GET(req: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params
  return proxy(req, path)
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params
  return proxy(req, path)
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params
  return proxy(req, path)
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params
  return proxy(req, path)
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params
  return proxy(req, path)
}
