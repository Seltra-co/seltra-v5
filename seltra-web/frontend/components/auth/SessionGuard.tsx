'use client'

import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { clearSeltraSession, getSupabase } from '@/lib/supabase'

const IDLE_TIMEOUT_MS = 60 * 60 * 1000
const LAST_ACTIVITY_KEY = 'seltra:last_activity'
const AUTH_KEYS = ['seltra:token', 'seltra:user', 'seltra:active_store']

function getToken() {
  return localStorage.getItem('seltra:token')
}

function getTokenExpiry(token: string) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1] ?? '')) as { exp?: number }
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null
  } catch {
    return null
  }
}

export function SessionGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()

  useEffect(() => {
    if (pathname.startsWith('/auth')) return

    let timer: ReturnType<typeof setTimeout> | undefined

    const logout = () => {
      try {
        void getSupabase().auth.signOut()
      } catch {
        // ignore missing config during logout
      }
      clearSeltraSession()
      AUTH_KEYS.forEach((key) => localStorage.removeItem(key))
      localStorage.removeItem(LAST_ACTIVITY_KEY)
      const next = `${window.location.pathname}${window.location.search}`
      router.replace(`/auth?next=${encodeURIComponent(next || '/dashboard')}`)
    }

    let unsubscribe: (() => void) | undefined
    try {
      const { data } = getSupabase().auth.onAuthStateChange((event, session) => {
        if (session?.access_token) {
          localStorage.setItem('seltra:token', session.access_token)
          return
        }
        if (event === 'SIGNED_OUT' && getToken() && getToken() !== 'dev-preview') {
          logout()
        }
      })
      unsubscribe = () => data.subscription.unsubscribe()
    } catch {
      // Supabase optional until env is ready
    }

    const scheduleLogout = () => {
      const token = getToken()
      if (!token) return

      const now = Date.now()
      const lastActivity = Number(localStorage.getItem(LAST_ACTIVITY_KEY)) || now
      const expiry = getTokenExpiry(token)
      const idleAt = lastActivity + IDLE_TIMEOUT_MS
      const logoutAt = expiry ? Math.min(idleAt, expiry) : idleAt
      timer = setTimeout(logout, Math.max(0, logoutAt - now))
    }

    const recordActivity = () => {
      if (!getToken()) return
      localStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now()))
      if (timer) clearTimeout(timer)
      scheduleLogout()
    }

    if (!getToken()) return
    recordActivity()

    const activityEvents = ['pointerdown', 'keydown', 'touchstart', 'scroll'] as const
    activityEvents.forEach((event) => window.addEventListener(event, recordActivity, { passive: true }))
    const handleStorage = (event: StorageEvent) => {
      if (event.key === 'seltra:token' && !event.newValue) logout()
    }
    window.addEventListener('storage', handleStorage)
    window.addEventListener('seltra:auth-expired', logout)

    return () => {
      if (timer) clearTimeout(timer)
      unsubscribe?.()
      activityEvents.forEach((event) => window.removeEventListener(event, recordActivity))
      window.removeEventListener('storage', handleStorage)
      window.removeEventListener('seltra:auth-expired', logout)
    }
  }, [pathname, router])

  return children
}