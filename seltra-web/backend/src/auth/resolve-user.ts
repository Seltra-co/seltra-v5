import { UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'

export async function resolveUserIdFromAuthorization(
  authorization: string | undefined,
  jwtService: JwtService,
  required = true,
): Promise<string | null> {
  const token = authorization?.replace(/^Bearer\s+/i, '')?.trim()
  if (!token) {
    if (required) throw new UnauthorizedException('Missing bearer token')
    return null
  }

  try {
    const payload = await jwtService.verifyAsync<{ sub: string }>(token, {
      secret: process.env.JWT_SECRET || 'change-me',
    })
    if (payload?.sub) return payload.sub
  } catch {
    // fall through
  }

  if (required) throw new UnauthorizedException('Invalid bearer token')
  return null
}
