//seltra-web/backend/src/internal-ops/guards/ops-api-key.guard.ts
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common'
import { timingSafeEqual } from 'crypto'
import type { Request } from 'express'

type Window = { count: number; resetAt: number }

@Injectable()
export class OpsApiKeyGuard implements CanActivate {
  private readonly windows = new Map<string, Window>()

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>()
    this.enforceRateLimit(request)

    const provided = this.header(request, 'x-internal-api-key')
    const current = process.env.OPS_INTERNAL_API_KEY
    const previous = process.env.OPS_INTERNAL_API_KEY_PREVIOUS

    if (!provided || (!this.matches(provided, current) && !this.matches(provided, previous))) {
      throw new UnauthorizedException()
    }
    return true
  }

  private enforceRateLimit(request: Request) {
    const key = `${request.ip || 'unknown'}:${this.header(request, 'x-internal-api-key') || 'missing'}`
    const now = Date.now()
    const current = this.windows.get(key)
    if (!current || current.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + 60_000 })
      return
    }
    current.count += 1
    if (current.count > 300) throw new UnauthorizedException()
  }

  private matches(provided: string, expected?: string) {
    if (!expected) return false
    const a = Buffer.from(provided)
    const b = Buffer.from(expected)
    return a.length === b.length && timingSafeEqual(a, b)
  }

  private header(request: Request, name: string) {
    const value = request.headers[name]
    return Array.isArray(value) ? value[0] : value
  }
}
