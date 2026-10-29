'use client'

import { useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { ArrowLeft, ArrowRight, Check, ChevronDown, Globe, Send, Sparkles } from 'lucide-react'
import { z } from 'zod'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

const PRODUCTION_API_BASE = 'https://seltra-merchant-backend.onrender.com'
/** Same-origin proxy that does not forward browser Origin (avoids Render CORS 500s). */
const SELTRA_PROXY_PREFIX = '/api/v5'

function submitUrls(): string[] {
  const fromEnv = process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, '')
  const urls = [`${SELTRA_PROXY_PREFIX}/auth/signup`]
  if (fromEnv) urls.push(`${fromEnv}/api/v5/auth/signup`)
  urls.push(`${PRODUCTION_API_BASE}/api/v5/auth/signup`)
  if (typeof window !== 'undefined') {
    const host = window.location.hostname
    if (host === 'localhost' || host === '127.0.0.1') {
      urls.push('http://127.0.0.1:3001/api/v5/auth/signup', 'http://localhost:3001/api/v5/auth/signup')
    }
  }
  return Array.from(new Set(urls))
}

const REGIONS: Record<string, string[]> = {
  Africa: ['Ghana', 'Nigeria', 'Kenya', 'South Africa', "Côte d'Ivoire", 'Senegal', 'Rwanda', 'Egypt', 'Other'],
  Europe: ['United Kingdom', 'Germany', 'France', 'Netherlands', 'Spain', 'Italy', 'Other'],
  'North America': ['United States', 'Canada', 'Mexico', 'Other'],
  'South America': ['Brazil', 'Argentina', 'Colombia', 'Chile', 'Other'],
  Asia: ['India', 'United Arab Emirates', 'Singapore', 'China', 'Japan', 'Other'],
  Oceania: ['Australia', 'New Zealand', 'Other'],
}

const BUSINESS_TYPES = [
  'Bakery',
  'Food / Beverage',
  'Fashion',
  'Beauty',
  'Services',
  'Electronics',
  'Health & Wellness',
  'Home & Living',
  'Art & Crafts',
  'Other',
]
const REVENUE_STAGES = [
  'Just starting out - no sales yet',
  'Early stage - under GHS 1,000/month',
  'Growing - GHS 1,000-10,000/month',
  'Established - GHS 10,000+/month',
]
const AI_FAMILIARITY = ['Yes, I use it often', 'I have heard of it', 'Not really']
const ALLOW_AI = ['Yes, let it run things', 'Maybe, show me first', 'I would rather do it myself']

const hasTwoNames = (name: string) => name.trim().split(/\s+/).filter((part) => part.length >= 2).length >= 2

const schema = z.object({
  full_name: z
    .string()
    .trim()
    .max(120)
    .refine(hasTwoNames, 'Enter your first and last name'),
  phone: z.string().trim().min(5, 'Phone is required').max(40),
  email: z.string().trim().email('Enter a valid email').max(255),
  business_name: z.string().trim().min(1, 'Business name is required').max(160),
  business_type: z.string().min(1, 'Pick a business type'),
  store_name: z.string().trim().min(1, 'Store name is required').max(160),
  what_you_sell: z.string().trim().min(1, 'Tell us what you sell').max(400),
  based_in: z.string().trim().min(1, 'Tell us where you are based').max(120),
  monthly_revenue: z.string().min(1, 'Pick your current stage'),
  existing_links: z.string().max(600).optional(),
  ai_familiarity: z.string().optional(),
  ai_used_before: z.boolean().optional(),
  ai_tools_used: z.string().max(300).optional(),
  ai_feelings: z.string().max(600).optional(),
  allow_ai_help: z.string().optional(),
})

type FormData = z.infer<typeof schema>

const STEPS = [
  { title: 'About you', hint: 'Tell us who you are' },
  { title: 'How to reach you', hint: 'Your contact details and location' },
  { title: 'Your business', hint: 'Tell us about your business' },
  { title: 'Your store', hint: 'Where are you now?' },
  { title: 'You and AI', hint: 'Have you tried AI before?' },
  { title: 'Seltra agents', hint: 'How hands-off do you want to be?' },
  { title: 'Secure your account', hint: 'Create a password to protect your Seltra workspace' },
]

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const SUBMIT_RETRY_MESSAGE = "We couldn't send your details just now. Your answers are still here — please tap Submit again in a moment."

