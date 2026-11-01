import { withDatabaseTimeouts } from '../db/connection-url'
import { retryDatabaseQuery } from '../db/retry-query'

describe('Prisma connection resilience', () => {
  afterEach(() => {
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  it('adds connection and pool timeouts without replacing existing URL options', () => {
    const url = withDatabaseTimeouts('postgresql://user:password@db.example.test/store?sslmode=require')
    const parsed = new URL(url)

    expect(parsed.searchParams.get('connect_timeout')).toBe('15')
    expect(parsed.searchParams.get('pool_timeout')).toBe('30')
    expect(parsed.searchParams.get('sslmode')).toBe('require')
  })

  it('preserves explicit connection timeout settings', () => {
    const url = withDatabaseTimeouts('postgresql://user:password@db.example.test/store?connect_timeout=8&pool_timeout=12')
    const parsed = new URL(url)

    expect(parsed.searchParams.get('connect_timeout')).toBe('8')
    expect(parsed.searchParams.get('pool_timeout')).toBe('12')
  })

  it('retries P1001 with backoff and resolves after the connection recovers', async () => {
    jest.useFakeTimers()
    jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    const query = jest.fn()
      .mockRejectedValueOnce({ code: 'P1001' })
      .mockRejectedValueOnce({ errorCode: 'P1001' })
      .mockResolvedValue('connected')

    const result = retryDatabaseQuery(query)
    await jest.advanceTimersByTimeAsync(1_500)

    await expect(result).resolves.toBe('connected')
    expect(query).toHaveBeenCalledTimes(3)
    expect(console.warn).toHaveBeenCalledTimes(2)
  })


  it('does not retry unrelated database errors', async () => {
    const error = { code: 'P2002' }
    const query = jest.fn().mockRejectedValue(error)

    await expect(retryDatabaseQuery(query)).rejects.toBe(error)
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('rethrows P1001 after two retries', async () => {
    jest.useFakeTimers()
    jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    const error = { code: 'P1001' }
    const query = jest.fn().mockRejectedValue(error)

    const result = retryDatabaseQuery(query)
    const rejection = expect(result).rejects.toBe(error)
    await jest.advanceTimersByTimeAsync(1_500)

    await rejection
    expect(query).toHaveBeenCalledTimes(3)
    expect(console.warn).toHaveBeenCalledTimes(2)
  })
})
