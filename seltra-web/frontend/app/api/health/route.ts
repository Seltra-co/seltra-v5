import { NextResponse } from 'next/server'

export function GET() {
  return NextResponse.json({
    ok: true,
    service: 'seltra-web',
    time: new Date().toISOString(),
  })
}
