import { All, Body, Controller, Get, Headers, HttpCode, HttpException, HttpStatus, Ip, Logger, Param, Post, Req, Res } from '@nestjs/common'
import type { Request, Response } from 'express'
import { randomUUID } from 'node:crypto'
import { SeltraEngineService } from './engine.service'

@Controller('v1')
export class SeltraEngineController {
  private readonly logger = new Logger('SeltraEngineHttp')
  constructor(private readonly engine: SeltraEngineService) {}

  @Get('health')
  health(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const requestId = this.requestId(req, res)
    return { status: 'ok', service: 'seltra-engine', request_id: requestId }
  }

  @Post('images/generations')
  @HttpCode(HttpStatus.OK)
  async images(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Headers('authorization') authorization: string | undefined, @Headers('x-seltra-credit-identity') creditIdentity: string | undefined, @Ip() ip: string, @Body() body: Record<string, unknown>) {
    const { identity, requestId } = await this.authenticate(req, res, authorization, ip, creditIdentity)
    return this.engine.generateImages(identity, body, requestId)
  }

  @Get('models')
  async models(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Headers('authorization') authorization: string | undefined, @Ip() ip: string) {
    await this.authenticate(req, res, authorization, ip)
    return this.engine.models()
  }

  @Post('chat/completions')
  @HttpCode(HttpStatus.OK)
  async completions(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Headers('authorization') authorization: string | undefined, @Headers('x-seltra-credit-identity') creditIdentity: string | undefined, @Ip() ip: string, @Body() body: Record<string, unknown>) {
    const { identity, requestId } = await this.authenticate(req, res, authorization, ip, creditIdentity)
    if (body.stream === true && !String(body.model ?? '').toLowerCase().includes('vision')) {
      const result = await this.engine.proxyChat(identity, body, requestId)
      const fullResult = result as any
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
      res.setHeader('Cache-Control', 'no-cache, no-transform')
      res.setHeader('Connection', 'keep-alive')
      const choice = fullResult.choices?.[0]
      const chunk = { id: fullResult.id ?? requestId, object: 'chat.completion.chunk', created: fullResult.created ?? Math.floor(Date.now() / 1000), model: fullResult.model ?? body.model, choices: [{ index: choice?.index ?? 0, delta: choice?.message ?? {}, finish_reason: choice?.finish_reason ?? 'stop' }] }
      res.write(`data: ${JSON.stringify(chunk)}\n\n`)
      if (body.stream_options && (body.stream_options as any).include_usage) res.write(`data: ${JSON.stringify({ id: chunk.id, object: 'chat.completion.chunk', choices: [], usage: fullResult.usage })}\n\n`)
      res.end('data: [DONE]\n\n')
      return
    }
    return this.engine.chatCompletions(identity, body, requestId)
  }

  @Get('assets/:id')
  async asset(@Param('id') id: string, @Res() res: Response) {
    const file = await this.engine.assetFile(id)
    if (!file) throw new HttpException({ error: { code: 'not_found', message: 'Asset not found.' } }, 404)
    res.setHeader('Content-Type', id.endsWith('.png') ? 'image/png' : 'image/jpeg')
    res.setHeader('Cache-Control', 'private, max-age=3600, immutable')
    return res.send(file)
  }

  @All(['tools/web-search', 'tools/web-crawl', 'tools/code-search', 'track-usage', 'audio/transcriptions', 'free/quota', 'free/chat/completions', 'responses', 'messages', 'sandboxes', 'sandboxes/:id', 'sandboxes/:id/:action', 'sandboxes/:id/:action/:subaction', 'sandboxes/reconcile'])
  async unsupported(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Headers('authorization') authorization: string | undefined, @Ip() ip: string) {
    await this.authenticate(req, res, authorization, ip)
    throw new HttpException({ error: { code: 'not_implemented', message: `Seltra Engine endpoint ${req.path} is not implemented.` } }, 501)
  }

  private async authenticate(req: Request, res: Response, authorization: string | undefined, ip: string, creditIdentity?: string) {
    const requestId = this.requestId(req, res)
    const identity = await this.engine.authenticate(authorization, creditIdentity)
    if (!identity) {
      const headerName = 'authorization'
      const raw = authorization?.trim() ?? ''
      let reason: 'missing_header' | 'wrong_scheme' | 'key_mismatch' = 'key_mismatch'
      let receivedLen = 0
      if (!raw) {
        reason = 'missing_header'
      } else if (!/^Bearer\s+\S/i.test(raw)) {
        reason = 'wrong_scheme'
      } else {
        receivedLen = raw.replace(/^Bearer\s+/i, '').trim().length
      }
      const expectedLen = (process.env.SELTRA_ENGINE_BOOTSTRAP_KEY ?? '').trim().length
      this.logger.warn(JSON.stringify({ event: 'request_rejected', requestId, route: req.path, status: 401, ip, reason, headerName, receivedLen, expectedLen }))
      throw new HttpException({ error: { code: 'invalid_api_key', message: 'A valid Seltra Engine API key is required.' } }, 401)
    }
    const retryAfter = this.engine.enforceRateLimit(identity, ip || 'unknown')
    if (retryAfter) {
      res.setHeader('Retry-After', String(retryAfter))
      this.logger.warn(JSON.stringify({ event: 'rate_limited', requestId, keyId: identity.id, route: req.path, status: 429, retryAfter }))
      throw new HttpException({ error: { code: 'rate_limited', message: 'Seltra Engine rate limit exceeded.' } }, 429)
    }
    this.logger.log(JSON.stringify({ event: 'request_authenticated', requestId, keyId: identity.id, route: req.path, method: req.method, ip }))
    return { identity, requestId }
  }

  private requestId(req: Request, res: Response) {
    const candidate = req.header('x-request-id') ?? req.header('x-dyad-request-id')
    const requestId = candidate && /^[A-Za-z0-9._:-]{1,128}$/.test(candidate) ? candidate : randomUUID()
    res.setHeader('X-Request-ID', requestId)
    return requestId
  }
}
