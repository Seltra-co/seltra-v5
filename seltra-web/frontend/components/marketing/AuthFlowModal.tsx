'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001'

type Step = 'login' | 'forgot-email' | 'otp' | 'reset'

type AuthResponse = { access_token?: string; token?: string; user: unknown }

async function apiPost<T>(path: string, body: unknown): Promise<{ data: T | null; error: string | null }> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      const message = json?.message ?? json?.error ?? `HTTP ${res.status}`
      return { data: null, error: Array.isArray(message) ? message[0] : String(message) }
    }
    return { data: json as T, error: null }
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : 'Network error' }
  }
}

function storeSession(data: AuthResponse) {
  const token = data.access_token ?? data.token ?? ''
  localStorage.setItem('seltra:token', token)
  localStorage.setItem('seltra:user', JSON.stringify(data.user))
}

function SlashMark() {
  return (
    <div aria-hidden className="mt-[clamp(0.35rem,1.4dvh,1.75rem)] flex items-end gap-[5px] text-[#16a34a]">
      {Array.from({ length: 14 }).map((_, index) => (
        <span key={index} className="block h-[clamp(10px,2.2dvh,18px)] w-[2px] origin-bottom -rotate-[32deg] rounded-full bg-current" />
      ))}
    </div>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="text-[clamp(0.8125rem,1.9dvh,0.9375rem)] font-medium leading-none text-neutral-900">{label}</span>
      <div className="mt-[clamp(0.3rem,0.8dvh,0.625rem)]">{children}</div>
      {hint ? <p className="mt-[clamp(0.35rem,1dvh,0.75rem)] text-[clamp(0.75rem,1.7dvh,0.9375rem)] leading-snug text-neutral-900">{hint}</p> : null}
    </label>
  )
}

const inputClass =
  'h-[clamp(2.35rem,6dvh,3.25rem)] w-full rounded-[14px] border border-[#d5d5d5] bg-white px-4 text-[clamp(0.8125rem,1.8dvh,0.9375rem)] text-neutral-900 outline-none transition-colors placeholder:text-neutral-400 focus:border-[#16a34a]'

