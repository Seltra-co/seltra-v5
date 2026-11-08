'use client'

import { Suspense, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AuthFlowModal } from '@/components/marketing/AuthFlowModal'
import { clearSeltraSession, fetchSeltraAuthMe, fetchWithSeltraAuth } from '@/lib/auth-session'

function AuthContent() {
  const router = useRouter()
  const params = useSearchParams()
  const next = params.get('next') ?? '/dashboard'

  useEffect(() => {
    const token = localStorage.getItem('seltra:token')
    if (!token) return

    let cancelled = false
    const restoreSession = async () => {
      try {
        const profile = await fetchSeltraAuthMe()
        if (cancelled) return
        if (!profile.ok) {
          if (profile.status === 401) clearSeltraSession()
          return
        }

        const response = await fetchWithSeltraAuth('/api/v5/seltra/store', { cache: 'no-store' })
        if (cancelled) return
        if (!response.ok) {
          if (response.status === 401) clearSeltraSession()
          return
        }
        const stores = await response.json()
        router.replace(Array.isArray(stores) && stores.length > 0 ? '/dashboard' : '/onboarding')
      } catch {
        // Keep the login form available when the API is temporarily unreachable.
      }
    }

    void restoreSession()
    return () => { cancelled = true }
  }, [router])

  return <AuthFlowModal open variant="page" nextPath={next} onClose={() => router.push('/')} />
}

export default function AuthPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#f7fbf7]" />}>
      <AuthContent />
    </Suspense>
  )
}
