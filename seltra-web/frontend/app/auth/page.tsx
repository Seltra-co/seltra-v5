'use client'

import { Suspense, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AuthFlowModal } from '@/components/marketing/AuthFlowModal'

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001'

function AuthContent() {
  const router = useRouter()
  const params = useSearchParams()
  const next = params.get('next') ?? '/dashboard'

  useEffect(() => {
    const token = localStorage.getItem('seltra:token')
    if (!token) return
    fetch(`${API_BASE}/api/v1/seltra/store`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((response) => response.json())
      .then((stores) => router.replace(Array.isArray(stores) && stores.length > 0 ? '/dashboard' : '/onboarding'))
      .catch(() => router.replace('/dashboard'))
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
