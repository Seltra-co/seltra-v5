//seltra-web/frontend/app/careers/[slug]/page.tsx
'use client'

import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, ArrowRight, Briefcase, Coins, Lock, MapPin, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SiteHeader } from '@/components/marketing/SiteHeader'
import { SiteFooter } from '@/components/marketing/SiteFooter'
import { getJob } from '@/lib/jobs'

export default function CareerDetailPage() {
  const router = useRouter()
  const params = useParams<{ slug: string }>()
  const job = getJob(params.slug)

  if (!job) {
    return (
      <div className="flex min-h-screen flex-col bg-background">
        <SiteHeader />
        <main className="container mx-auto flex-1 px-4 pb-16 pt-28 text-center">
          <p className="mb-3 font-mono text-xs text-primary">{'// 404'}</p>
          <h1 className="mb-4 text-2xl font-bold">Role not found</h1>
          <Button onClick={() => router.push('/careers')} className="rounded-md">Back to careers</Button>
        </main>
        <SiteFooter />
      </div>
    )
  }

  const isClosed = job.status === 'closed'

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader />
      <main className="flex-1 pb-16 pt-24 sm:pt-28">
        <div className="container mx-auto max-w-3xl px-4 sm:px-6">
          <Link href="/careers" className="mb-6 inline-flex items-center gap-1 font-mono text-xs text-muted-foreground hover:text-primary">
            <ArrowLeft className="h-3 w-3" /> all roles
          </Link>

          <p className="mb-3 font-mono text-xs text-primary">{`// ${job.team}`}</p>
          <h1 className="mb-4 text-3xl font-bold tracking-tight sm:text-4xl">{job.title}</h1>

          <div className="mb-6 flex flex-wrap gap-x-5 gap-y-2 font-mono text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5"><MapPin className="h-3 w-3" /> {job.location}</span>
            <span className="flex items-center gap-1.5"><Briefcase className="h-3 w-3" /> {job.type}</span>
            <span className="flex items-center gap-1.5"><Coins className="h-3 w-3" /> {job.compensation}</span>
          </div>

          <p className="mb-8 text-base text-muted-foreground sm:text-lg">{job.summary}</p>

          {isClosed ? (
            <div className="mb-10 flex gap-3 rounded-xl border border-border bg-card/40 p-5 sm:p-6">
              <Lock className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
              <div>
                <p className="mb-1 font-mono text-xs text-muted-foreground">{'// this role is closed'}</p>
                <p className="text-sm text-foreground">{job.closedNote}</p>
                <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                  <Button variant="outline" size="lg" className="rounded-md font-mono text-xs" onClick={() => router.push('/careers')}>
                    See open roles
                  </Button>
                  <a href="mailto:williamofosu677@gmail.com?subject=Seltra%20General%20interest" className="inline-flex">
                    <Button size="lg" className="w-full rounded-md font-mono text-xs sm:w-auto">Register interest</Button>
                  </a>
                </div>
              </div>
            </div>
          ) : (
            <div className="mb-12 flex flex-col gap-3 sm:flex-row">
              <Button size="lg" className="rounded-md font-mono text-xs" onClick={() => router.push(`/careers/${job.slug}/apply`)}>
                Apply for this role <ArrowRight className="h-4 w-4" />
              </Button>
              <a href="mailto:williamofosu677@gmail.com" className="inline-flex">
                <Button size="lg" variant="outline" className="w-full rounded-md font-mono text-xs sm:w-auto">Ask a question</Button>
              </a>
            </div>
          )}

          <Section title="The mission"><p>{job.mission}</p></Section>
          <Section title="What you will own"><List items={job.responsibilities} /></Section>
          <Section title="You probably look like"><List items={job.youAre} /></Section>
          <Section title="Nice to have"><List items={job.niceToHave} /></Section>

          <div className="mt-10 flex gap-3 rounded-xl border border-primary/30 bg-primary/5 p-5 sm:p-6">
            <Sparkles className="mt-1 h-4 w-4 shrink-0 text-primary" />
            <div>
              <p className="mb-1 font-mono text-xs text-primary">{'// stage'}</p>
              <p className="text-sm text-muted-foreground">{job.stage}</p>
            </div>
          </div>

          {!isClosed && (
            <div className="mt-12">
              <Button size="lg" className="rounded-md font-mono text-xs" onClick={() => router.push(`/careers/${job.slug}/apply`)}>
                Apply for this role <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      </main>
      <SiteFooter />
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-lg font-semibold sm:text-xl">{title}</h2>
      <div className="text-sm leading-relaxed text-muted-foreground sm:text-base">{children}</div>
    </section>
  )
}

function List({ items }: { items: string[] }) {
  return (
    <ul className="list-disc space-y-2 pl-5">
      {items.map((item) => <li key={item}>{item}</li>)}
    </ul>
  )
}