//seltra-web/frontend/app/careers/[slug]/apply/page.tsx
'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, ArrowRight, Upload } from 'lucide-react'
import { z } from 'zod'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SiteHeader } from '@/components/marketing/SiteHeader'
import { SiteFooter } from '@/components/marketing/SiteFooter'
import { getJob } from '@/lib/jobs'

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001'
const HOURS = ['5-10 hours/week', '10-20 hours/week', 'Full-time commitment']
const YES_NO_MAYBE = ['Yes', 'No', 'Maybe / depends']
const MAX_FILE_MB = 5

const schema = z.object({
  full_name: z.string().trim().min(1, 'Full name is required').max(120),
  email: z.string().trim().email('Enter a valid email').max(255),
  phone: z.string().trim().min(5, 'Phone is required').max(40),
  links: z.string().trim().max(500).optional().or(z.literal('')),
  about: z.string().trim().min(1, 'Tell us about yourself').max(2000),
  why_seltra: z.string().trim().min(1).max(2000),
  prior_experience: z.string().trim().min(1).max(2000),
  growth_examples: z.string().trim().max(2000).optional().or(z.literal('')),
  fit_reason: z.string().trim().min(1).max(2000),
  onboarding_approach: z.string().trim().min(1).max(2000),
  customer_comfort: z.string().trim().min(1).max(1000),
  hours: z.string().min(1, 'Pick an availability'),
  before_funding: z.string().min(1),
  equity_ok: z.string().min(1),
  relocate_ok: z.string().min(1),
  excitement: z.string().trim().min(1).max(2000),
})

type FormData = z.infer<typeof schema>

const STEPS = ['Personal info', 'Experience', 'GTM & operations', 'Startup readiness', 'Final']

