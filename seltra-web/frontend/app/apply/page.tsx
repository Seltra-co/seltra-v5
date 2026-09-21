//seltra-merchant-v5/frontend/app/apply/page.tsx`
'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ArrowRight, Check, Sparkles } from 'lucide-react'
import { z } from 'zod'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SiteHeader } from '@/components/marketing/SiteHeader'
import { SiteFooter } from '@/components/marketing/SiteFooter'

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001'

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

const schema = z.object({
  full_name: z.string().trim().min(1, 'Your name is required').max(120),
  phone: z.string().trim().min(5, 'Phone is required').max(40),
  email: z.string().trim().email('Enter a valid email').max(255).optional().or(z.literal('')),
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
  { title: 'Your business', hint: 'What do you sell?' },
  { title: 'Your store', hint: 'Where are you now?' },
  { title: 'Your presence', hint: 'Show us what you have built' },
  { title: 'You and AI', hint: 'Have you tried AI before?' },
  { title: 'Seltra agents', hint: 'How hands-off do you want to be?' },
]

export default function MerchantApplyPage() {
  const router = useRouter()
  const [step, setStep] = useState(0)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [data, setData] = useState<FormData>({
    full_name: '',
    phone: '',
    email: '',
    business_name: '',
    business_type: '',
    store_name: '',
    what_you_sell: '',
    based_in: '',
    monthly_revenue: '',
    existing_links: '',
    ai_familiarity: '',
    ai_used_before: undefined,
    ai_tools_used: '',
    ai_feelings: '',
    allow_ai_help: '',
  })

  const set = <K extends keyof FormData>(key: K, value: FormData[K]) =>
    setData((current) => ({ ...current, [key]: value }))

  const canNext = useMemo(() => {
    if (step === 0) return data.full_name.trim() && data.phone.trim().length >= 5
    if (step === 1) {
      return data.business_name.trim() && data.business_type && data.store_name.trim() && data.what_you_sell.trim()
    }
    if (step === 2) return data.based_in.trim() && data.monthly_revenue
    return true
  }, [step, data])

  const submit = async () => {
    const parsed = schema.safeParse(data)
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message)
      return
    }
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/v1/application/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.message || 'Submission failed')
      setDone(true)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Submission failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader />
      <main className="flex-1 pb-16 pt-24">
        <div className="container mx-auto max-w-xl px-4 sm:px-6">
          <button onClick={() => router.push('/')} className="mb-6 flex items-center gap-1 font-mono text-xs text-muted-foreground hover:text-primary">
            <ArrowLeft className="h-3 w-3" /> back to home
          </button>

          <div className="mb-8">
            <p className="mb-3 font-mono text-xs text-primary">{'// merchant application'}</p>
            <h1 className="mb-3 text-3xl font-bold tracking-tight sm:text-4xl">Apply to sell on Seltra</h1>
            <p className="text-muted-foreground">Be among the first merchants to launch your online store in minutes with Seltra.</p>
            <p className="mt-2 text-sm text-muted-foreground">
              We onboard early merchants personally. Tell us about your business and we will be in touch with you.
            </p>
          </div>

          {done ? (
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-8 text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-primary/30 bg-primary/10">
                <Check className="h-6 w-6 text-primary" />
              </div>
              <h2 className="mb-2 text-xl font-semibold">Application received</h2>

          <p className="text-sm text-muted-foreground">
            The Seltra team will reach out to you as soon as we launch to book your onboarding call.
          </p>
          <p className="mt-4 text-sm text-muted-foreground">Once approved, you will receive a Merchant ID to activate your dashboard.</p>
          <p className="mt-4 text-sm text-muted-foreground">
            Early merchants get priority onboarding and 30 days free. We can not wait to build with you. 
          </p>
              <Button className="mt-6 rounded-md" onClick={() => router.push('/')}>Back to home</Button>
            </div>
          ) : (
            <div className="rounded-xl border border-border bg-card/40 p-5 sm:p-7">
              <div className="mb-6 flex items-center gap-2">
                {STEPS.map((_, index) => (
                  <div key={index} className={`h-1 flex-1 rounded-full transition-colors ${index <= step ? 'bg-primary' : 'bg-border'}`} />
                ))}
              </div>
              <div className="mb-5">
                <p className="font-mono text-[11px] text-muted-foreground">step {step + 1} / {STEPS.length}</p>
                <h2 className="mt-1 text-lg font-semibold">{STEPS[step].title}</h2>
                <p className="text-xs text-muted-foreground">{STEPS[step].hint}</p>
              </div>

              {step === 0 && (
                <div className="space-y-4">
                  <Field label="Full name *"><Input value={data.full_name} onChange={(event) => set('full_name', event.target.value)} placeholder="Ama Mensah" /></Field>
                  <Field label="Phone or WhatsApp *"><Input value={data.phone} onChange={(event) => set('phone', event.target.value)} placeholder="+233 24 000 0000" inputMode="tel" /></Field>
                  <Field label="Email *"><Input type="email" value={data.email} onChange={(event) => set('email', event.target.value)} placeholder="you@business.com" /></Field>
                </div>
              )}

              {step === 1 && (
                <div className="space-y-4">
                  <Field label="Business name *"><Input value={data.business_name} onChange={(event) => set('business_name', event.target.value)} placeholder="Ama Bakery" /></Field>
                  <Field label="Business type *"><NativeSelect value={data.business_type} options={BUSINESS_TYPES} placeholder="Pick one" onChange={(value) => set('business_type', value)} /></Field>
                  <Field label="Store name *"><Input value={data.store_name} onChange={(event) => set('store_name', event.target.value)} placeholder="e.g. Zuri Eyewear" /></Field>
                  <Field label="What do you sell? *"><NativeTextarea rows={2} value={data.what_you_sell} onChange={(value) => set('what_you_sell', value)} placeholder="Premium sunglasses inspired by African cities, sold globally" /></Field>
                </div>
              )}

              {step === 2 && (
                <div className="space-y-4">
                  <Field label="Where are you based? *"><Input value={data.based_in} onChange={(event) => set('based_in', event.target.value)} placeholder="Accra, Ghana" /></Field>
                  <Field label="Monthly revenue or stage *"><ChoiceGroup value={data.monthly_revenue || ''} options={REVENUE_STAGES} onChange={(value) => set('monthly_revenue', value)} /></Field>
                </div>
              )}

              {step === 3 && (
                <div className="space-y-4">
                  <Field label="Drop any links to your existing store, Instagram, TikTok or website">
                    <NativeTextarea rows={3} value={data.existing_links || ''} onChange={(value) => set('existing_links', value)} placeholder={'https://instagram.com/zurieyewear\nhttps://zurieyewear.com'} />
                  </Field>
                  <p className="text-xs text-muted-foreground">No links? No problem - just leave this blank.</p>
                </div>
              )}

              {step === 4 && (
                <div className="space-y-5">
                  <Field label="Have you heard of AI?"><ChoiceGroup value={data.ai_familiarity || ''} options={AI_FAMILIARITY} onChange={(value) => set('ai_familiarity', value)} /></Field>
                  <Field label="Have you used an AI tool before?">
                    <div className="flex gap-2">
                      {[{ label: 'Yes', value: true }, { label: 'No', value: false }].map((option) => (
                        <button key={option.label} type="button" onClick={() => set('ai_used_before', option.value)} className={`rounded-md border px-4 py-2 text-sm transition-colors ${data.ai_used_before === option.value ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:border-primary/40'}`}>
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </Field>
                  {data.ai_used_before && (
                    <>
                      <Field label="Which one(s)?"><Input value={data.ai_tools_used} onChange={(event) => set('ai_tools_used', event.target.value)} placeholder="ChatGPT" /></Field>
                      <Field label="How did it feel using it?"><NativeTextarea rows={3} value={data.ai_feelings || ''} onChange={(value) => set('ai_feelings', value)} placeholder="Helpful, confusing, magical..." /></Field>
                    </>
                  )}
                </div>
              )}

              {step === 5 && (
                <div className="space-y-4">
                  <div className="flex gap-3 rounded-md border border-primary/20 bg-primary/5 p-4">
                    <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <p className="text-sm text-muted-foreground">
                      Seltra agents can run your storefront, marketing, payments and fulfillment - so you can focus on the craft.
                    </p>
                  </div>
                  <Field label="Will you let Seltra AI help operate your business?"><ChoiceGroup value={data.allow_ai_help || ''} options={ALLOW_AI} onChange={(value) => set('allow_ai_help', value)} /></Field>
                </div>
              )}

              <div className="mt-7 flex items-center justify-between border-t border-border pt-5">
                <Button variant="ghost" size="sm" disabled={step === 0 || loading} onClick={() => setStep((current) => Math.max(0, current - 1))}>
                  <ArrowLeft className="h-4 w-4" /> Back
                </Button>
                {step < STEPS.length - 1 ? (
                  <Button size="sm" disabled={!canNext} onClick={() => setStep((current) => current + 1)} className="rounded-md">
                    Continue <ArrowRight className="h-4 w-4" />
                  </Button>
                ) : (
                  <Button size="sm" disabled={loading} onClick={() => void submit()} className="rounded-md">
                    {loading ? 'Submitting...' : 'Submit application'}
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      </main>
      <SiteFooter />
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="font-mono text-xs text-muted-foreground">{label}</label>
      {children}
    </div>
  )
}

function NativeTextarea({ value, onChange, rows, placeholder }: { value: string; onChange: (value: string) => void; rows: number; placeholder?: string }) {
  return (
    <textarea
      value={value}
      onChange={(event) => onChange(event.target.value)}
      rows={rows}
      placeholder={placeholder}
      className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none placeholder:text-muted-foreground/60 focus:ring-1 focus:ring-ring"
    />
  )
}

function NativeSelect({ value, options, placeholder, onChange }: { value: string; options: string[]; placeholder: string; onChange: (value: string) => void }) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm outline-none focus:ring-1 focus:ring-ring">
      <option value="">{placeholder}</option>
      {options.map((option) => <option key={option} value={option}>{option}</option>)}
    </select>
  )
}

function ChoiceGroup({ value, options, onChange }: { value: string; options: string[]; onChange: (value: string) => void }) {
  return (
    <div className="grid gap-2">
      {options.map((option) => (
        <button key={option} type="button" onClick={() => onChange(option)} className={`rounded-md border px-4 py-3 text-left text-sm transition-colors ${value === option ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:border-primary/40'}`}>
          {option}
        </button>
      ))}
    </div>
  )
}
