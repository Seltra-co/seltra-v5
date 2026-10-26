import { Body, Controller, Delete, Get, Headers, Patch, Post, Query, Req, Res, UnauthorizedException } from '@nestjs/common'
import type { Request, Response } from 'express'
import { AuthService } from './auth.service'
import { ApiExcludeController } from '@nestjs/swagger'
import { IsBoolean, IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator'

class OnboardingPreferencesDto {
  @IsOptional() @IsString() @MaxLength(80)
  completedTourVersion?: string

  @IsOptional() @IsString() @MaxLength(80)
  dismissedAnnouncementVersion?: string
}

class SignupDto {
  @IsEmail() @MaxLength(255)
  email!: string

  @IsOptional()
  @IsString() @MaxLength(120)
  name?: string

  @IsOptional()
  @IsString() @MaxLength(120)
  full_name?: string

  @IsString() @MaxLength(40) phone!: string
  @IsString() @MaxLength(160) business_name!: string
  @IsString() @MaxLength(80) business_type!: string
  @IsString() @MaxLength(160) store_name!: string
  @IsString() @MaxLength(400) what_you_sell!: string
  @IsString() @MaxLength(120) based_in!: string
  @IsString() @MaxLength(100) monthly_revenue!: string
  @IsString() @MinLength(10) @MaxLength(128) password!: string
  @IsOptional() @IsString() @MaxLength(600) existing_links?: string
  @IsOptional() @IsString() @MaxLength(120) ai_familiarity?: string
  @IsOptional() @IsBoolean() ai_used_before?: boolean
  @IsOptional() @IsString() @MaxLength(300) ai_tools_used?: string
  @IsOptional() @IsString() @MaxLength(600) ai_feelings?: string
  @IsOptional() @IsString() @MaxLength(100) allow_ai_help?: string
}

class SigninDto {
  @IsEmail()
  email!: string

  @IsOptional()
  @IsString()
  merchantId?: string

  @IsOptional()
  @IsString()
  password?: string
}

class ForgotPasswordDto {
  @IsEmail()
  email!: string
}

class VerifyResetDto {
  @IsEmail()
  email!: string

  @IsString()
  @MinLength(4)
  code!: string
}

class ResetPasswordDto {
  @IsEmail()
  email!: string

  @IsString()
  @MinLength(4)
  code!: string

  @IsString()
  @MinLength(8)
  password!: string
}

class OtpVerifyDto {
  @IsString()
  @MinLength(1)
  merchantId!: string

  @IsString()
  @MinLength(4)
  code!: string
}

@ApiExcludeController()
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('signup')
  signup(@Body() _body: SignupDto, @Req() req: Request) {
    return this.authService.registerMerchant(_body, this.requestIp(req))
  }

  @Get('email/unsubscribe')
  showUnsubscribeConfirmation(@Query('user') userId: string, @Query('token') token: string, @Res() response: Response) {
    const action = `/api/v5/auth/email/unsubscribe?user=${encodeURIComponent(userId || '')}&token=${encodeURIComponent(token || '')}`
    return response.type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Email preferences | Seltra</title></head><body style="margin:0;background:#f7f8f7;font-family:Arial,Helvetica,sans-serif;color:#17211a"><main style="max-width:480px;margin:12vh auto;padding:36px 28px;background:#fff;border:1px solid #e5e7eb;border-radius:16px"><img src="https://seltra.co/assets/brand/Glossy%20Green%20Geometric%20App%20Icon%20-%20v5.png" alt="Seltra" width="52" height="52" style="display:block;object-fit:cover;border-radius:12px"><h1 style="margin:24px 0 8px;font-size:24px">Email preferences</h1><p style="margin:0 0 24px;line-height:1.6;color:#52525b">Confirm that you want to stop receiving Seltra product announcements. This won’t affect important account or security emails.</p><form method="post" action="${action}"><button type="submit" style="border:0;border-radius:8px;background:#202522;color:#fff;padding:12px 18px;font-size:15px;font-weight:600;cursor:pointer">Unsubscribe from product updates</button></form></main></body></html>`)
  }

  @Post('email/unsubscribe')
  async unsubscribeFromProductUpdates(@Query('user') userId: string, @Query('token') token: string, @Res() response: Response) {
    await this.authService.unsubscribeFromProductUpdates(userId, token)
    return response.type('html').send('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribed | Seltra</title></head><body style="margin:0;background:#f7f8f7;font-family:Arial,Helvetica,sans-serif;color:#17211a"><main style="max-width:480px;margin:12vh auto;padding:36px 28px;background:#fff;border:1px solid #e5e7eb;border-radius:16px"><h1 style="margin:0 0 8px;font-size:24px">You’re unsubscribed</h1><p style="margin:0;line-height:1.6;color:#52525b">You won’t receive further Seltra product announcements. Important account and security emails will still reach you.</p></main></body></html>')
  }

  @Post('signin')
  signin(@Body() body: SigninDto, @Req() req: Request) {
    return this.authService.signin(body, this.requestIp(req))
  }

  @Post('login')
  login(@Body() body: SigninDto, @Req() req: Request) {
    return this.authService.signin(body, this.requestIp(req))
  }

  @Post('forgot-password')
  forgotPassword(@Body() body: ForgotPasswordDto) {
    return this.authService.requestPasswordReset(body.email)
  }

  @Post('forgot-password/verify')
  verifyResetCode(@Body() body: VerifyResetDto) {
    return this.authService.verifyPasswordResetCode(body.email, body.code)
  }

  @Post('reset-password')
  resetPassword(@Body() body: ResetPasswordDto) {
    return this.authService.resetPassword(body.email, body.code, body.password)
  }

  @Post('otp/verify')
  verifyOtp(@Body() body: OtpVerifyDto, @Req() req: Request) {
    return this.authService.verifyOtp(body.merchantId, body.code, this.requestIp(req))
  }

  @Get('me')
  me(@Headers('authorization') authorization?: string) {
    const token = authorization?.replace(/^Bearer\s+/i, '')
    if (!token) throw new UnauthorizedException('Missing bearer token')
    return this.authService.me(token)
  }

  @Patch('preferences/onboarding')
  updateOnboardingPreferences(@Headers('authorization') authorization: string | undefined, @Body() body: OnboardingPreferencesDto) {
    const token = authorization?.replace(/^Bearer\s+/i, '')
    if (!token) throw new UnauthorizedException('Missing bearer token')
    return this.authService.updateOnboardingPreferences(token, body)
  }

  @Delete('logout')
  logout() {
    return { success: true }
  }

  @Post('logout')
  logoutPost() {
    return { success: true }
  }

  private requestIp(req: Request) {
    return req.ip
  }
}