export function SignupFlow({ formPhoto, donePhoto }: { formPhoto: string | null; donePhoto: string | null }) {
  const [step, setStep] = useState(0)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [region, setRegion] = useState('')
  const [country, setCountry] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [welcomeEmailSent, setWelcomeEmailSent] = useState(true)
  const [city, setCity] = useState('')
  const [data, setData] = useState<Omit<FormData, 'based_in'>>({
    full_name: '',
    phone: '',
    email: '',
    business_name: '',
    business_type: '',
    store_name: '',
    what_you_sell: '',
    monthly_revenue: '',
    existing_links: '',
    ai_familiarity: '',
    ai_used_before: undefined,
    ai_tools_used: '',
    ai_feelings: '',
    allow_ai_help: '',
  })

  const set = <K extends keyof typeof data>(key: K, value: (typeof data)[K]) =>
    setData((current) => ({ ...current, [key]: value }))

  const [attempted, setAttempted] = useState(false)

  const errors = useMemo(() => {
    const e: Partial<Record<string, string>> = {}
    const phone = data.phone.trim()
    const email = data.email.trim()
    if (step === 0) {
      if (!region) e.region = 'Required'
      if (!country) e.country = region ? 'Required' : 'Pick a region first'
      if (!data.full_name.trim()) e.full_name = 'Required'
      else if (!hasTwoNames(data.full_name)) e.full_name = 'Enter first and last name'
    }
    if (step === 1) {
      if (!phone) e.phone = 'Required'
      else if (phone.length < 5) e.phone = 'Number too short'
      if (!email) e.email = 'Required'
      else if (!EMAIL_RE.test(email)) e.email = 'Enter a valid email, e.g. you@mail.com'
      if (!city.trim()) e.city = 'Required'
    }
    if (step === 2) {
      if (!data.business_name.trim()) e.business_name = 'Required'
      if (!data.business_type) e.business_type = 'Required'
      if (!data.store_name.trim()) e.store_name = 'Required'
      if (!data.what_you_sell.trim()) e.what_you_sell = 'Required'
    }
    if (step === 3 && !data.monthly_revenue) e.monthly_revenue = 'Pick one'
    return e
  }, [step, data, region, country, city])

  const formatErrors: Partial<Record<string, string>> = {
    phone: data.phone.trim() && data.phone.trim().length < 5 ? errors.phone : undefined,
    email: data.email.trim() && !EMAIL_RE.test(data.email.trim()) ? errors.email : undefined,
  }
  const errorFor = (key: string) => (attempted ? errors[key] : formatErrors[key])

  const goNext = () => {
    if (Object.keys(errors).length > 0) {
      setAttempted(true)
      return
    }
    setAttempted(false)
    setStep((current) => Math.min(STEPS.length - 1, current + 1))
  }
  const goBack = () => {
    setAttempted(false)
    setStep((current) => Math.max(0, current - 1))
  }

  const submit = async () => {
    const basedIn = [city.trim(), country === 'Other' ? region : country].filter(Boolean).join(', ')
    const aiTools = data.ai_used_before ? {} : { ai_tools_used: '', ai_feelings: '' }
    const parsed = schema.safeParse({ ...data, ...aiTools, based_in: basedIn })
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message)
      return
    }
    if (password.length < 10 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
      toast.error('Use at least 10 characters with uppercase, lowercase, and a number.')
      return
    }
    if (password !== confirmPassword) {
      toast.error('Your passwords do not match.')
      return
    }
    setLoading(true)
    try {
      let lastMessage = SUBMIT_RETRY_MESSAGE
      let submitted = false
      let didSendWelcomeEmail = true

      for (const url of submitUrls()) {
        try {
          const controller = new AbortController()
          const timer = window.setTimeout(() => controller.abort(), 90_000)
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...parsed.data, password }),
            signal: controller.signal,
          })
          window.clearTimeout(timer)
          const json = await res.json().catch(() => ({}))
          if (!res.ok) {
            const message = Array.isArray(json.message) ? json.message[0] : json.message
            // Reachable API with a real client error — stop retrying other bases.
            if (res.status < 500 && message) {
              throw new Error(String(message))
            }
            lastMessage = SUBMIT_RETRY_MESSAGE
            continue
          }
          didSendWelcomeEmail = json.welcomeEmailSent !== false
          setWelcomeEmailSent(didSendWelcomeEmail)
          submitted = true
          break
        } catch (error) {
          if (error instanceof Error && error.message !== SUBMIT_RETRY_MESSAGE && !(error instanceof TypeError) && error.name !== 'AbortError') {
            throw error
          }
          lastMessage = SUBMIT_RETRY_MESSAGE
        }
      }

      if (!submitted) throw new Error(lastMessage)

      if (didSendWelcomeEmail) toast.success('Your Seltra account is ready. Check your email for your merchant ID.')
      else toast('Your account is ready', { description: 'Email delivery is delayed. Please check your inbox shortly for your merchant ID.' })
      setDone(true)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (error) {
      const offline = error instanceof TypeError || !(error instanceof Error)
      toast('Almost there!', { description: offline ? SUBMIT_RETRY_MESSAGE : error.message })
    } finally {
      setLoading(false)
    }
  }

  const photo = done ? donePhoto ?? formPhoto : formPhoto

  return (
    <div className="signup-page landing-menu fixed inset-0 overflow-hidden">
      <span aria-hidden className="signup-orb left-[-8%] top-[-10%] h-[420px] w-[420px] bg-[#22c55e]/30" />
      <span aria-hidden className="signup-orb bottom-[-15%] right-[-6%] h-[460px] w-[460px] bg-[#16a34a]/25" />
      <div className="relative mx-auto flex h-full max-w-[1024px] flex-col px-5 py-4 sm:px-7 sm:py-5">
        <Link href="/" className="inline-flex shrink-0">
          <img src="/assets/brand/logo.png" alt="seltra" className="h-[27px] w-auto" />
        </Link>

        <div className="mt-3 grid min-h-0 flex-1 items-center gap-6 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)] lg:gap-10">
          <div className="hidden h-full min-h-0 lg:block">
            <div className="signup-photo h-full overflow-hidden rounded-[2rem]">
              {photo ? (
                <img src={photo} alt="" className={cn('h-full w-full object-cover', done ? 'object-[50%_18%]' : 'object-[50%_42%]')} />
              ) : (
                <div className="photo-placeholder relative h-full w-full">
                  <img src="/assets/brand/mark.png" alt="" className="page-mark page-mark-dark absolute bottom-0 right-0 w-[42%]" />
                </div>
              )}
            </div>
          </div>

          <div className="relative">
            <div aria-hidden className="signup-deco absolute left-0 top-0 z-0 hidden w-36 opacity-70 sm:block lg:w-52 lg:opacity-80" />
            <h1 className="relative z-10 text-[1.6rem] font-bold tracking-[-0.01em] text-white sm:text-[1.85rem] [@media(max-height:600px)]:text-[1.35rem]">
              {done ? (
                <>Welcome to <span className="text-[#4ade80]">Seltra</span></>
              ) : (
                <>Create your <span className="text-[#4ade80]">account</span></>
              )}
            </h1>

            <div className="signup-card relative z-10 mt-4 overflow-hidden rounded-2xl p-4 sm:p-5">
              {done ? (
                <Complete welcomeEmailSent={welcomeEmailSent} />
              ) : (
                <>
                  <div className="flex items-center gap-1.5">
                    {STEPS.map((_, index) => (
                      <div key={index} className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/10">
                        <div className={cn('signup-progress-fill h-full rounded-full', index <= step ? 'scale-x-100' : 'scale-x-0')} />
                      </div>
                    ))}
                  </div>

                  <div key={`head-${step}`} className="signup-step mt-3 [@media(max-height:600px)]:mt-2">
                    <p className="text-[12px] font-semibold text-[#4ade80]">
                      step {step + 1} / {STEPS.length}
                    </p>
                    <h2 className="mt-1.5 text-[19px] font-medium leading-tight text-white">{STEPS[step].title}</h2>
                    <p className="mt-1 text-[13px] text-white/60">{STEPS[step].hint}</p>
                  </div>

                  <div key={`body-${step}`} className="signup-step mt-3 [@media(max-height:600px)]:mt-2">
                    {step === 0 && (
                      <div className="space-y-3">
                        <Field label="Region *" error={errorFor('region')}>
                          <SelectField
                            icon
                            invalid={Boolean(errorFor('region'))}
                            value={region}
                            placeholder="Select your region"
                            options={Object.keys(REGIONS)}
                            onChange={(value) => { setRegion(value); setCountry('') }}
                          />
                        </Field>
                        <Field label="Country *" error={errorFor('country')}>
                          <SelectField
                            icon
                            invalid={Boolean(errorFor('country'))}
                            value={country}
                            placeholder={region ? 'Select your country' : 'Pick a region first'}
                            options={region ? REGIONS[region] : []}
                            onChange={setCountry}
                          />
                        </Field>
                        <Field label="Full name *" error={errorFor('full_name')}>
                          <TextField invalid={Boolean(errorFor('full_name'))} value={data.full_name} onChange={(v) => set('full_name', v)} placeholder="Ama Mensah" autoComplete="name" />
                        </Field>
                      </div>
                    )}

                    {step === 1 && (
                      <div className="space-y-3">
                        <Field label="Phone or WhatsApp *" error={errorFor('phone')}>
                          <TextField invalid={Boolean(errorFor('phone'))} value={data.phone} onChange={(v) => set('phone', v)} placeholder="+233 24 000 0000" inputMode="tel" autoComplete="tel" />
                        </Field>
                        <Field label="Email *" error={errorFor('email')}>
                          <TextField invalid={Boolean(errorFor('email'))} value={data.email} onChange={(v) => set('email', v)} placeholder="you@business.com" type="email" autoComplete="email" />
                        </Field>
                        <Field label="City or town *" error={errorFor('city')}>
                          <TextField invalid={Boolean(errorFor('city'))} value={city} onChange={setCity} placeholder="Accra" autoComplete="address-level2" />
                        </Field>
                      </div>
                    )}

                    {step === 2 && (
                      <div className="space-y-3">
                        <div className="grid gap-3 sm:grid-cols-2 [@media(max-height:600px)]:grid-cols-2">
                          <Field label="Business name *" error={errorFor('business_name')} errorBelow>
                            <TextField invalid={Boolean(errorFor('business_name'))} value={data.business_name} onChange={(v) => set('business_name', v)} placeholder="Ama Bakery" />
                          </Field>
                          <Field label="Business type *" error={errorFor('business_type')} errorBelow>
                            <SelectField invalid={Boolean(errorFor('business_type'))} value={data.business_type} placeholder="Pick one" options={BUSINESS_TYPES} onChange={(v) => set('business_type', v)} />
                          </Field>
                        </div>
                        <Field label="Store name *" error={errorFor('store_name')}>
                          <TextField invalid={Boolean(errorFor('store_name'))} value={data.store_name} onChange={(v) => set('store_name', v)} placeholder="e.g. Zuri Eyewear" />
                        </Field>
                        <Field label="What do you sell? *" error={errorFor('what_you_sell')}>
                          <TextArea invalid={Boolean(errorFor('what_you_sell'))} rows={2} value={data.what_you_sell} onChange={(v) => set('what_you_sell', v)} placeholder="Premium sunglasses inspired by African cities, sold globally" />
                        </Field>
                      </div>
                    )}

                    {step === 3 && (
                      <div className="space-y-3">
                        <Field label="Monthly revenue or stage *" error={errorFor('monthly_revenue')}>
                          <Choices value={data.monthly_revenue} options={REVENUE_STAGES} onChange={(v) => set('monthly_revenue', v)} />
                        </Field>
                        <Field label="Store, Instagram, TikTok or website links (optional)">
                          <TextField
                            value={data.existing_links ?? ''}
                            onChange={(v) => set('existing_links', v)}
                            placeholder="https://instagram.com/zurieyewear"
                            inputMode="url"
                          />
                        </Field>
                      </div>
                    )}

                    {step === 4 && (
                      <div className="space-y-3">
                        <Field label="Have you heard of AI?">
                          <Choices value={data.ai_familiarity ?? ''} options={AI_FAMILIARITY} onChange={(v) => set('ai_familiarity', v)} />
                        </Field>
                        <Field label="Have you used an AI tool before?">
                          <div className="grid grid-cols-2 gap-2">
                            {[{ label: 'Yes', value: true }, { label: 'No', value: false }].map((option) => (
                              <ChoiceButton
                                key={option.label}
                                selected={data.ai_used_before === option.value}
                                onClick={() => set('ai_used_before', option.value)}
                              >
                                {option.label}
                              </ChoiceButton>
                            ))}
                          </div>
                        </Field>
                        {data.ai_used_before && (
                          <div className="signup-step grid grid-cols-2 gap-3">
                            <Field label="Which one(s)?">
                              <TextField value={data.ai_tools_used ?? ''} onChange={(v) => set('ai_tools_used', v)} placeholder="ChatGPT" />
                            </Field>
                            <Field label="How did it feel?">
                              <TextField value={data.ai_feelings ?? ''} onChange={(v) => set('ai_feelings', v)} placeholder="Helpful, magical..." />
                            </Field>
                          </div>
                        )}
                      </div>
                    )}

                    {step === 5 && (
                      <div className="space-y-3">
                        <div className="flex gap-3 rounded-xl border border-[#4ade80]/25 bg-[linear-gradient(135deg,rgba(34,197,94,0.16),rgba(34,197,94,0.04))] p-3 shadow-[0_0_30px_-12px_rgba(74,222,128,0.5)]">
                          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-[#4ade80]" />
                          <p className="text-[13px] leading-snug text-white/80">
                            Seltra agents can run your storefront, marketing, payments and fulfillment - so you can focus on the craft.
                          </p>
                        </div>
                        <Field label="Will you let Seltra AI help operate your business?" large>
                          <Choices value={data.allow_ai_help ?? ''} options={ALLOW_AI} onChange={(v) => set('allow_ai_help', v)} />
                        </Field>
                      </div>
                    )}
                    {step === 6 && (
                      <div className="space-y-3">
                        <Field label="Create password *">
                          <TextField type="password" autoComplete="new-password" value={password} onChange={setPassword} placeholder="At least 10 characters" />
                        </Field>
                        <Field label="Confirm password *">
                          <TextField type="password" autoComplete="new-password" value={confirmPassword} onChange={setConfirmPassword} placeholder="Enter the same password again" />
                        </Field>
                        <p className="text-xs leading-relaxed text-white/55">Use uppercase and lowercase letters plus a number. We hash and protect your password.</p>
                      </div>
                    )}
                  </div>

                  <div className="mt-4 flex items-center justify-between border-t border-white/[0.08] pt-3 [@media(max-height:600px)]:mt-3 [@media(max-height:600px)]:pt-2">
                    <button
                      type="button"
                      disabled={step === 0 || loading}
                      onClick={goBack}
                      className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-[13px] text-white/60 transition-colors hover:text-white disabled:pointer-events-none disabled:opacity-60"
                    >
                      <ArrowLeft className="h-3.5 w-3.5" /> Back
                    </button>
                    {step < STEPS.length - 1 ? (
                      <button
                        type="button"
                        onClick={goNext}
                        className="btn btn-primary"
                      >
                        Continue <ArrowRight className="h-3.5 w-3.5" />
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={loading}
                        onClick={() => void submit()}
                        className="btn btn-primary"
                      >
                        {loading ? 'Creating account...' : (<>Create account <ArrowRight className="h-3.5 w-3.5" /></>)}
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Complete({ welcomeEmailSent }: { welcomeEmailSent: boolean }) {
  return (
    <div className="relative flex flex-col items-center justify-center px-2 py-8 text-center sm:px-8">
      <span className="relative z-10 inline-flex">
        <span aria-hidden className="absolute inset-[-18px] rounded-full bg-[#22c55e]/25 blur-2xl" />
        <Send className="relative h-14 w-14 -rotate-12 fill-[#22c55e] text-[#22c55e] drop-shadow-[0_0_14px_rgba(74,222,128,0.55)]" strokeWidth={1.2} />
        <span className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-[#16a34a] ring-4 ring-[#262a28]">
          <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />
        </span>
      </span>
      <p className="relative z-10 mt-7 max-w-[20rem] text-[16px] font-medium leading-snug text-white">
        Your Seltra account is ready.
      </p>
      <p className="relative z-10 mt-3 text-[13px] text-white/65">{welcomeEmailSent ? 'We sent a welcome email with your merchant ID. Keep it safe for account recovery.' : 'Email delivery is delayed. Please check your inbox shortly for your merchant ID.'}</p>
      <Link href="/auth?next=%2Fdashboard" className="btn btn-lg btn-primary relative z-10 mt-6 w-full max-w-[330px]">
        Continue to log in
      </Link>
      <div aria-hidden className="absolute -bottom-12 left-1/2 z-0 w-52 -translate-x-1/2 opacity-30">
        <div className="signup-deco w-full" />
      </div>
    </div>
  )
}

function Field({
  label,
  large,
  error,
  errorBelow,
  children,
}: {
  label: string
  large?: boolean
  error?: string
  errorBelow?: boolean
  children: ReactNode
}) {
  const message = error && (
    <span
      role="alert"
      className={cn('signup-step block min-w-0 text-[12px] leading-tight text-[#f87171]', errorBelow ? 'text-left' : 'text-right')}
    >
      {error}
    </span>
  )
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label className={cn('block text-white/75', large ? 'text-[14px]' : 'text-[13px]')}>{label}</label>
        {!errorBelow && message}
      </div>
      {children}
      {errorBelow && message}
    </div>
  )
}

function TextField({
  value,
  onChange,
  placeholder,
  type = 'text',
  inputMode,
  autoComplete,
  invalid,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  type?: string
  inputMode?: 'tel' | 'email' | 'text' | 'url'
  autoComplete?: string
  invalid?: boolean
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      inputMode={inputMode}
      autoComplete={autoComplete}
      aria-invalid={invalid || undefined}
      className="signup-field h-11 w-full rounded-md px-4 text-[14px] text-white [@media(max-height:760px)]:h-10"
    />
  )
}

function TextArea({
  value,
  onChange,
  rows,
  placeholder,
  invalid,
}: {
  value: string
  onChange: (value: string) => void
  rows: number
  placeholder?: string
  invalid?: boolean
}) {
  return (
    <textarea
      value={value}
      onChange={(event) => onChange(event.target.value)}
      rows={rows}
      placeholder={placeholder}
      aria-invalid={invalid || undefined}
      className="signup-field w-full resize-none rounded-md px-4 py-2.5 text-[14px] text-white"
    />
  )
}

function SelectField({
  value,
  options,
  placeholder,
  onChange,
  icon,
  invalid,
}: {
  value: string
  options: string[]
  placeholder: string
  onChange: (value: string) => void
  icon?: boolean
  invalid?: boolean
}) {
  return (
    <div className="relative">
      {icon && <Globe className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/60" />}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={options.length === 0}
        aria-invalid={invalid || undefined}
        className={cn(
          'signup-field h-11 w-full appearance-none rounded-md pr-10 text-[14px] disabled:cursor-not-allowed [@media(max-height:760px)]:h-10',
          icon ? 'pl-11' : 'pl-4',
          value ? 'text-white' : 'text-white/35',
        )}
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/60" />
    </div>
  )
}

function ChoiceButton({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center rounded-md border px-4 py-2.5 text-left text-[13px] transition-all duration-200 max-[359px]:px-3 max-[359px]:text-[12px] [@media(max-height:760px)]:py-2',
        selected
          ? 'border-[#4ade80]/60 bg-[#22c55e]/[0.12] text-white shadow-[0_0_24px_-8px_rgba(74,222,128,0.6)]'
          : 'border-white/[0.08] bg-white/[0.04] text-white/75 hover:border-white/20 hover:bg-white/[0.06] hover:text-white',
      )}
    >
      {children}
    </button>
  )
}

function Choices({ value, options, onChange }: { value: string; options: string[]; onChange: (value: string) => void }) {
  return (
    <div className="grid gap-2">
      {options.map((option) => (
        <ChoiceButton key={option} selected={value === option} onClick={() => onChange(option)}>
          {option}
        </ChoiceButton>
      ))}
    </div>
  )
}
