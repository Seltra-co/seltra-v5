'use client'
import { Suspense, useEffect, useState, type InputHTMLAttributes } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Eye, EyeOff, Mail, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from 'sonner'

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001'

function setToken(t: string) { localStorage.setItem('seltra:token', t) }
function setUser(u: unknown) { localStorage.setItem('seltra:user', JSON.stringify(u)) }
function getToken() { return typeof window !== 'undefined' ? localStorage.getItem('seltra:token') : null }

async function apiPost<T>(path: string, body: unknown): Promise<{ data: T | null; error: string | null }> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) return { data: null, error: json?.message ?? json?.error ?? `HTTP ${res.status}` }
    return { data: json as T, error: null }
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : 'Network error' }
  }
}

type AuthResponse = { access_token?: string; token?: string; user: unknown; otpRequired?: boolean }

function SensitiveInput({
  value,
  onChange,
  placeholder,
  className,
  inputMode,
  maxLength,
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
  className?: string
  inputMode?: InputHTMLAttributes<HTMLInputElement>['inputMode']
  maxLength?: number
}) {
  const [visible, setVisible] = useState(false)
  return (
    <div className="relative">
      <Input
        type={visible ? 'text' : 'password'}
        inputMode={inputMode}
        maxLength={maxLength}
        placeholder={placeholder}
        required
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${className ?? ''} pr-11`}
      />
      <button
        type="button"
        onClick={() => setVisible((current) => !current)}
        aria-label={visible ? `Hide ${placeholder}` : `Show ${placeholder}`}
        className="absolute right-3 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-lg text-white/50 transition-colors hover:bg-white/10 hover:text-white"
      >
        {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  )
}

function AuthContent() {
  const router = useRouter()
  const params = useSearchParams()
  const next = params.get('next') ?? '/dashboard'
  const [view, setView] = useState<'root' | 'email' | 'otp'>('root')
  const [email, setEmail] = useState('')
  const [merchantId, setMerchantId] = useState('')
  const [otp, setOtp] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!getToken()) return
    fetch(`${API_BASE}/api/v1/seltra/store`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    })
      .then((r) => r.json())
      .then((stores) => router.replace(Array.isArray(stores) && stores.length > 0 ? '/dashboard' : '/onboarding'))
      .catch(() => router.replace('/dashboard'))
  }, [router])

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    const { data, error } = await apiPost<AuthResponse>('/api/v1/auth/login', {
      email,
      merchantId,
    })
    if (error || !data) {
      toast.error(error ?? 'Auth failed')
      setLoading(false)
      return
    }

    if (data.otpRequired) {
      setView('otp')
      setLoading(false)
      return
    }

    const tok = data.access_token ?? data.token ?? ''
    setToken(tok)
    setUser(data.user)
    router.replace(next)
    setLoading(false)
  }

  return (
    <div className="auth-aurora relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,transparent_30%,hsl(0_0%_0%/0.6))]" />
      <div className="relative w-full max-w-md">
        <Link href="/" className="mb-6 flex items-center justify-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/20">
              <img src="https://res.cloudinary.com/dfmsaarli/image/upload/v1782364695/ICON_large_ngiv41.png" alt="Seltra" className="h-7 w-7 rounded-md" />
          </div>
          <span className="font-mono text-lg font-semibold text-white">seltra</span>
        </Link>
        <div className="glass rounded-3xl p-7 sm:p-9">
          {view === 'root' && (
            <>
              <div className="mb-8 flex flex-col items-center text-center">
                <h1 className="text-xl font-semibold text-white/95">Sign in to your merchant dashboard</h1>
                <p className="mt-1 text-sm text-white/50">Your credentials were provided by the Seltra team.</p>
              </div>
              <div className="space-y-3">
                <Button onClick={() => setView('email')} variant="outline" className="h-12 w-full rounded-full border-white/15 bg-white/5 text-white hover:bg-white/10 hover:text-white">
                  <Mail className="mr-2 h-4 w-4" /> Continue with Email
                </Button>
              </div>
              <p className="mt-8 text-center text-sm text-white/50">
                Interested in joining Seltra?{' '}
                <Link href="/apply" className="text-white underline-offset-2 hover:underline">
                  Apply for early access -&gt;
                </Link>
              </p>
            </>
          )}

          {view === 'email' && (
            <>
              <button onClick={() => setView('root')} className="mb-5 flex items-center gap-1.5 text-xs text-white/60 hover:text-white">
                <ArrowLeft className="h-3.5 w-3.5" /> back
              </button>
              <div className="mb-6">
                <h1 className="text-xl font-semibold text-white/95">Sign in with email and Merchant ID</h1>
                <p className="mt-1 text-sm text-white/50">Enter the email and Merchant ID provided by the Seltra team.</p>
              </div>
              <form onSubmit={handleAuth} className="space-y-3">
                <Input type="email" placeholder="you@store.com" required value={email} onChange={(e) => setEmail(e.target.value)}
                  className="h-12 rounded-xl border-white/10 bg-white/5 text-white placeholder:text-white/40" />
                <SensitiveInput
                  placeholder="Merchant ID"
                  value={merchantId}
                  onChange={(value) => setMerchantId(value.toUpperCase())}
                  className="h-12 rounded-xl border-white/10 bg-white/5 font-mono text-white placeholder:font-sans placeholder:text-white/40"
                />
                <Button type="submit" disabled={loading} className="h-12 w-full rounded-full bg-white font-medium text-black hover:bg-white/90">
                  {loading ? '...' : 'Sign in'}
                </Button>
              </form>
            </>
          )}

          {view === 'otp' && (
            <>
              <button onClick={() => setView('email')} className="mb-5 flex items-center gap-1.5 text-xs text-white/60 hover:text-white">
                <ArrowLeft className="h-3.5 w-3.5" /> back
              </button>
              <div className="mb-6">
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/20 text-primary">
                  <ShieldCheck className="h-5 w-5" />
                </div>
                <h1 className="text-xl font-semibold text-white/95">Verify your login</h1>
                <p className="mt-1 text-sm text-white/50">A verification code was sent to the phone number on your account.</p>
              </div>
              <form className="space-y-3">
                <SensitiveInput
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="6-digit code"
                  value={otp}
                  onChange={setOtp}
                  className="h-12 rounded-xl border-white/10 bg-white/5 font-mono text-white placeholder:font-sans placeholder:text-white/40"
                />
                <Button type="button" disabled className="h-12 w-full rounded-full bg-white font-medium text-black hover:bg-white/90">
                  Verify code
                </Button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default function AuthPage() {
  return (
    <Suspense fallback={null}>
      <AuthContent />
    </Suspense>
  )
}
