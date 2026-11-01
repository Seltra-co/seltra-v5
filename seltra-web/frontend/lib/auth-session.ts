let refreshInFlight: Promise<string | null> | null = null

export function storeSeltraSession(input: {
  access_token: string
  user: unknown
}) {
  if (!input.access_token) throw new Error('The server did not return an access token.')
  localStorage.setItem('seltra:token', input.access_token)
  localStorage.setItem('seltra:user', JSON.stringify(input.user))
}

export function refreshSeltraAccessToken() {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      const response = await fetch('/api/v5/auth/refresh', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      })
      if (response.status === 401) return null
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body?.message ?? `Session refresh failed (HTTP ${response.status}).`)
      }

      const body = await response.json() as { access_token?: string; token?: string }
      const accessToken = body.access_token ?? body.token
      if (!accessToken) throw new Error('The server did not return a refreshed access token.')
      localStorage.setItem('seltra:token', accessToken)
      return accessToken
    })().finally(() => {
      refreshInFlight = null
    })
  }
  return refreshInFlight
}

export async function fetchWithSeltraAuth(input: RequestInfo | URL, init: RequestInit = {}) {
  const token = localStorage.getItem('seltra:token')
  const headers = new Headers(init.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)

  const request = { ...init, headers, credentials: 'include' as const }
  const response = await fetch(input, request)
  if (response.status !== 401 || !token || token === 'dev-preview') return response

  // Another dashboard tab may already have rotated the refresh cookie and
  // stored a newer access token. Retry with that token before rotating again.
  const currentToken = localStorage.getItem('seltra:token')
  if (currentToken && currentToken !== token) {
    headers.set('Authorization', `Bearer ${currentToken}`)
    const crossTabRetry = await fetch(input, request)
    if (crossTabRetry.status !== 401) return crossTabRetry
  }

  let refreshedToken: string | null
  try {
    refreshedToken = await refreshSeltraAccessToken()
  } catch (error) {
    console.error('[auth] Could not refresh the Seltra session.', error)
    throw error
  }
  if (!refreshedToken) {
    // Avoid logging the user out if a concurrent tab refreshed while this
    // request was waiting for the refresh endpoint.
    const latestToken = localStorage.getItem('seltra:token')
    if (latestToken && latestToken !== token) {
      headers.set('Authorization', `Bearer ${latestToken}`)
      const latestRetry = await fetch(input, request)
      if (latestRetry.status !== 401) return latestRetry
    }
    window.dispatchEvent(new Event('seltra:auth-expired'))
    return response
  }

  headers.set('Authorization', `Bearer ${refreshedToken}`)
  const retriedResponse = await fetch(input, request)
  if (retriedResponse.status === 401) window.dispatchEvent(new Event('seltra:auth-expired'))
  return retriedResponse
}

export function clearSeltraSession() {
  ;['seltra:token', 'seltra:user', 'seltra:active_store'].forEach((key) => localStorage.removeItem(key))
}
