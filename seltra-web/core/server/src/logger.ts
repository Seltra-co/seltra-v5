import { randomUUID } from "node:crypto";

export interface StructuredLogFields {
  [key: string]: unknown;
}

export function errorLogFields(error: unknown): StructuredLogFields {
  const record = error && typeof error === "object"
    ? error as Record<string, unknown>
    : {};
  return {
    errorName: error instanceof Error ? error.name : typeof error,
    errorMessage: error instanceof Error ? error.message : String(error),
    errorCode: typeof record.code === "string" ? record.code : undefined,
    status: typeof record.status === "number" ? record.status : undefined,
  };
}

export function logError(
  event: string,
  fields: StructuredLogFields = {},
  error?: unknown,
): void {
  const entry = {
    level: "error",
    event,
    timestamp: new Date().toISOString(),
    requestId:
      typeof fields.requestId === "string" && fields.requestId
        ? fields.requestId
        : randomUUID(),
    ...fields,
    ...(error === undefined ? {} : errorLogFields(error)),
  };
  console.error(JSON.stringify(entry));
}
