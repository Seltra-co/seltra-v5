import { UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { prisma } from '../db'
import { getSupabaseAdmin } from '../supabase/supabase.client'

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

  const supabase = getSupabaseAdmin()
  if (supabase) {
    const { data, error } = await supabase.auth.getUser(token)
    if (!error && data.user?.email) {
      const email = data.user.email.trim().toLowerCase()
      const user = await prisma.user.findUnique({ where: { email } })
      if (user) return user.id
      if (required) throw new UnauthorizedException('Merchant account has not been provisioned yet.')
      return null
    }
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
