'use client'

import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { clearSeltraSession } from '@/lib/auth-session'

const AUTH_KEYS = ['seltra:token', 'seltra:user', 'seltra:active_store']

export function SessionGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()

  useEffect(() => {
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
  }, [pathname, router])

  return children
}