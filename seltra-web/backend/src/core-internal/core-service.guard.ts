import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common'
import { timingSafeEqual } from 'node:crypto'
import type { Request } from 'express'

@Injectable()
export class CoreServiceGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>()
    const supplied = request.header('x-core-service-secret') ?? ''
    const expected = process.env.CORE_SERVICE_SECRET ?? ''
    const a = Buffer.from(supplied)
    const b = Buffer.from(expected)
    if (!expected || a.length !== b.length || !timingSafeEqual(a, b)) throw new UnauthorizedException()
    return true
  }
}
