//seltra/backend/src/auth/auth.service.ts
import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import * as bcrypt from 'bcryptjs'
import { randomBytes } from 'crypto'
import { prisma } from '../db'
import { TenantEventsService } from '../internal-ops/events/tenant-events.service'

const GENERIC_LOGIN_ERROR = "We couldn't find an account with those details. Contact support@seltra.co"
const MERCHANT_ID_PATTERN = /^(SELTRA-[A-Z0-9]+-[0-9A-Z]+|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i
const LOGIN_LIMIT = 3
const LOGIN_WINDOW_MS = 60_000

type MerchantLoginInput = {
  email: string
  merchantId: string
}

type LoginAttemptWindow = {
  count: number
  resetAt: number
}

@Injectable()
export class AuthService {
  private readonly loginAttempts = new Map<string, LoginAttemptWindow>()

  constructor(
    private readonly jwtService: JwtService,
    private readonly tenantEvents: TenantEventsService,
  ) {}

  async signup() {
    throw new ForbiddenException('Merchant accounts are created by Seltra Ops.')
  }

  async signin(input: MerchantLoginInput, ip = 'unknown') {
    this.enforceLoginRateLimit(ip)

    const email = input.email?.trim().toLowerCase()
    const merchantId = input.merchantId?.trim().toUpperCase()
    if (!email || !merchantId || !MERCHANT_ID_PATTERN.test(merchantId)) {
      throw new UnauthorizedException(GENERIC_LOGIN_ERROR)
    }

    const merchant = await prisma.merchantApplication.findFirst({
    where: {
      email: {
        equals: email,
        mode: 'insensitive',
      },
      merchantId,
      status: 'approved',
    },
    include: {
      user: true,
    },
  })

  if (!merchant?.user) {
  throw new UnauthorizedException(
    'Merchant account has not been provisioned yet.',
  )
}

   const user = merchant.user

    if (!merchant?.merchantId) {
      throw new UnauthorizedException(GENERIC_LOGIN_ERROR)
    }

    await this.createOtpCode(merchant.merchantId)
    // const user = await this.findOrCreateMerchantUser(email, merchant.fullName)
    

    const tenant = await prisma.tenant.findFirst({
      where: {
        owner: {
          email: {
            equals: email,
            mode: 'insensitive',
          },
        },
      },
      select: {
        id: true,
      },
    })

    if (tenant) {
      void this.tenantEvents.recordForTenant(
        tenant.id,
        'login',
        { email,  merchantId: merchant.merchantId },
      )
    }
 
    return {
       ...this.authPayload(user),
      otpRequired: false,
      otpEnforcement: 'disabled',
    }
  }

  async verifyOtp(merchantIdInput: string, codeInput: string) {
    const merchantId = merchantIdInput?.trim().toUpperCase()
    const code = codeInput?.trim()
    const maxAttempts = Number(process.env.OTP_MAX_ATTEMPTS || 3)
    const lockoutMinutes = Number(process.env.OTP_LOCKOUT_MINUTES || 15)

    if (!merchantId || !code) throw new UnauthorizedException('Invalid verification code')

    const otp = await prisma.otpCode.findFirst({
      where: { merchantId, used: false },
      orderBy: { createdAt: 'desc' },
    })

    if (!otp) throw new UnauthorizedException('Invalid verification code')
    if (otp.lockedUntil && otp.lockedUntil.getTime() > Date.now()) {
      throw new UnauthorizedException('Too many attempts. Try again later.')
    }
    if (otp.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('Verification code expired')
    }

    const valid = await bcrypt.compare(code, otp.hashedCode)
    if (!valid) {
      const attempts = otp.attempts + 1
      await prisma.otpCode.update({
        where: { id: otp.id },
        data: {
          attempts,
          lockedUntil: attempts >= maxAttempts
            ? new Date(Date.now() + lockoutMinutes * 60_000)
            : null,
        },
      })
      throw new UnauthorizedException('Invalid verification code')
    }

    await prisma.otpCode.update({
      where: { id: otp.id },
      data: { used: true },
    })

    return { success: true }
  }

  async me(token: string) {
    try {
      const payload = await this.jwtService.verifyAsync<{ sub: string }>(token, {
        secret: process.env.JWT_SECRET || 'change-me',
      })
      const user = await prisma.user.findUnique({ where: { id: payload.sub } })
      if (!user) throw new UnauthorizedException('User not found')
      return { user: this.publicUser(user) }
    } catch {
      throw new UnauthorizedException('Invalid bearer token')
    }
  }

  private enforceLoginRateLimit(ip: string) {
    const key = ip || 'unknown'
    const now = Date.now()
    const current = this.loginAttempts.get(key)

    if (!current || current.resetAt <= now) {
      this.loginAttempts.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS })
      return
    }

    if (current.count >= LOGIN_LIMIT) {
      throw new UnauthorizedException(GENERIC_LOGIN_ERROR)
    }

    current.count += 1
    this.loginAttempts.set(key, current)
  }

  private async createOtpCode(merchantId: string) {
    const ttlMinutes = Number(process.env.OTP_TTL_MINUTES || 10)
    const code = String(Math.floor(100000 + Math.random() * 900000))
    const hashedCode = await bcrypt.hash(code, 12)

    return prisma.otpCode.create({
      data: {
        merchantId,
        hashedCode,
        expiresAt: new Date(Date.now() + ttlMinutes * 60_000),
      },
    })
  }

  // private async findOrCreateMerchantUser(email: string, name: string | null) {
  //   const existing = await prisma.user.findUnique({ where: { email } })
  //   if (existing) {
  //     if (!existing.name && name) {
  //       return prisma.user.update({ where: { id: existing.id }, data: { name } })
  //     }
  //     return existing
  //   }

  //   const passwordHash = await bcrypt.hash(`ops-managed:${randomBytes(24).toString('hex')}`, 12)
  //   return prisma.user.create({
  //     data: {
  //       email,
  //       passwordHash,
  //       name: name?.trim() || email.split('@')[0],
  //     },
  //   })
  // }

  private authPayload(user: { id: string; email: string; name: string | null; createdAt?: Date; plan?: string | null }) {
    const publicUser = this.publicUser(user)
    const token = this.jwtService.sign({ sub: user.id, email: user.email })
    return {
      token,
      access_token: token,
      user: publicUser,
    }
  }

  private publicUser(user: { id: string; email: string; name: string | null; createdAt?: Date; plan?: string | null }) {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      plan: user.plan ?? 'free',
      created_at: user.createdAt?.toISOString(),
      createdAt: user.createdAt?.toISOString(),
      user_metadata: {
        name: user.name || undefined,
        full_name: user.name || undefined,
      },
    }
  }
}
