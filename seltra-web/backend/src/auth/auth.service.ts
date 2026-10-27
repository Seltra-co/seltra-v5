//seltra/backend/src/auth/auth.service.ts
import { BadRequestException, ForbiddenException, Injectable, Logger, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import * as bcrypt from 'bcryptjs'
import { createHmac, randomInt, timingSafeEqual } from 'crypto'
import { Cron } from '@nestjs/schedule'
import { prisma } from '../db'
import { TenantEventsService } from '../internal-ops/events/tenant-events.service'
import { ResendService } from '../resend/resend.service'
import { getSupabaseAdmin, getSupabaseAnon } from '../supabase/supabase.client'
import { resolveUserIdFromAuthorization } from './resolve-user'

const GENERIC_LOGIN_ERROR = 'That email or password is incorrect.'
const MERCHANT_ID_PATTERN = /^(SELTRA-[A-Z0-9]+-[0-9A-Z]+|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i
const LOGIN_LIMIT = 3
const LOGIN_WINDOW_MS = 60_000

type MerchantLoginInput = {
  email: string
  merchantId?: string
  password?: string
}

type LoginAttemptWindow = {
  count: number
  resetAt: number
}

@Injectable()
export class AuthService {
  private readonly loginAttempts = new Map<string, LoginAttemptWindow>()
  private readonly logger = new Logger(AuthService.name)
  private dispatchingV5Introductions = false

  constructor(
    private readonly jwtService: JwtService,
    private readonly tenantEvents: TenantEventsService,
    private readonly resend: ResendService,
  ) {}

  async signup() {
    throw new ForbiddenException('Complete the account form to sign up.')
  }

  async registerMerchant(input: Record<string, any>, ip = 'unknown') {
    this.enforceLoginRateLimit(`signup:${ip}`)
    const email = String(input.email || '').trim().toLowerCase()
    const name = String(input.full_name || '').trim()
    const password = String(input.password || '')
    if (!email || !name || password.length < 10) throw new BadRequestException('Enter your details and a password of at least 10 characters.')
    if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
      throw new BadRequestException('Use at least one uppercase letter, one lowercase letter, and one number.')
    }
    const existing = await prisma.merchantApplication.findUnique({ where: { email } })
    const existingUser = await prisma.user.findUnique({ where: { email } })
    if (existing?.status === 'approved' || existingUser) {
      throw new BadRequestException('An account with this email already exists. Log in instead.')
    }
    const merchantId = await this.generateMerchantId()
    const passwordHash = await bcrypt.hash(password, 12)
    const normalized = {
      fullName: name,
      phone: String(input.phone || '').trim(),
      email,
      businessName: String(input.business_name || '').trim(),
      businessType: String(input.business_type || '').trim(),
      storeName: String(input.store_name || '').trim(),
      whatYouSell: String(input.what_you_sell || '').trim(),
      basedIn: String(input.based_in || '').trim(),
      monthlyRevenue: String(input.monthly_revenue || '').trim(),
      existingLinks: input.existing_links ? String(input.existing_links).trim() : null,
      aiFamiliarity: input.ai_familiarity ? String(input.ai_familiarity) : null,
      aiUsedBefore: typeof input.ai_used_before === 'boolean' ? input.ai_used_before : null,
      aiToolsUsed: input.ai_tools_used ? String(input.ai_tools_used).trim() : null,
      aiFeelings: input.ai_feelings ? String(input.ai_feelings).trim() : null,
      allowAiHelp: input.allow_ai_help ? String(input.allow_ai_help) : null,
    }
    if ([normalized.phone, normalized.businessName, normalized.businessType, normalized.storeName, normalized.whatYouSell, normalized.basedIn, normalized.monthlyRevenue].some((value) => !value)) {
      throw new BadRequestException('Complete all required account and business fields.')
    }
    if (Object.values(normalized).some((value) => typeof value === 'string' && value.length > 600)) {
      throw new BadRequestException('One or more fields are too long.')
    }
    let user
    try {
      user = await prisma.$transaction(async (tx) => {
        const created = await tx.user.create({ data: { email, name, passwordHash } })
        const applicationData = { ...normalized, status: 'approved' as const, merchantId, userId: created.id, reviewedAt: new Date(), credentialsGeneratedAt: new Date() }
        if (existing) await tx.merchantApplication.update({ where: { id: existing.id }, data: applicationData })
        else await tx.merchantApplication.create({ data: applicationData })
        return created
      })
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
        throw new BadRequestException('An account with this email already exists. Log in instead.')
      }
      throw error
    }
    let welcomeEmailSent = true
    try {
      await this.resend.sendNewMerchantWelcome({ to: email, name, merchantId })
    } catch (error) {
      welcomeEmailSent = false
      console.error('[auth] welcome email delivery failed', error)
    }
    let v5IntroductionScheduled = false
    if (welcomeEmailSent) {
      try {
        await prisma.scheduledEmail.create({
          data: {
            userId: user.id,
            campaign: 'seltra-v5-introduction',
            scheduledAt: new Date(Date.now() + randomInt(3 * 60_000, 5 * 60_000 + 1)),
          },
        })
        v5IntroductionScheduled = true
      } catch (error) {
        this.logger.error(`Could not schedule Seltra v5 introduction for user ${user.id}`, error instanceof Error ? error.stack : undefined)
      }
    }
    return { success: true, merchantId, welcomeEmailSent, v5IntroductionScheduled, message: 'Your Seltra account is ready. Log in to continue.' }
  }

  @Cron('*/30 * * * * *')
  async dispatchScheduledV5Introductions() {
    // A slow database query or email provider must not let successive cron
    // ticks queue duplicate work and consume the remaining Prisma pool.
    if (this.dispatchingV5Introductions) return
    this.dispatchingV5Introductions = true
    const now = new Date()
    const staleBefore = new Date(now.getTime() - 10 * 60_000)
    try {
      const candidates = await prisma.scheduledEmail.findMany({
        where: {
          campaign: 'seltra-v5-introduction',
          OR: [
            { status: 'pending', scheduledAt: { lte: now } },
            { status: 'processing', claimedAt: { lt: staleBefore } },
          ],
        },
        orderBy: { scheduledAt: 'asc' },
        take: 25,
        select: { id: true, status: true, scheduledAt: true, claimedAt: true, attempts: true },
      })

      const claimed: Array<{ id: string; attempt: number }> = []
      for (const candidate of candidates) {
        const where = candidate.status === 'pending'
          ? { id: candidate.id, status: 'pending', scheduledAt: { lte: now } }
          : { id: candidate.id, status: 'processing', claimedAt: { lt: staleBefore } }
        const result = await prisma.scheduledEmail.updateMany({
          where,
          data: { status: 'processing', claimedAt: now, attempts: { increment: 1 } },
        })
        if (result.count === 1) claimed.push({ id: candidate.id, attempt: candidate.attempts + 1 })
      }

      for (const item of claimed) await this.sendClaimedV5Introduction(item.id, item.attempt)
    } catch (error) {
      this.logger.error('Could not process scheduled Seltra v5 introduction emails', error instanceof Error ? error.stack : undefined)
    } finally {
      this.dispatchingV5Introductions = false
    }
  }

  async unsubscribeFromProductUpdates(userId: string, token: string) {
    if (!userId || !token || token.length !== 64) throw new BadRequestException('This unsubscribe link is invalid.')
    const expected = Buffer.from(this.unsubscribeSignature(userId), 'hex')
    const supplied = Buffer.from(token, 'hex')
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      throw new BadRequestException('This unsubscribe link is invalid.')
    }
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } })
    if (!user) return { success: true }
    await prisma.$transaction([
      prisma.user.update({ where: { id: userId }, data: { marketingEmailUnsubscribedAt: new Date() } }),
      prisma.scheduledEmail.updateMany({ where: { userId, campaign: 'seltra-v5-introduction', status: 'pending' }, data: { status: 'cancelled' } }),
    ])
    return { success: true }
  }

  private unsubscribeSignature(userId: string) {
    const secret = process.env.EMAIL_UNSUBSCRIBE_SECRET || process.env.JWT_SECRET
    if (!secret || secret.length < 32) throw new Error('EMAIL_UNSUBSCRIBE_SECRET or a 32-character JWT_SECRET is required.')
    return createHmac('sha256', secret).update(`seltra-product-updates:${userId}`).digest('hex')
  }

  private async sendClaimedV5Introduction(id: string, attempt: number) {
    try {
      const job = await prisma.scheduledEmail.findUnique({
        where: { id },
        include: { user: { select: { id: true, email: true, name: true, marketingEmailUnsubscribedAt: true } } },
      })
      if (!job || job.status !== 'processing') return
      if (!job.user || job.user.marketingEmailUnsubscribedAt) {
        await prisma.scheduledEmail.update({ where: { id }, data: { status: 'cancelled', claimedAt: null } })
        return
      }
      const appUrl = (process.env.SELTRA_FRONTEND_URL || (process.env.NODE_ENV === 'production' ? 'https://seltra.co' : 'http://localhost:3000')).replace(/\/$/, '')
      const unsubscribeUrl = new URL('/api/v5/auth/email/unsubscribe', appUrl)
      unsubscribeUrl.searchParams.set('user', job.user.id)
      unsubscribeUrl.searchParams.set('token', this.unsubscribeSignature(job.user.id))
      await this.resend.sendV5Introduction({
        to: job.user.email,
        firstName: job.user.name?.trim().split(/\s+/)[0] || 'there',
        userId: job.user.id,
        loginUrl: new URL('/auth', appUrl).toString(),
        unsubscribeUrl: unsubscribeUrl.toString(),
      })
      await prisma.scheduledEmail.update({ where: { id }, data: { status: 'sent', sentAt: new Date(), claimedAt: null, lastError: null } })
    } catch (error) {
      const providerMessage = typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
        ? error.message
        : null
      const message = (error instanceof Error ? error.message : providerMessage || 'Email delivery failed.').slice(0, 500)
      const retryDelays = [60_000, 3 * 60_000, 10 * 60_000, 30 * 60_000]
      const failed = attempt >= 5
      await prisma.scheduledEmail.update({
        where: { id },
        data: {
          status: failed ? 'failed' : 'pending',
          scheduledAt: failed ? undefined : new Date(Date.now() + retryDelays[Math.min(attempt - 1, retryDelays.length - 1)]),
          claimedAt: null,
          lastError: message,
        },
      }).catch((updateError) => this.logger.error(`Could not save retry state for scheduled email ${id}`, updateError instanceof Error ? updateError.stack : undefined))
      this.logger.warn(`Seltra v5 introduction delivery attempt ${attempt} failed for scheduled email ${id}: ${message}`)
    }
  }

  async signin(input: MerchantLoginInput, ip = 'unknown') {
    this.enforceLoginRateLimit(ip)

    const email = input.email?.trim().toLowerCase()
    if (email) this.enforceLoginRateLimit(`account:${email}`)
    if (input.password && !MERCHANT_ID_PATTERN.test(input.password.trim())) {
      return this.signinWithPassword(email, input.password, ip)
    }

    const merchantId = (input.merchantId || input.password)?.trim().toUpperCase()
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

    await this.issueLoginOtp(merchant.merchantId, email)
    // const user = await this.findOrCreateMerchantUser(email, merchant.fullName)

    return {
      otpRequired: true,
      merchantId: merchant.merchantId,
      email: this.maskEmail(email),
    }
  }

  async requestPasswordReset(emailInput: string) {
    const email = emailInput?.trim().toLowerCase()
    if (!email) throw new BadRequestException('Enter your email')

    const user = await prisma.user.findUnique({ where: { email } })
    if (!user) throw new UnauthorizedException("We couldn't find an account with that email.")

    const code = String(randomInt(100000, 1000000))
    const hashedCode = await bcrypt.hash(code, 12)
    await prisma.otpCode.create({
      data: {
        merchantId: this.resetKey(email),
        hashedCode,
        expiresAt: new Date(Date.now() + 10 * 60_000),
      },
    })

    try {
      await this.resend.sendPasswordResetOtp({ to: email, code })
    } catch (error) {
      console.error('Password reset email failed', error)
      throw new BadRequestException('We could not send the code. Try again in a moment.')
    }

    return { ok: true }
  }

  async verifyPasswordResetCode(emailInput: string, codeInput: string) {
    await this.readResetCode(emailInput, codeInput, false)
    return { ok: true }
  }

  async resetPassword(emailInput: string, codeInput: string, password: string) {
    const email = emailInput?.trim().toLowerCase()
    const nextPassword = password?.trim() ?? ''
    if (nextPassword.length < 8) throw new BadRequestException('Password must be at least 8 characters')

    await this.readResetCode(email, codeInput, true)
    const passwordHash = await bcrypt.hash(nextPassword, 12)
    const user = await prisma.user.update({
      where: { email },
      data: { passwordHash },
    })

    const session = await this.ensureSupabaseUser(email, nextPassword, user.name)

    return {
      ...this.authPayload(user, session?.access_token),
      refresh_token: session?.refresh_token,
      otpRequired: false,
    }
  }

  private async signinWithPassword(email: string, password: string, ip: string) {
    if (!email || !password.trim()) throw new UnauthorizedException(GENERIC_LOGIN_ERROR)

    const prismaUser = await prisma.user.findUnique({ where: { email } })
    if (!prismaUser) throw new UnauthorizedException(GENERIC_LOGIN_ERROR)

    const valid = await bcrypt.compare(password, prismaUser.passwordHash)
    if (!valid) throw new UnauthorizedException(GENERIC_LOGIN_ERROR)
    this.enforceLoginRateLimit(`${ip}:${email}`)
    const application = await prisma.merchantApplication.findFirst({ where: { email, status: 'approved' }, select: { merchantId: true } })
    if (!application?.merchantId) throw new UnauthorizedException(GENERIC_LOGIN_ERROR)
    await this.issueLoginOtp(application.merchantId, email)
    return {
      otpRequired: true,
      merchantId: application.merchantId,
      email: this.maskEmail(email),
    }
  }

  private async recordLogin(email: string) {
    const user = await prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } }, select: { id: true } })
    if (!user) return
    const tenant = await prisma.tenant.findFirst({ where: { ownerId: user.id }, orderBy: { createdAt: 'asc' }, select: { id: true } })
    try {
      await this.tenantEvents.recordForUser(user.id, 'login', { email }, tenant?.id)
    } catch (error) {
      console.error('[auth] unable to persist login notification', error)
    }
  }

  private async signInWithSupabase(email: string, password: string) {
    const client = getSupabaseAnon()
    if (!client) return null
    const { data, error } = await client.auth.signInWithPassword({ email, password })
    if (error || !data.session) return null
    return {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    }
  }

  private async ensureSupabaseUser(email: string, password: string, name: string | null) {
    const admin = getSupabaseAdmin()
    if (!admin) return null

    const metadata = { name: name || undefined, full_name: name || undefined }
    const { error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: metadata,
    })

    if (createError && !/already|registered|exists/i.test(createError.message)) {
      console.error('[Supabase] createUser failed', createError.message)
      return null
    }

    if (createError) {
      const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
        type: 'recovery',
        email,
      })
      const userId = linkData?.user?.id
      if (linkError || !userId) {
        console.error('[Supabase] lookup user failed', linkError?.message)
        return null
      }
      const { error: updateError } = await admin.auth.admin.updateUserById(userId, {
        password,
        email_confirm: true,
        user_metadata: metadata,
      })
      if (updateError) {
        console.error('[Supabase] updateUser failed', updateError.message)
        return null
      }
    }

    return this.signInWithSupabase(email, password)
  }

  private resetKey(email: string) {
    return `RESET:${email}`
  }

  private async readResetCode(emailInput: string, codeInput: string, consume: boolean) {
    const email = emailInput?.trim().toLowerCase()
    const code = codeInput?.trim()
    const maxAttempts = Number(process.env.OTP_MAX_ATTEMPTS || 3)
    const lockoutMinutes = Number(process.env.OTP_LOCKOUT_MINUTES || 15)

    if (!email || !code) throw new UnauthorizedException('Invalid verification code')

    const otp = await prisma.otpCode.findFirst({
      where: { merchantId: this.resetKey(email), used: false },
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

    if (consume) {
      await prisma.otpCode.update({
        where: { id: otp.id },
        data: { used: true },
      })
    }

    return otp
  }

  async verifyOtp(merchantIdInput: string, codeInput: string, ip = 'unknown') {
    this.enforceOtpRateLimit(ip)
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

    const application = await prisma.merchantApplication.findFirst({
      where: { merchantId, status: 'approved' }, include: { user: true },
    })
    if (!application?.user) throw new UnauthorizedException('Merchant account is not available.')
    await this.recordLogin(application.email)
    return { success: true, ...this.authPayload(application.user) }
  }

  async me(token: string) {
    const userId = await resolveUserIdFromAuthorization(`Bearer ${token}`, this.jwtService, true)
    const user = await prisma.user.findUnique({ where: { id: userId! } })
    if (!user) throw new UnauthorizedException('User not found')
    await this.queueV5IntroductionForEngagedMerchant(user)
    const application = await prisma.merchantApplication.findFirst({
      where: { userId: user.id, status: 'approved' },
      select: { businessType: true, businessName: true, storeName: true, whatYouSell: true, basedIn: true },
    })
    return { user: { ...this.publicUser(user), merchantProfile: application } }
  }

  async updateOnboardingPreferences(token: string, preferences: { completedTourVersion?: string; dismissedAnnouncementVersion?: string }) {
    const userId = await resolveUserIdFromAuthorization(`Bearer ${token}`, this.jwtService, true)
    const data: { completedTours?: { push: string }; dismissedAnnouncements?: { push: string } } = {}
    if (preferences.completedTourVersion) data.completedTours = { push: preferences.completedTourVersion }
    if (preferences.dismissedAnnouncementVersion) data.dismissedAnnouncements = { push: preferences.dismissedAnnouncementVersion }
    if (Object.keys(data).length === 0) throw new BadRequestException('An onboarding preference is required')
    const user = await prisma.user.update({ where: { id: userId! }, data })

    // Existing merchants receive the introduction after engaging with the new
    // dashboard. New signups may already have this campaign queued after their
    // welcome email; the unique user/campaign constraint keeps this idempotent.
    await this.queueV5IntroductionForEngagedMerchant(user)
    return { success: true, preferences: { completedTours: user.completedTours, dismissedAnnouncements: user.dismissedAnnouncements } }
  }

  private async queueV5IntroductionForEngagedMerchant(user: {
    id: string
    completedTours: string[]
    dismissedAnnouncements: string[]
    marketingEmailUnsubscribedAt: Date | null
  }) {
    const hasSeenDashboardChanges = user.completedTours.length > 0 || user.dismissedAnnouncements.length > 0
    if (!hasSeenDashboardChanges || user.marketingEmailUnsubscribedAt) return

    try {
      const merchant = await prisma.merchantApplication.findFirst({
        where: { userId: user.id, status: 'approved' },
        select: { id: true },
      })
      if (!merchant) return
      await prisma.scheduledEmail.createMany({
        data: [{ userId: user.id, campaign: 'seltra-v5-introduction', scheduledAt: new Date() }],
        skipDuplicates: true,
      })
    } catch (error) {
      this.logger.error(`Could not queue Seltra v5 introduction for engaged merchant ${user.id}`, error instanceof Error ? error.stack : undefined)
    }
  }

  private enforceLoginRateLimit(ip: string) {
    const key = ip || 'unknown'
    const now = Date.now()
    if (this.loginAttempts.size > 5000) {
      for (const [attemptKey, window] of this.loginAttempts) if (window.resetAt <= now) this.loginAttempts.delete(attemptKey)
    }
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

  private otpAttempts = new Map<string, LoginAttemptWindow>()
  private enforceOtpRateLimit(key: string) {
    const now = Date.now()
    if (this.otpAttempts.size > 5000) {
      for (const [attemptKey, window] of this.otpAttempts) if (window.resetAt <= now) this.otpAttempts.delete(attemptKey)
    }
    const current = this.otpAttempts.get(key)
    if (!current || current.resetAt <= now) {
      this.otpAttempts.set(key, { count: 1, resetAt: now + 15 * 60_000 })
      return
    }
    if (current.count >= 8) throw new UnauthorizedException('Too many code attempts. Try again later.')
    current.count += 1
  }

  private async issueLoginOtp(merchantId: string, email: string) {
    const code = String(randomInt(100000, 1000000))
    const hashedCode = await bcrypt.hash(code, 12)
    await prisma.otpCode.updateMany({ where: { merchantId, used: false }, data: { used: true } })
    await prisma.otpCode.create({ data: { merchantId, hashedCode, expiresAt: new Date(Date.now() + 10 * 60_000) } })
    try {
      await this.resend.sendLoginOtp({ to: email, code })
    } catch (error) {
      console.error('[auth] login OTP email delivery failed', error)
      throw new BadRequestException('We could not send your sign-in code. Please try again shortly.')
    }
  }

  private maskEmail(email: string) {
    const [name, domain] = email.split('@')
    return `${name.slice(0, 2)}${'*'.repeat(Math.max(2, name.length - 2))}@${domain}`
  }

  private async generateMerchantId() {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const left = randomInt(1000, 10000)
      const right = randomInt(1000, 10000)
      const merchantId = `SELTRA-${left}-${right}`
      if (!(await prisma.merchantApplication.findUnique({ where: { merchantId }, select: { id: true } }))) return merchantId
    }
    throw new BadRequestException('Could not create a merchant ID. Please try again.')
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

  private authPayload(
    user: { id: string; email: string; name: string | null; createdAt?: Date; plan?: string | null },
    accessToken?: string,
  ) {
    const publicUser = this.publicUser(user)
    const token = accessToken || this.jwtService.sign({ sub: user.id, email: user.email })
    return {
      token,
      access_token: token,
      user: publicUser,
    }
  }

  private publicUser(user: { id: string; email: string; name: string | null; createdAt?: Date; plan?: string | null; completedTours?: string[]; dismissedAnnouncements?: string[] }) {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      plan: user.plan ?? 'free',
      completedTours: user.completedTours ?? [],
      dismissedAnnouncements: user.dismissedAnnouncements ?? [],
      created_at: user.createdAt?.toISOString(),
      createdAt: user.createdAt?.toISOString(),
      user_metadata: {
        name: user.name || undefined,
        full_name: user.name || undefined,
      },
    }
  }
}
