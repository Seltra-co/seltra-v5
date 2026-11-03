'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { clearSeltraSession, fetchWithSeltraAuth } from '@/lib/auth-session'

const AUTH_KEYS = ['seltra:token', 'seltra:user', 'seltra:active_store']

export function SessionGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const protectedPath = pathname.startsWith('/dashboard') || pathname.startsWith('/onboarding')
  const [authState, setAuthState] = useState<'loading' | 'authenticated' | 'unauthenticated'>(
    protectedPath || pathname.startsWith('/auth') ? 'loading' : 'authenticated',
  )

  useEffect(() => {
    if (!protectedPath && !pathname.startsWith('/auth')) {
      setAuthState('authenticated')
      return
    }

    const startedAt = Date.now()
    const minimumLoader = 250
    const resolve = async () => {
      const token = localStorage.getItem('seltra:token')
      if (!token) {
        await new Promise((resolveDelay) => window.setTimeout(resolveDelay, minimumLoader - (Date.now() - startedAt)))
        setAuthState('unauthenticated')
        if (protectedPath) router.replace(`/auth?next=${encodeURIComponent(pathname || '/dashboard')}`)
        return
      }
      if (token === 'dev-preview') {
        await new Promise((resolveDelay) => window.setTimeout(resolveDelay, Math.max(0, minimumLoader - (Date.now() - startedAt))))
        setAuthState('authenticated')
        return
      }

      try {
        const response = await fetchWithSeltraAuth('/api/v5/auth/me', { cache: 'no-store' })
        await new Promise((resolveDelay) => window.setTimeout(resolveDelay, Math.max(0, minimumLoader - (Date.now() - startedAt))))
        if (response.ok) {
          setAuthState('authenticated')
        } else {
          clearSeltraSession()
          setAuthState('unauthenticated')
          if (protectedPath) router.replace(`/auth?next=${encodeURIComponent(pathname || '/dashboard')}`)
        }
      } catch {
        await new Promise((resolveDelay) => window.setTimeout(resolveDelay, Math.max(0, minimumLoader - (Date.now() - startedAt))))
        // A network or refresh failure is not proof that the session is invalid.
        // Keep the dashboard rendered so authenticated data can recover instead
        // of immediately clearing the user's store, profile, and notifications.
        setAuthState('authenticated')
      }
    }

    setAuthState('loading')
    void resolve()

    if (pathname.startsWith('/auth')) return

    let loggingOut = false

    const logout = () => {
      if (loggingOut) return
      loggingOut = true
      void fetch('/api/v5/auth/logout', { method: 'POST', credentials: 'include' })
        .catch((error) => console.error('[auth] Could not revoke the Seltra session.', error))
      clearSeltraSession()
      AUTH_KEYS.forEach((key) => localStorage.removeItem(key))
      const next = `${window.location.pathname}${window.location.search}`
      router.replace(`/auth?next=${encodeURIComponent(next || '/dashboard')}`)
    }

    const handleStorage = (event: StorageEvent) => {
      if (event.key === 'seltra:token' && !event.newValue) logout()
    }
    window.addEventListener('storage', handleStorage)
    window.addEventListener('seltra:auth-expired', logout)

    return () => {
      window.removeEventListener('storage', handleStorage)
      window.removeEventListener('seltra:auth-expired', logout)
    }
  }, [pathname, protectedPath, router])

  if (authState === 'loading' && (protectedPath || pathname.startsWith('/auth'))) {
    return (
      <div className="fixed inset-0 z-[9999] grid place-items-center bg-[#111312]" role="status" aria-label="Loading Seltra">
        <img src="/assets/brand/mark.png" alt="" className="seltra-auth-pulse h-14 w-14 object-contain" />
      </div>
    )
  }

  return children
}