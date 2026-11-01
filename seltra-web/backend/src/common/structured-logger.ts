import { randomUUID } from 'node:crypto'

export interface StructuredErrorFields {
  [key: string]: unknown
}

export function logStructuredError(
  event: string,
  fields: StructuredErrorFields = {},
  error?: unknown,
): void {
  const record = error && typeof error === 'object'
    ? error as Record<string, unknown>
    : {}
  const entry = {
    level: 'error',
    event,
    timestamp: new Date().toISOString(),
    requestId:
      typeof fields.requestId === 'string' && fields.requestId
        ? fields.requestId
        : randomUUID(),
    ...fields,
    ...(error === undefined ? {} : {
      errorName: error instanceof Error ? error.name : typeof error,
      errorMessage: error instanceof Error ? error.message : String(error),
      errorCode: typeof record.code === 'string' ? record.code : undefined,
      status: typeof record.status === 'number' ? record.status : undefined,
    }),
  }
  console.error(JSON.stringify(entry))
}
