import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PRODUCTION_API = 'https://seltra-merchant-backend.onrender.com'

function upstreamBase() {
  return (
    process.env.API_PROXY_TARGET?.replace(/\/$/, '') ||
    process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, '') ||
    PRODUCTION_API
  )
}

async function proxy(req: NextRequest, path: string[]) {
  // Never forward browser Origin — Render CORS rejects some Vercel preview hosts.
  const target = `${upstreamBase()}/api/v5/${path.join('/')}${req.nextUrl.search}`
  const headers = new Headers()
  const contentType = req.headers.get('content-type')
  const authorization = req.headers.get('authorization')
  const runId = req.headers.get('x-seltra-run-id')
  const suppliedRequestId = req.headers.get('x-request-id')
  const requestId = suppliedRequestId && /^[A-Za-z0-9._:-]{1,128}$/.test(suppliedRequestId) ? suppliedRequestId : randomUUID()
  if (contentType) headers.set('content-type', contentType)
  if (authorization) headers.set('authorization', authorization)
  headers.set('x-request-id', requestId)
  if (runId && /^[a-f0-9-]{36}$/i.test(runId)) headers.set('x-seltra-run-id', runId)

  const init: RequestInit = {
    method: req.method,
    headers,
    redirect: 'manual',
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = await req.arrayBuffer()
  }

  try {
    const upstream = await fetch(target, init)
    const body = await upstream.arrayBuffer()
    const responseHeaders = new Headers()
    const upstreamType = upstream.headers.get('content-type')
    const upstreamRequestId = upstream.headers.get('x-request-id')
    if (upstreamType) responseHeaders.set('content-type', upstreamType)
    responseHeaders.set('x-request-id', upstreamRequestId && /^[A-Za-z0-9._:-]{1,128}$/.test(upstreamRequestId) ? upstreamRequestId : requestId)
    if (upstream.status >= 400) console.warn(JSON.stringify({ event: 'backend_api_proxy_error', requestId, path: `/api/v5/${path.join('/')}`, status: upstream.status }))
    return new NextResponse(body, {
      status: upstream.status,
      headers: responseHeaders,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Proxy failed'
    return NextResponse.json(
      { message: `We couldn't reach Seltra (${message}). Please try again.` },
      { status: 502 },
    )
  }
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