export default function RoleApplyPage() {
  const router = useRouter()
  const params = useParams<{ slug: string }>()
  const slug = params.slug
  const job = getJob(slug)

  const [step, setStep] = useState(0)
  const [loading, setLoading] = useState(false)
  const [resume, setResume] = useState<File | null>(null)
  const [data, setData] = useState<FormData>({
    full_name: '',
    email: '',
    phone: '',
    links: '',
    about: '',
    why_seltra: '',
    prior_experience: '',
    growth_examples: '',
    fit_reason: '',
    onboarding_approach: '',
    customer_comfort: '',
    hours: '',
    before_funding: '',
    equity_ok: '',
    relocate_ok: '',
    excitement: '',
  })

  const set = <K extends keyof FormData>(key: K, value: FormData[K]) =>
    setData((current) => ({ ...current, [key]: value }))

  const canNext = useMemo(() => {
    if (step === 0) return data.full_name.trim() && data.email.trim() && data.phone.trim() && resume
    if (step === 1) return data.about && data.why_seltra && data.prior_experience
    if (step === 2) return data.fit_reason && data.onboarding_approach && data.customer_comfort && data.hours
    if (step === 3) return data.before_funding && data.equity_ok && data.relocate_ok
    if (step === 4) return data.excitement
    return true
  }, [step, data, resume])

  const handleFile = (file: File | null) => {
    if (!file) {
      setResume(null)
      return
    }
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      toast.error(`File too large. Max ${MAX_FILE_MB} MB.`)
      return
    }
    setResume(file)
  }

  const fileToBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(file)
    })

  const submit = async () => {
    const parsed = schema.safeParse(data)
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message)
      return
    }
    if (!resume) {
      toast.error('Please upload your resume / CV.')
      return
    }
    setLoading(true)
    try {
      const resumeBase64 = await fileToBase64(resume)
      const payload = {
        ...parsed.data,
        role_slug: slug,
        role_title: job?.title ?? slug,
        resume: {
          filename: resume.name,
          contentType: resume.type || 'application/octet-stream',
          base64: resumeBase64,
        },
        submitted_at: new Date().toISOString(),
      }
      const res = await fetch(`${API_BASE}/functions/notify-application`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.message || 'Submission failed')

      const firstName = parsed.data.full_name.split(' ')[0] ?? ''
      router.push(
        `/careers/${slug}/apply/assessment?name=${encodeURIComponent(firstName)}&email=${encodeURIComponent(parsed.data.email)}`
      )
    } catch {
      toast.error('Submission failed. Please try again or email us directly.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader />
      <main className="flex-1 pb-16 pt-24 sm:pt-28">
        <div className="container mx-auto max-w-2xl px-4 sm:px-6">
          <Link href={job ? `/careers/${job.slug}` : '/careers'} className="mb-6 inline-flex items-center gap-1 font-mono text-xs text-muted-foreground hover:text-primary">
            <ArrowLeft className="h-3 w-3" /> back to role
          </Link>

          <div className="mb-8">
            <p className="mb-3 font-mono text-xs text-primary">{'// application'}</p>
            <h1 className="mb-2 text-2xl font-bold tracking-tight sm:text-3xl">Apply - {job?.title ?? 'Open role'}</h1>
            <p className="text-sm text-muted-foreground">A few thoughtful answers go a long way. We read every application.</p>
          </div>

          <div className="rounded-xl border border-border bg-card/40 p-5 sm:p-7">
            <div className="mb-6 flex items-center gap-2">
              {STEPS.map((_, index) => (
                <div key={index} className={`h-1 flex-1 rounded-full transition-colors ${index <= step ? 'bg-primary' : 'bg-border'}`} />
              ))}
            </div>
            <div className="mb-5">
              <p className="font-mono text-[11px] text-muted-foreground">step {step + 1} / {STEPS.length}</p>
              <h2 className="mt-1 text-lg font-semibold">{STEPS[step]}</h2>
            </div>

            {step === 0 && (
              <div className="space-y-4">
                <Field label="Full name *"><Input value={data.full_name} onChange={(event) => set('full_name', event.target.value)} /></Field>
                <Field label="Email *"><Input type="email" value={data.email} onChange={(event) => set('email', event.target.value)} /></Field>
                <Field label="Phone (WhatsApp preferred) *"><Input value={data.phone} onChange={(event) => set('phone', event.target.value)} inputMode="tel" /></Field>
                <Field label="LinkedIn / X / Portfolio"><Input value={data.links} onChange={(event) => set('links', event.target.value)} placeholder="https://" /></Field>
                <Field label="Resume / CV * (PDF or DOCX, max 5 MB)">
                  <label className="flex cursor-pointer items-center gap-3 rounded-md border border-dashed border-border px-3 py-2 text-sm hover:border-primary/50">
                    <Upload className="h-4 w-4 text-muted-foreground" />
                    <span className={resume ? 'text-foreground' : 'text-muted-foreground'}>{resume ? resume.name : 'Choose a file'}</span>
                    <input type="file" accept=".pdf,.doc,.docx,application/pdf" className="hidden" onChange={(event) => handleFile(event.target.files?.[0] ?? null)} />
                  </label>
                </Field>
              </div>
            )}

            {step === 1 && (
              <div className="space-y-4">
                <Field label="Tell us about yourself *"><NativeTextarea rows={4} value={data.about} onChange={(value) => set('about', value)} /></Field>
                <Field label="What interests you about Seltra? *"><NativeTextarea rows={4} value={data.why_seltra} onChange={(value) => set('why_seltra', value)} /></Field>
                <Field label="Have you worked with startups, merchants, operations, sales, or communities? *"><NativeTextarea rows={4} value={data.prior_experience} onChange={(value) => set('prior_experience', value)} /></Field>
                <Field label="Examples of projects or businesses you have helped grow"><NativeTextarea rows={3} value={data.growth_examples || ''} onChange={(value) => set('growth_examples', value)} /></Field>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-4">
                <Field label="Why are you a strong fit for this role? *"><NativeTextarea rows={4} value={data.fit_reason} onChange={(value) => set('fit_reason', value)} /></Field>
                <Field label="How would you onboard our first merchants? *"><NativeTextarea rows={4} value={data.onboarding_approach} onChange={(value) => set('onboarding_approach', value)} /></Field>
                <Field label="How comfortable are you with talking to customers and gathering feedback? *"><NativeTextarea rows={3} value={data.customer_comfort} onChange={(value) => set('customer_comfort', value)} /></Field>
                <Field label="Availability *"><NativeSelect value={data.hours} options={HOURS} placeholder="Hours per week" onChange={(value) => set('hours', value)} /></Field>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-5">
                <Field label="Comfortable joining before funding? *"><ChoiceGroup value={data.before_funding} options={YES_NO_MAYBE} onChange={(value) => set('before_funding', value)} /></Field>
                <Field label="Open to equity-based compensation? *"><ChoiceGroup value={data.equity_ok} options={YES_NO_MAYBE} onChange={(value) => set('equity_ok', value)} /></Field>
                <Field label="Willing to relocate if accelerator / funding opportunities arise? *"><ChoiceGroup value={data.relocate_ok} options={YES_NO_MAYBE} onChange={(value) => set('relocate_ok', value)} /></Field>
              </div>
            )}

            {step === 4 && (
              <Field label="What excites you most about helping build AI-native commerce infrastructure for SMEs? *">
                <NativeTextarea rows={6} value={data.excitement} onChange={(value) => set('excitement', value)} />
              </Field>
            )}

            <div className="mt-7 flex items-center justify-between gap-2 border-t border-border pt-5">
              <Button variant="ghost" size="sm" disabled={step === 0 || loading} onClick={() => setStep((current) => Math.max(0, current - 1))}>
                <ArrowLeft className="h-4 w-4" /> Back
              </Button>
              {step < STEPS.length - 1 ? (
                <Button size="sm" disabled={!canNext} onClick={() => setStep((current) => current + 1)} className="rounded-md">
                  Continue <ArrowRight className="h-4 w-4" />
                </Button>
              ) : (
                <Button size="sm" disabled={loading || !canNext} onClick={() => void submit()} className="rounded-md">
                  {loading ? 'Submitting...' : 'Submit application'}
                </Button>
              )}
            </div>
          </div>
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

function NativeTextarea({ value, onChange, rows }: { value: string; onChange: (value: string) => void; rows: number }) {
  return (
    <textarea
      value={value}
      onChange={(event) => onChange(event.target.value)}
      rows={rows}
      className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none focus:ring-1 focus:ring-ring"
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
    <div className="grid gap-2 sm:grid-cols-3">
      {options.map((option) => (
        <button key={option} type="button" onClick={() => onChange(option)} className={`rounded-md border px-4 py-3 text-left text-sm transition-colors sm:text-center ${value === option ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:border-primary/40'}`}>
          {option}
        </button>
      ))}
    </div>
  )
}