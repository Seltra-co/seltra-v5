//seltra-web/frontend/app/careers/[slug]/apply/assessment/page.tsx
'use client'

import Link from 'next/link'
import { useParams, useSearchParams } from 'next/navigation'
import { ArrowRight, CheckCircle2, Clock, Mail } from 'lucide-react'
import { getJob } from '@/lib/jobs'

export default function AssessmentPage() {
  const params = useParams<{ slug: string }>()
  const searchParams = useSearchParams()
  const job = getJob(params.slug)
  const name = searchParams.get('name') || 'there'

  const subject = job
    ? encodeURIComponent(`${job.title} — Assessment Submission`)
    : encodeURIComponent('Seltra — Assessment Submission')
  const mailHref = `mailto:${job?.assessment?.submitTo ?? 'williamofosu677@gmail.com'}?subject=${subject}`

  return (
    <div className="min-h-screen bg-white text-neutral-900">
      <header className="border-b border-neutral-200">
        <div className="mx-auto flex max-w-3xl items-center gap-2 px-4 py-6 sm:px-6">
          <div className="h-2.5 w-2.5 rounded-sm bg-emerald-600" />
          <span className="text-sm font-semibold tracking-tight">seltra</span>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 pb-24 pt-10 sm:px-6 sm:pt-14">
        <div className="mb-8 flex items-center gap-2 text-emerald-700">
          <CheckCircle2 className="h-5 w-5" />
          <p className="text-sm font-medium">Application received</p>
        </div>

        <h1 className="mb-3 text-2xl font-bold tracking-tight text-neutral-900 sm:text-3xl">
          Thanks, {name}. Here's your next step.
        </h1>
        <p className="mb-10 max-w-xl text-sm leading-relaxed text-neutral-600 sm:text-base">
          We read every application personally. To move forward for{' '}
          <span className="font-medium text-neutral-900">{job?.title ?? 'this role'}</span>, we ask
          every candidate to complete a short assessment — the same bar we would hold a hire at any
          world-class engineering or operating team to.
        </p>

        {job?.assessment ? (
          <div className="rounded-2xl border border-neutral-200 shadow-sm">
            <div className="border-b border-neutral-200 bg-neutral-50 px-6 py-5 sm:px-8">
              <p className="text-xs font-medium uppercase tracking-wide text-emerald-700">
                Assessment
              </p>
              <h2 className="mt-1 text-lg font-semibold text-neutral-900 sm:text-xl">
                {job.assessment.headline}
              </h2>
              <div className="mt-3 flex items-center gap-1.5 text-xs text-neutral-500">
                <Clock className="h-3.5 w-3.5" />
                {job.assessment.timeframe}
              </div>
            </div>

            <div className="space-y-8 px-6 py-6 sm:px-8 sm:py-8">
              <p className="text-sm leading-relaxed text-neutral-700">
                {job.assessment.instructions}
              </p>

              <div>
                <h3 className="mb-3 text-sm font-semibold text-neutral-900">What to do</h3>
                <ol className="space-y-3">
                  {job.assessment.tasks.map((task, index) => (
                    <li key={task} className="flex gap-3 text-sm text-neutral-700">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-600/10 text-xs font-semibold text-emerald-700">
                        {index + 1}
                      </span>
                      <span className="leading-relaxed">{task}</span>
                    </li>
                  ))}
                </ol>
              </div>

              <div>
                <h3 className="mb-3 text-sm font-semibold text-neutral-900">What to submit</h3>
                <ul className="space-y-2">
                  {job.assessment.deliverables.map((item) => (
                    <li key={item} className="flex gap-2 text-sm text-neutral-700">
                      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-neutral-400" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <h3 className="mb-3 text-sm font-semibold text-neutral-900">
                  How we evaluate it
                </h3>
                <div className="flex flex-wrap gap-2">
                  {job.assessment.evaluationCriteria.map((item) => (
                    <span
                      key={item}
                      className="rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1 text-xs text-neutral-600"
                    >
                      {item}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-3 border-t border-neutral-200 px-6 py-6 sm:flex-row sm:items-center sm:justify-between sm:px-8">
              <p className="text-xs text-neutral-500">
                Send your submission whenever it's ready — no account or portal needed.
              </p>
              
              <a
                href={mailHref}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
              >
                <Mail className="h-4 w-4" /> Submit via email <ArrowRight className="h-4 w-4" />
              </a>
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-neutral-200 px-6 py-8 text-center sm:px-8">
            <p className="text-sm text-neutral-600">
              We don't have a live assessment for this role yet — we'll follow up by email with next
              steps directly.
            </p>
          </div>
        )}

        <div className="mt-10 flex items-center justify-between border-t border-neutral-200 pt-6">
          <Link href="/careers" className="text-xs text-neutral-500 hover:text-neutral-900">
            ← back to careers
          </Link>
          <p className="text-xs text-neutral-400">seltra.co · Accra, Ghana</p>
        </div>
      </main>
    </div>
  )
}