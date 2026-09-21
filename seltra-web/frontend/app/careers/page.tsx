//seltra-web/frontend/app/careers/page.tsx
import Link from 'next/link'
import { ArrowRight, Briefcase, Lock, MapPin } from 'lucide-react'
import { SiteHeader } from '@/components/marketing/SiteHeader'
import { SiteFooter } from '@/components/marketing/SiteFooter'
import { SpinningGlobe } from '@/components/marketing/spinningGlobe'
import { JOBS } from '@/lib/jobs'

const STATS = [
  { value: '2', label: 'launch markets — Ghana & Nigeria' },
  { value: '15+', label: 'merchants in active pipeline' },
  { value: '<15 min', label: 'prompt to live store' },
  { value: 'Remote', label: 'global, distributed team' },
]

export default function CareersPage() {
  const openJobs = JOBS.filter((job) => job.status === 'open')
  const closedJobs = JOBS.filter((job) => job.status === 'closed')
  const orderedJobs = [...openJobs, ...closedJobs]

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader />
      <main className="flex-1 pb-16 pt-24 sm:pt-28">
        <div className="container mx-auto max-w-4xl px-4 sm:px-6">
          <div className="mb-10 sm:mb-14">
            <p className="mb-3 font-mono text-xs text-primary">{'// careers'}</p>
            <h1 className="mb-4 text-3xl font-bold tracking-tight sm:text-5xl">
              Build commerce that runs itself.
            </h1>
            <p className="max-w-2xl text-base text-muted-foreground sm:text-lg">
              We are a tiny founding team shipping AI-native e-commerce infrastructure for the next
              million merchants. If you want real ownership at the earliest stage, come build with us.
              <br />
              We are looking for people who are excited to ship products used by thousands of
              merchants and millions of customers — a globally remote, distributed team, moving fast.
            </p>
            <div className="mt-4 max-w-2xl text-base text-muted-foreground sm:text-lg">
              Our great benefits:
              <ul className="list-disc space-y-1 pl-5 pt-1">
                <li>Competitive stipend and founding-team equity</li>
                <li>Fully remote work, global from day one</li>
              </ul>
            </div>
            <p className="mt-4 max-w-2xl text-base text-muted-foreground sm:text-lg">
              If you are interested in joining our team, please check out our open roles below.
            </p>
          </div>

          {/* stats row */}
          <div className="mb-14 grid grid-cols-2 gap-6 border-y border-border py-8 sm:grid-cols-4 sm:gap-4">
            {STATS.map((stat) => (
              <div key={stat.label} className="border-t-2 border-primary/60 pt-3">
                <p className="text-2xl font-bold text-foreground sm:text-3xl">{stat.value}</p>
                <p className="mt-1 text-xs text-muted-foreground sm:text-sm">{stat.label}</p>
              </div>
            ))}
          </div>

          {/* remote / globe section */}
          <div className="mb-16 grid items-center gap-8 sm:grid-cols-2 sm:gap-6">
            <div>
              <h2 className="mb-4 text-2xl font-bold tracking-tight sm:text-3xl">
                We work together, wherever we are.
              </h2>
              <p className="mb-4 text-sm text-muted-foreground sm:text-base">
                Seltra was born remote, out of Accra. We are building for merchants across Ghana and
                Nigeria today, with our sights set on Y Combinator and an eventual base in San
                Francisco. Wherever you are, if you can do the work at a world-class bar, there is a
                seat here.
              </p>
              <p className="text-sm text-muted-foreground sm:text-base">
                We stay close over Slack, Notion, and weekly syncs — asynchronous by default, aligned
                on outcomes.
              </p>
            </div>
            <SpinningGlobe />
          </div>

          <div className="mb-6 flex items-center justify-between">
            <h2 className="font-mono text-xs text-muted-foreground">/open roles - {openJobs.length}</h2>
          </div>

          <div className="space-y-3">
            {orderedJobs.map((job) => {
              const isClosed = job.status === 'closed'
              return (
                <Link
                  key={job.slug}
                  href={`/careers/${job.slug}`}
                  className={`group block rounded-xl border p-5 transition-colors sm:p-6 ${
                    isClosed
                      ? 'border-border bg-card/20 opacity-70 hover:opacity-100'
                      : 'border-border bg-card/40 hover:border-primary/50 hover:bg-card'
                  }`}
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="mb-1 flex items-center gap-2">
                        <p className="font-mono text-[11px] text-muted-foreground">{job.team}</p>
                        {isClosed && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                            <Lock className="h-2.5 w-2.5" /> Closed
                          </span>
                        )}
                      </div>
                      <h3 className="text-lg font-semibold tracking-tight transition-colors group-hover:text-primary sm:text-xl">
                        {job.title}
                      </h3>
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <MapPin className="h-3 w-3" /> {job.location}
                        </span>
                        <span className="flex items-center gap-1">
                          <Briefcase className="h-3 w-3" /> {job.type}
                        </span>
                      </div>
                    </div>
                    <ArrowRight className="h-5 w-5 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
                  </div>
                </Link>
              )
            })}
          </div>

          <div className="mt-16 rounded-xl border border-border bg-card/30 p-6 sm:p-8">
            <p className="mb-2 font-mono text-xs text-primary">{'// open interest'}</p>
            <h3 className="mb-2 text-xl font-semibold">We are always meeting talent.</h3>
            <p className="mb-4 text-sm text-muted-foreground">
              If you would be a unique fit for Seltra at this stage, write to us with what you would
              want to own.
            </p>
            <a
              href="mailto:williamofosu677@gmail.com?subject=Seltra%20General%20interest"
              className="inline-flex items-center gap-2 font-mono text-xs text-primary hover:underline"
            >
              williamofosu677@gmail.com <ArrowRight className="h-3 w-3" />
            </a>
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  )
}