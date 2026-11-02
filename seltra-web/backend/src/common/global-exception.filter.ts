import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common'
import type { Request, Response } from 'express'
import { logStructuredError } from './structured-logger'

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name)

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp()
    const response = ctx.getResponse<Response>()
    const request = ctx.getRequest<Request>()
    const status = exception instanceof HttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR

    logStructuredError('http_request_failed', {
      requestId:
        request.headers['x-request-id'] ??
        request.headers['x-dyad-request-id'],
      method: request.method,
      path: request.originalUrl || request.url,
      status,
    }, exception)

    if (response.headersSent) {
      response.end()
      return
    }

    const exceptionResponse = exception instanceof HttpException
      ? exception.getResponse()
      : undefined
    if (status >= 400 && status < 500) {
      this.logger.warn(JSON.stringify({
        event: 'http_4xx_response',
        requestId: request.headers['x-request-id'],
        method: request.method,
        path: request.originalUrl || request.url,
        status,
        response: exceptionResponse,
      }))
    }
    let message: unknown = exception instanceof Error ? exception.message : String(exception)
    if (typeof exceptionResponse === 'object' && exceptionResponse && 'message' in exceptionResponse) {
      message = (exceptionResponse as { message: unknown }).message
    }

    response.status(status).json({
      statusCode: status,
      message: Array.isArray(message) ? message.join(', ') : message,
      requestId: request.headers['x-request-id'],
      timestamp: new Date().toISOString(),
    })
  }
}
