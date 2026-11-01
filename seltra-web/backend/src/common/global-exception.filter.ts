import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common'
import type { Request, Response } from 'express'
import { logStructuredError } from './structured-logger'

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
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
