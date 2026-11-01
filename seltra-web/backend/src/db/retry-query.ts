const MAX_RETRIES = 2
const INITIAL_RETRY_DELAY_MS = 500

function getErrorCode(error: unknown) {
  if (typeof error !== 'object' || error === null) return undefined
  if ('code' in error && typeof error.code === 'string') return error.code
  if ('errorCode' in error && typeof error.errorCode === 'string') return error.errorCode
  return undefined
}

export async function retryDatabaseQuery<T>(query: () => Promise<T>, retryableCodes: readonly string[] = ['P1001']): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await query()
    } catch (error) {
      const errorCode = getErrorCode(error)
      if (!errorCode || !retryableCodes.includes(errorCode) || attempt >= MAX_RETRIES) throw error

      const delayMs = INITIAL_RETRY_DELAY_MS * 2 ** attempt
      console.warn(`Transient database connection failure (${errorCode}); retrying safe query in ${delayMs}ms.`)
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }
}
