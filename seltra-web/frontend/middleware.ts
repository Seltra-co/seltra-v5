import { NextResponse, type NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  const supplied = request.headers.get('x-request-id') || request.headers.get('x-dyad-request-id')
  const requestId = supplied && /^[A-Za-z0-9._:-]{1,128}$/.test(supplied) ? supplied : crypto.randomUUID()
  if (process.env.NODE_ENV === 'development') console.info(JSON.stringify({ event: 'next_http_request', requestId, method: request.method, path: request.nextUrl.pathname, at: new Date().toISOString() }))
  const headers = new Headers(request.headers)
  headers.set('x-request-id', requestId)
  const response = NextResponse.next({ request: { headers } })
  response.headers.set('x-request-id', requestId)
  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
