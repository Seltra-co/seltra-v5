import { Body, Controller, Delete, Get, Headers, Post, Req, UnauthorizedException } from '@nestjs/common'
import type { Request } from 'express'
import { AuthService } from './auth.service'
import { ApiExcludeController } from '@nestjs/swagger'

class SignupDto {
  email!: string
  name?: string
  full_name?: string
}

class SigninDto {
  email!: string
  merchantId!: string
}

class OtpVerifyDto {
  merchantId!: string
  code!: string
}

@ApiExcludeController()
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('signup')
  signup(@Body() _body: SignupDto) {
    return this.authService.signup()
  }

  @Post('signin')
  signin(@Body() body: SigninDto, @Req() req: Request) {
    return this.authService.signin(body, this.requestIp(req))
  }

  @Post('login')
  login(@Body() body: SigninDto, @Req() req: Request) {
    return this.authService.signin(body, this.requestIp(req))
  }

  @Post('otp/verify')
  verifyOtp(@Body() body: OtpVerifyDto) {
    return this.authService.verifyOtp(body.merchantId, body.code)
  }

  @Get('me')
  me(@Headers('authorization') authorization?: string) {
    const token = authorization?.replace(/^Bearer\s+/i, '')
    if (!token) throw new UnauthorizedException('Missing bearer token')
    return this.authService.me(token)
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
    const forwarded = req.headers['x-forwarded-for']
    if (typeof forwarded === 'string') return forwarded.split(',')[0]?.trim() || req.ip
    return req.ip
  }
}