export function AuthFlowModal({
  open,
  onClose,
  nextPath = '/dashboard',
  variant = 'modal',
}: {
  open: boolean
  onClose: () => void
  nextPath?: string
  variant?: 'modal' | 'page'
}) {
  const router = useRouter()
  const [step, setStep] = useState<Step>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [otp, setOtp] = useState('')
  const [nextPassword, setNextPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)

  useEffect(() => {
    if (!open) return
    setStep('login')
    setError(null)
    setLoading(false)
    setScale(1)
  }, [open])

  useEffect(() => {
    if (!open) return
    const frame = frameRef.current
    const panel = panelRef.current
    if (!frame || !panel) return

    const fit = () => {
      const availableH = frame.clientHeight
      const availableW = frame.clientWidth
      const panelH = panel.offsetHeight
      const panelW = panel.offsetWidth
      if (!availableH || !availableW || !panelH || !panelW) return
      const next = Math.min(1, availableH / panelH, availableW / panelW)
      setScale((current) => (Math.abs(current - next) < 0.01 ? current : Math.round(next * 1000) / 1000))
    }

    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(frame)
    observer.observe(panel)
    window.addEventListener('resize', fit)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', fit)
    }
  }, [open, step, error])

  useEffect(() => {
    if (!open || variant !== 'modal') return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !loading) onClose()
    }
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previous
      document.removeEventListener('keydown', onKey)
    }
  }, [open, loading, onClose, variant])

  if (!open) return null

  const finish = (data: AuthResponse) => {
    storeSession(data)
    onClose()
    router.push(nextPath)
  }

  const submitLogin = async (event: React.FormEvent) => {
    event.preventDefault()
    setLoading(true)
    setError(null)
    const { data, error: authError } = await apiPost<AuthResponse>('/api/v1/auth/login', { email, password })
    setLoading(false)
    if (authError || !data) {
      setError(authError ?? 'Could not log in')
      return
    }
    finish(data)
  }

  const submitEmail = async (event: React.FormEvent) => {
    event.preventDefault()
    setLoading(true)
    setError(null)
    const { error: sendError } = await apiPost('/api/v1/auth/forgot-password', { email })
    setLoading(false)
    if (sendError) {
      setError(sendError)
      return
    }
    setOtp('')
    setStep('otp')
  }

  const submitOtp = async (event: React.FormEvent) => {
    event.preventDefault()
    if (otp.trim().length < 4) {
      setError('Enter the 4-digit code')
      return
    }
    setLoading(true)
    setError(null)
    const { error: verifyError } = await apiPost('/api/v1/auth/forgot-password/verify', { email, code: otp })
    setLoading(false)
    if (verifyError) {
      setError(verifyError)
      return
    }
    setNextPassword('')
    setConfirmPassword('')
    setStep('reset')
  }

  const submitReset = async (event: React.FormEvent) => {
    event.preventDefault()
    if (nextPassword.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }
    if (nextPassword !== confirmPassword) {
      setError('Passwords do not match')
      return
    }
    setLoading(true)
    setError(null)
    const { data, error: resetError } = await apiPost<AuthResponse>('/api/v1/auth/reset-password', {
      email,
      code: otp,
      password: nextPassword,
    })
    setLoading(false)
    if (resetError || !data) {
      setError(resetError ?? 'Could not reset password')
      return
    }
    toast.success('Password updated')
    finish(data)
  }

  const title =
    step === 'login' ? 'Log in' : step === 'reset' ? 'Reset Password' : 'Forgot Password?'

  const onSubmit =
    step === 'login' ? submitLogin : step === 'forgot-email' ? submitEmail : step === 'otp' ? submitOtp : submitReset

  const card = (
    <div
      role="dialog"
      aria-modal={variant === 'modal'}
      aria-labelledby="auth-flow-title"
      className="relative flex w-full flex-col overflow-hidden rounded-[clamp(1.15rem,2vw,1.75rem)] bg-[#f4f6f4] px-[clamp(1rem,4vw,2rem)] py-[clamp(0.7rem,2.4dvh,2.25rem)] shadow-[0_24px_80px_-36px_rgba(15,23,15,0.45)]"
    >
      <div className="flex items-center justify-between gap-3">
        <img src="/seltra/hero/seltra-logo.png" alt="seltra" className="h-[clamp(1.15rem,2.6dvh,1.75rem)] w-auto object-contain" />
        <h2 id="auth-flow-title" className="text-[clamp(1.05rem,2.6dvh,1.35rem)] font-semibold tracking-[-0.03em] text-[#16803c]">
          {title}
        </h2>
      </div>

      <form onSubmit={onSubmit} className="flex flex-col">
        <div className="mt-[clamp(0.7rem,2.6dvh,2.25rem)] flex flex-col gap-[clamp(0.55rem,1.8dvh,1.5rem)]">
          {step === 'login' && (
            <>
              <Field label="Email">
                <input
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="Email address"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className={inputClass}
                />
              </Field>
              <Field label="Password">
                <input
                  type="password"
                  required
                  autoComplete="current-password"
                  placeholder="Password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className={inputClass}
                />
              </Field>
              <button
                type="button"
                onClick={() => {
                  setError(null)
                  setStep('forgot-email')
                }}
                className="text-left text-[clamp(0.8125rem,1.8dvh,0.9375rem)] font-semibold leading-none text-neutral-950"
              >
                Forgot password?
              </button>
            </>
          )}

          {step === 'forgot-email' && (
            <Field label="Enter Email" hint="An OTP will be sent to your email">
              <input
                type="email"
                required
                autoComplete="email"
                placeholder="Email address"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className={inputClass}
              />
            </Field>
          )}

          {step === 'otp' && (
            <Field label="Enter OTP">
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={4}
                required
                placeholder="----"
                value={otp}
                onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 4))}
                className={`${inputClass} tracking-[0.45em]`}
              />
            </Field>
          )}

          {step === 'reset' && (
            <>
              <Field label="New Password">
                <input
                  type="password"
                  required
                  autoComplete="new-password"
                  placeholder="Password"
                  value={nextPassword}
                  onChange={(event) => setNextPassword(event.target.value)}
                  className={inputClass}
                />
              </Field>
              <Field label="Confirm new password">
                <input
                  type="password"
                  required
                  autoComplete="new-password"
                  placeholder="Password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  className={inputClass}
                />
              </Field>
            </>
          )}
        </div>

        {error ? <p className="mt-[clamp(0.35rem,1dvh,1rem)] text-[clamp(0.75rem,1.6dvh,0.875rem)] leading-snug text-red-600">{error}</p> : null}

        <button
          type="submit"
          disabled={loading}
          className="mt-[clamp(0.55rem,1.8dvh,1.75rem)] h-[clamp(2.35rem,6dvh,3.25rem)] w-full rounded-[14px] bg-[#16a34a] text-[clamp(0.8125rem,1.8dvh,0.9375rem)] font-medium text-white transition-colors hover:bg-[#15803d] disabled:opacity-70"
        >
          {loading ? 'Please wait…' : step === 'login' ? 'Log in' : 'Continue'}
        </button>
        <SlashMark />
        {step === 'login' ? (
          <p className="pt-[clamp(0.45rem,2dvh,2.5rem)] text-center text-[clamp(0.75rem,1.7dvh,0.875rem)] leading-snug text-neutral-600">
            Don&apos;t have an account?{' '}
            <button
              type="button"
              onClick={() => {
                onClose()
                router.push('/apply')
              }}
              className="font-semibold text-neutral-950"
            >
              Sign up
            </button>
          </p>
        ) : null}
      </form>
    </div>
  )

  const fitted = (
    <div ref={frameRef} className="pointer-events-none relative z-10 h-full w-full overflow-hidden">
      <div
        ref={panelRef}
        className="pointer-events-auto absolute left-1/2 top-1/2 w-full max-w-[440px]"
        style={{ transform: `translate(-50%, -50%) scale(${scale})` }}
      >
        {card}
      </div>
    </div>
  )

  if (variant === 'page') {
    return <div className="h-dvh overflow-hidden bg-[#f7fbf7] p-3 sm:p-4">{fitted}</div>
  }

  return (
    <div className="fixed inset-0 z-[80] overflow-hidden p-3 sm:p-4">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-neutral-950/35"
        onClick={() => {
          if (!loading) onClose()
        }}
      />
      {fitted}
    </div>
  )
}
