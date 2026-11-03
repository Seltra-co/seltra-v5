//seltra/backend/src/auth/auth.service.ts
import { BadRequestException, ForbiddenException, Injectable, Logger, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import * as bcrypt from 'bcryptjs'
import { createHash, createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'crypto'
import { Resolver } from 'node:dns/promises'
import { Cron } from '@nestjs/schedule'
import { prisma } from '../db'
import { TenantEventsService } from '../internal-ops/events/tenant-events.service'
import { ResendService, sendSignupNotificationFireAndForget } from '../resend/resend.service'
import { resolveUserIdFromAuthorization } from './resolve-user'
import { REFRESH_TOKEN_TTL_MS } from './auth.constants'
import { creditAllowanceForPlan } from '../common/credit-plan'
import { mirrorWorkspaceCredit } from '../credits/workspace_credit_mirror'

const NO_ACCOUNT_ERROR = 'No account for this email. Sign up to continue.'
const WRONG_PASSWORD_ERROR = 'That password is incorrect.'
const WRONG_MERCHANT_ID_ERROR = 'That merchant ID is incorrect.'
const ACCOUNT_NOT_READY_ERROR = 'This account is not ready to sign in yet.'
const TOO_MANY_SIGNINS = 'Too many sign-in attempts. Try again in a minute.'
const MERCHANT_ID_PATTERN = /^(SELTRA-[A-Z0-9]+-[0-9A-Z]+|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i
const DELIVERABLE_EMAIL = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i
const LOGIN_LIMIT = 3
const LOGIN_WINDOW_MS = 60_000
const SCHEDULED_EMAIL_DB_RETRY_BASE_MS = 60_000
const SCHEDULED_EMAIL_DB_RETRY_MAX_MS = 5 * 60_000

type MerchantLoginInput = {
  email: string
  merchantId?: string
  password?: string
}

type LoginAttemptWindow = {
  count: number
  resetAt: number
}

type AuthenticatedUser = {
  id: string
  email: string
  name: string | null
  createdAt?: Date
  plan?: string | null
  completedTours?: string[]
  dismissedAnnouncements?: string[]
}

@Injectable()
export class AuthService {
  private readonly loginAttempts = new Map<string, LoginAttemptWindow>()
  private readonly logger = new Logger(AuthService.name)
  private dispatchingV5Introductions = false
  private scheduledV5DbFailureCount = 0
  private scheduledV5DbRetryAt = 0
  private scheduledV5DbUnavailable = false

  constructor(
    private readonly jwtService: JwtService,
    private readonly tenantEvents: TenantEventsService,
    private readonly resend: ResendService,
  ) {}

  async signup() {
    throw new ForbiddenException('Complete the account form to sign up.')
  }

  async registerMerchant(input: Record<string, any>, ip = 'unknown') {
    this.enforceLoginRateLimit(`signup:${ip}`, 'Too many signup attempts. Try again in a minute.')
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
      basedIn: null,
      region: String(input.region || '').trim(),
      country: String(input.country || '').trim(),
      city: null,
      monthlyRevenue: String(input.monthly_revenue || '').trim(),
      existingLinks: input.existing_links ? String(input.existing_links).trim() : null,
      aiFamiliarity: input.ai_familiarity ? String(input.ai_familiarity) : null,
      aiUsedBefore: typeof input.ai_used_before === 'boolean' ? input.ai_used_before : null,
      aiToolsUsed: input.ai_tools_used ? String(input.ai_tools_used).trim() : null,
      aiFeelings: input.ai_feelings ? String(input.ai_feelings).trim() : null,
      allowAiHelp: input.allow_ai_help ? String(input.allow_ai_help) : null,
    }
    if ([normalized.phone, normalized.businessName, normalized.businessType, normalized.storeName, normalized.whatYouSell, normalized.region, normalized.country, normalized.monthlyRevenue].some((value) => !value)) {
      throw new BadRequestException('Complete all required account and business fields.')
    }
    if (Object.values(normalized).some((value) => typeof value === 'string' && value.length > 600)) {
      throw new BadRequestException('One or more fields are too long.')
    }
    await this.assertDeliverableEmail(email)
    const emailCode = String(input.email_code || '').trim()
    if (!emailCode) {
      await this.issueSignupEmailCode(email)
      return { verificationRequired: true, email: this.maskEmail(email), message: 'Enter the code we sent to confirm this email. If the inbox is not real, no code will arrive and no account will be created.' }
    }
    await this.consumeSignupEmailCode(email, emailCode)
    let user
    try {
      user = await prisma.$transaction(async (tx) => {
        const created = await tx.user.create({ data: { email, name, passwordHash } })
        const freeAllowance = creditAllowanceForPlan('free')
        const creditAccount = await tx.userCredit.create({ data: { userId: created.id, balance: freeAllowance, lifetimeGranted: freeAllowance, windowAllowance: freeAllowance, plan: 'free' } })
        await tx.userCreditLedger.create({ data: { id: randomUUID(), userId: created.id, kind: 'grant', delta: freeAllowance, balanceAfter: freeAllowance, meta: { reason: 'new_free_user_allowance', tokensPerCredit: 1000 } } })
        await mirrorWorkspaceCredit(tx, creditAccount)
        const applicationData = { ...normalized, status: 'approved' as const, merchantId, userId: created.id, reviewedAt: new Date(), credentialsGeneratedAt: new Date() }
        if (existing) {
          const { basedIn: _basedIn, city: _city, ...preservedApplicationData } = applicationData
          await tx.merchantApplication.update({ where: { id: existing.id }, data: preservedApplicationData })
        } else {
          await tx.merchantApplication.create({ data: applicationData })
        }
        return created
      })
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
        throw new BadRequestException('An account with this email already exists. Log in instead.')
      }
      throw error
    }
    void sendSignupNotificationFireAndForget(() => this.resend.sendSignupNotification({
      name,
      email,
      phone: normalized.phone,
      businessName: normalized.businessName,
      plan: 'free',
      region: String(input.region || '').trim() || null,
      country: String(input.country || '').trim() || null,
      createdAt: user.createdAt?.toISOString?.() ?? new Date().toISOString()
    }))
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
    if (Date.now() < this.scheduledV5DbRetryAt) return
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
      if (this.scheduledV5DbUnavailable) {
        this.logger.log('Database connection restored; resuming scheduled Seltra v5 introduction emails.')
      }
      this.scheduledV5DbFailureCount = 0
      this.scheduledV5DbRetryAt = 0
      this.scheduledV5DbUnavailable = false
    } catch (error) {
      const retryDelay = Math.min(
        SCHEDULED_EMAIL_DB_RETRY_BASE_MS * 2 ** this.scheduledV5DbFailureCount,
        SCHEDULED_EMAIL_DB_RETRY_MAX_MS,
      )
      this.scheduledV5DbFailureCount += 1
      this.scheduledV5DbRetryAt = Date.now() + retryDelay
      if (!this.scheduledV5DbUnavailable) {
        this.scheduledV5DbUnavailable = true
        this.logger.error(
          `Could not process scheduled Seltra v5 introduction emails. Retrying in ${Math.round(retryDelay / 1000)} seconds.`,
          error instanceof Error ? error.stack : undefined,
        )
      }
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
        scheduledEmailId: job.id,
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
    this.enforceLoginRateLimit(ip, TOO_MANY_SIGNINS)

    const email = input.email?.trim().toLowerCase()
    if (!email) throw new BadRequestException('Enter your email.')
    this.enforceLoginRateLimit(`account:${email}`, TOO_MANY_SIGNINS)
    if (input.password && !input.merchantId && !MERCHANT_ID_PATTERN.test(input.password.trim())) {
      return this.signinWithPassword(email, input.password, ip)
    }

    const merchantId = (input.merchantId || input.password)?.trim().toUpperCase()
    if (!merchantId || !MERCHANT_ID_PATTERN.test(merchantId)) {
      throw new BadRequestException('Enter your password or merchant ID.')
    }

    const merchant = await prisma.merchantApplication.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
      include: { user: true },
    })
    if (!merchant) throw new UnauthorizedException(NO_ACCOUNT_ERROR)
    if (merchant.status !== 'approved' || !merchant.user) throw new UnauthorizedException(ACCOUNT_NOT_READY_ERROR)
    if (!merchant.merchantId || merchant.merchantId.toUpperCase() !== merchantId) {
      throw new UnauthorizedException(WRONG_MERCHANT_ID_ERROR)
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
    if (!user) throw new UnauthorizedException(NO_ACCOUNT_ERROR)

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

    await prisma.refreshToken.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    })
    return { ...(await this.issueSession(user)), otpRequired: false }
  }

  private async signinWithPassword(email: string, password: string, ip: string) {
    if (!password.trim()) throw new BadRequestException('Enter your password.')

    const prismaUser = await prisma.user.findUnique({ where: { email } })
    if (!prismaUser) throw new UnauthorizedException(NO_ACCOUNT_ERROR)

    const valid = await bcrypt.compare(password, prismaUser.passwordHash)
    if (!valid) throw new UnauthorizedException(WRONG_PASSWORD_ERROR)
    this.enforceLoginRateLimit(`${ip}:${email}`, TOO_MANY_SIGNINS)
    const application = await prisma.merchantApplication.findFirst({ where: { email, status: 'approved' }, select: { merchantId: true } })
    if (!application?.merchantId) throw new UnauthorizedException(ACCOUNT_NOT_READY_ERROR)
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
    return { success: true, ...(await this.issueSession(application.user)) }
  }

  async refreshSession(refreshToken: string | undefined) {
    if (!refreshToken) throw new UnauthorizedException('Refresh token is missing')
    const now = new Date()
    const tokenHash = this.hashRefreshToken(refreshToken)
    const rotated = await prisma.$transaction(async (tx) => {
      const current = await tx.refreshToken.findUnique({
        where: { tokenHash },
        include: { user: true },
      })
      if (!current || current.revokedAt || current.expiresAt <= now) return null

      const revoked = await tx.refreshToken.updateMany({
        where: { id: current.id, revokedAt: null, expiresAt: { gt: now } },
        data: { revokedAt: now },
      })
      if (revoked.count !== 1) return null

      const nextToken = this.newRefreshToken()
      await tx.refreshToken.create({
        data: {
          userId: current.userId,
          tokenHash: this.hashRefreshToken(nextToken),
          expiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_MS),
        },
      })
      return { user: current.user, refreshToken: nextToken }
    })

    if (!rotated) throw new UnauthorizedException('Refresh token is invalid or expired')
    return { ...this.authPayload(rotated.user), refreshToken: rotated.refreshToken }
  }

  async revokeRefreshToken(refreshToken: string | undefined) {
    if (refreshToken) {
      await prisma.refreshToken.updateMany({
        where: { tokenHash: this.hashRefreshToken(refreshToken), revokedAt: null },
        data: { revokedAt: new Date() },
      })
    }
    return { success: true }
  }

  private async issueSession(user: AuthenticatedUser) {
    const refreshToken = this.newRefreshToken()
    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: this.hashRefreshToken(refreshToken),
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      },
    })
    return { ...this.authPayload(user), refreshToken }
  }

  private newRefreshToken() {
    return randomBytes(48).toString('base64url')
  }

  private hashRefreshToken(token: string) {
    return createHash('sha256').update(token).digest('hex')
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

  private enforceLoginRateLimit(ip: string, message = 'Too many attempts. Try again in a minute.') {
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
      throw new UnauthorizedException(message)
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

  private signupEmailKey(email: string) {
    return `SIGNUP:${email}`
  }

  private async assertDeliverableEmail(email: string) {
    if (email.startsWith('mailto:') || email.includes(' ') || !DELIVERABLE_EMAIL.test(email)) {
      throw new BadRequestException('Enter a real email address, like you@gmail.com.')
    }
    const domain = email.split('@')[1]
    const reachable = await this.domainCanReceiveMail(domain)
    if (reachable === false) throw new BadRequestException('That email domain can’t receive mail. Check the address and try again.')
  }

  private async domainCanReceiveMail(domain: string): Promise<boolean | null> {
    for (const servers of [['1.1.1.1'], ['8.8.8.8']]) {
      const resolver = new Resolver()
      resolver.setServers(servers)
      try {
        const records = await Promise.race([
          resolver.resolveMx(domain),
          new Promise<never>((_, reject) => setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'ETIMEOUT' })), 4000)),
        ])
        if (records.length) return true
      } catch (error) {
        const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : ''
        if (code === 'ENOTFOUND') return false
        if (code !== 'ENODATA' && code !== 'ENOTIMP') continue
      }
      try {
        const addresses = await resolver.resolve4(domain)
        if (addresses.length) return true
      } catch (error) {
        const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : ''
        if (code === 'ENOTFOUND' || code === 'ENODATA') return false
      }
    }
    return null
  }

  private async issueSignupEmailCode(email: string) {
    this.enforceOtpRateLimit(`signup-send:${email}`)
    const code = String(randomInt(100000, 1000000))
    const hashedCode = await bcrypt.hash(code, 12)
    const merchantId = this.signupEmailKey(email)
    await prisma.otpCode.updateMany({ where: { merchantId, used: false }, data: { used: true } })
    await prisma.otpCode.create({ data: { merchantId, hashedCode, expiresAt: new Date(Date.now() + 10 * 60_000) } })
    try {
      await this.resend.sendSignupEmailCode({ to: email, code })
    } catch (error) {
      console.error('[auth] signup email code delivery failed', error)
      throw new BadRequestException('We could not send a code to that email. Check the address and try again.')
    }
  }

  private async consumeSignupEmailCode(email: string, code: string) {
    if (!/^\d{6}$/.test(code)) throw new BadRequestException('Enter the 6-digit code from your email.')
    this.enforceOtpRateLimit(`signup-check:${email}`)
    const otp = await prisma.otpCode.findFirst({
      where: { merchantId: this.signupEmailKey(email), used: false },
      orderBy: { createdAt: 'desc' },
    })
    if (!otp || otp.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('That code is expired. Request a new one.')
    }
    const valid = await bcrypt.compare(code, otp.hashedCode)
    if (!valid) throw new BadRequestException('That code does not match. Check the inbox and try again.')
    await prisma.otpCode.update({ where: { id: otp.id }, data: { used: true } })
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

  private authPayload(user: AuthenticatedUser) {
    const publicUser = this.publicUser(user)
    const token = this.jwtService.sign({ sub: user.id, email: user.email })
    return {
      token,
      access_token: token,
      user: publicUser,
    }
  }

  private publicUser(user: AuthenticatedUser) {
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
