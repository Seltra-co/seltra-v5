import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common'
import type { Response, Request } from 'express'

@Catch()
export class OpsExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp()
    const response = ctx.getResponse<Response>()
    const request = ctx.getRequest<Request>()
    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR
    const body = exception instanceof HttpException ? exception.getResponse() : undefined
    const message = typeof body === 'object' && body && 'message' in body
      ? (body as { message: string | string[] }).message
      : status === 500 ? 'Internal server error' : String(body || 'Error')

    response.status(status).json({
      statusCode: status,
      error: this.errorName(status),
      message: Array.isArray(message) ? message.join(', ') : message,
      path: request.originalUrl || request.url,
      timestamp: new Date().toISOString(),
    })
  }

  private errorName(status: number) {
    const names: Record<number, string> = {
      400: 'BadRequest',
      401: 'Unauthorized',
      403: 'Forbidden',
      404: 'NotFound',
      413: 'PayloadTooLarge',
      500: 'InternalServerError',
    }
    return names[status] || 'Error'
  }
}
