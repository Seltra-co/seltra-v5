'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useStore } from './StoreContext'

type CoreSession = {
  coreToken: string
  expiresIn: number
  workspaceId: string
  coreWorkspaceKey: string
  storeSlug: string
  plan: string
  limits: Record<string, unknown>
}

type WorkspaceContextValue = {
  session: CoreSession | null
  loading: boolean
  error: string | null
  refreshSession: () => Promise<CoreSession>
  clearSession: () => void
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { activeStore } = useStore()
  const [session, setSession] = useState<CoreSession | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const clearSession = useCallback(() => {
    setSession(null)
    setError(null)
  }, [])

  const refreshSession = useCallback(async () => {
    const tenantId = activeStore?.id
    const accessToken = typeof window === 'undefined' ? null : localStorage.getItem('seltra:token')
    if (!tenantId || !accessToken) {
      clearSession()
      throw new Error(!tenantId ? 'Select a store to open its builder.' : 'Sign in again to continue.')
    }

    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/v5/builder/session', {
        method: 'POST',
        headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ tenantId }),
        cache: 'no-store',
      })
      const body = await response.json().catch(() => ({})) as Partial<CoreSession> & { message?: string }
      if (response.status === 401 && typeof window !== 'undefined') window.dispatchEvent(new Event('seltra:auth-expired'))
      if (!response.ok || !body.coreToken) {
        const reason = body.message || (response.status === 403 ? 'AI builder access is unavailable for this store.' : 'Could not connect to the Seltra builder.')
        throw new Error(reason)
      }
      const next = body as CoreSession
      setSession(next)
      return next
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Could not connect to the Seltra builder.'
      setSession(null)
      setError(message)
      throw cause instanceof Error ? cause : new Error(message)
    } finally {
      setLoading(false)
    }
  }, [activeStore?.id, clearSession])

  useEffect(() => {
    clearSession()
  }, [activeStore?.id, clearSession])

  useEffect(() => {
    const onLogout = () => clearSession()
    const onStorage = (event: StorageEvent) => {
      if (event.key === 'seltra:token' && !event.newValue) clearSession()
    }
    window.addEventListener('seltra:auth-expired', onLogout)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener('seltra:auth-expired', onLogout)
      window.removeEventListener('storage', onStorage)
    }
  }, [clearSession])

  useEffect(() => {
    if (!session) return
    const timer = window.setInterval(() => { void refreshSession().catch(() => undefined) }, Math.max(60_000, (session.expiresIn - 60) * 1000))
    return () => window.clearInterval(timer)
  }, [refreshSession, session])

  const value = useMemo(() => ({ session, loading, error, refreshSession, clearSession }), [session, loading, error, refreshSession, clearSession])
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}

export function useWorkspace() {
  const value = useContext(WorkspaceContext)
  if (!value) throw new Error('useWorkspace must be used within WorkspaceProvider')
  return value
}
