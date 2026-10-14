//seltra-web/frontend/app/careers/[slug]/page.tsx
import type { ReactNode } from 'react'
import Link from 'next/link'
import { ArrowLeft, ArrowRight, Briefcase, Coins, Lock, MapPin, Sparkles } from 'lucide-react'
import { SiteHeader } from '@/components/marketing/SiteHeader'
import { SiteFooter } from '@/components/marketing/SiteFooter'
import { JOBS, getJob } from '@/lib/jobs'

export function generateStaticParams() {
  return JOBS.map((job) => ({ slug: job.slug }))
}

const primaryButton = 'btn btn-lg btn-primary'
const outlineButton = 'btn btn-lg btn-glass-dark'

function DarkShell({ children }: { children: ReactNode }) {
  return (
    <div className="site-dark relative min-h-screen overflow-hidden">
      <SiteHeader dark />
      <img src="/seltra/mark-left.png" alt="" aria-hidden className="pointer-events-none absolute left-0 top-28 w-24 select-none sm:w-36 lg:w-44" />
      <img src="/seltra/careers/mark-right.png" alt="" aria-hidden className="pointer-events-none absolute right-0 top-[64%] w-24 select-none sm:w-36 lg:w-48" />
      {children}
      <SiteFooter />
    </div>
  )
}

export default async function CareerDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const job = getJob(slug)

  if (!job) {
    return (
      <DarkShell>
        <main className="relative z-10 mx-auto max-w-3xl px-5 pb-24 pt-40 text-center">
          <h1 className="text-3xl font-semibold tracking-tight">
            Role <span className="text-[#4ade80]">not found.</span>
          </h1>
          <Link href="/careers" className={`${primaryButton} mt-8`}>Back to careers</Link>
        </main>
      </DarkShell>
    )
  }

  const isClosed = job.status === 'closed'
  const [firstWord, ...rest] = job.title.split(' ')

  return (
    <DarkShell>
      <main className="relative z-10 mx-auto max-w-3xl px-5 pb-20 pt-32 sm:px-6 sm:pt-40">
        <Link href="/careers" className="landing-menu inline-flex items-center gap-1.5 text-[13px] text-white/55 transition-colors hover:text-[#4ade80]">
          <ArrowLeft className="h-3.5 w-3.5" /> All roles
        </Link>

        <h1 className="mt-6 text-balance text-[2.1rem] font-semibold leading-[1.08] tracking-[-0.04em] sm:text-[2.75rem]">
          {firstWord} <span className="text-[#4ade80]">{rest.join(' ')}</span>
        </h1>

        <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-[14px] text-white/60">
          <span className="flex items-center gap-1.5"><MapPin className="h-4 w-4 text-[#4ade80]" /> {job.location}</span>
          <span className="flex items-center gap-1.5"><Briefcase className="h-4 w-4 text-[#4ade80]" /> {job.type}</span>
          <span className="flex items-center gap-1.5"><Coins className="h-4 w-4 text-[#4ade80]" /> {job.compensation}</span>
        </div>

        <p className="mt-8 text-[16px] leading-relaxed text-white/75 sm:text-lg">{job.summary}</p>

        {isClosed ? (
          <div className="site-dark-card mt-10 flex gap-4 rounded-[1.5rem] p-6 sm:p-7">
            <Lock className="mt-1 h-5 w-5 shrink-0 text-white/50" />
            <div>
              <p className="font-semibold">This role is closed.</p>
              <p className="mt-1.5 text-sm leading-relaxed text-white/65">{job.closedNote}</p>
              <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                <Link href="/careers#roles" className={outlineButton}>See open roles</Link>
                <a href="mailto:williamofosu677@gmail.com?subject=Seltra%20General%20interest" className={primaryButton}>
                  Register interest
                </a>
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-10 flex flex-col gap-3 sm:flex-row">
            <Link href={`/careers/${job.slug}/apply`} className={primaryButton}>
              Apply for this role <ArrowRight className="h-4 w-4" />
            </Link>
            <a href="mailto:williamofosu677@gmail.com" className={outlineButton}>Ask a question</a>
          </div>
        )}

        <div className="mt-14 space-y-10">
          <Section title="The mission"><p>{job.mission}</p></Section>
          <Section title="What you will own"><List items={job.responsibilities} /></Section>
          <Section title="You probably look like"><List items={job.youAre} /></Section>
          <Section title="Nice to have"><List items={job.niceToHave} /></Section>
        </div>

        <div className="site-dark-card mt-12 flex gap-4 rounded-[1.5rem] p-6 sm:p-7">
          <Sparkles className="mt-1 h-5 w-5 shrink-0 text-[#4ade80]" />
          <div>
            <p className="font-semibold text-[#4ade80]">Note</p>
            <p className="mt-1.5 text-sm leading-relaxed text-white/70 sm:text-[15px]">{job.stage}</p>
          </div>
        </div>

        {!isClosed && (
          <div className="mt-12">
            <Link href={`/careers/${job.slug}/apply`} className={primaryButton}>
              Apply for this role <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        )}
      </main>
    </DarkShell>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h2>
      <div className="mt-4 text-[15px] leading-relaxed text-white/70 sm:text-base">{children}</div>
    </section>
  )
}

function List({ items }: { items: string[] }) {
  return (
    <ul className="space-y-3">
      {items.map((item) => (
        <li key={item} className="flex gap-3">
          <span className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-[#4ade80]" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  )
}
