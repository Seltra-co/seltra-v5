'use client'

import { Suspense, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AuthFlowModal } from '@/components/marketing/AuthFlowModal'

const PRODUCTION_API_BASE = 'https://seltra-merchant-backend.onrender.com'

function apiBases() {
  const fromEnv = process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, '')
  const bases: string[] = ['']
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
          const response = await fetch(`${base}/api/v1/seltra/store`, {
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
