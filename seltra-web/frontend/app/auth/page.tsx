'use client'

import { Suspense, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AuthFlowModal } from '@/components/marketing/AuthFlowModal'

const PRODUCTION_API_BASE = 'https://seltra-merchant-backend.onrender.com'
const SELTRA_PROXY = '/api/v5'

function apiBases() {
  const fromEnv = process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, '')
  const bases: string[] = [SELTRA_PROXY]
  if (fromEnv) bases.push(fromEnv)
  if (typeof window !== 'undefined') {
    const host = window.location.hostname
    if (host === 'localhost' || host === '127.0.0.1') {
      bases.push('http://127.0.0.1:3001', 'http://localhost:3001')
    }
  }
  if (!bases.includes(PRODUCTION_API_BASE)) bases.push(PRODUCTION_API_BASE)
  return Array.from(new Set(bases))
}

function apiUrl(base: string, path: string) {
  if (base === SELTRA_PROXY) return `${SELTRA_PROXY}${path.replace(/^\/api\/v5/, '')}`
  return `${base}${path}`
}

function AuthContent() {
  const router = useRouter()
  const params = useSearchParams()
  const next = params.get('next') ?? '/dashboard'

  useEffect(() => {
    const token = localStorage.getItem('seltra:token')
    if (!token) return

    const tryStores = async () => {
      for (const base of apiBases()) {
        try {
          const response = await fetch(apiUrl(base, '/api/v5/seltra/store'), {
            headers: { Authorization: `Bearer ${token}` },
          })
          if (!response.ok) continue
          const stores = await response.json()
          router.replace(Array.isArray(stores) && stores.length > 0 ? '/dashboard' : '/onboarding')
          return
        } catch {
          // try next base
        }
      }
      router.replace('/dashboard')
    }

    void tryStores()
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
