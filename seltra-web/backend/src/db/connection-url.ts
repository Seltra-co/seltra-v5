export function withDatabaseTimeouts(connectionString: string) {
  const url = new URL(connectionString)
  if (!url.searchParams.has('connect_timeout')) url.searchParams.set('connect_timeout', '15')
  if (!url.searchParams.has('pool_timeout')) url.searchParams.set('pool_timeout', '30')
  return url.toString()
}
