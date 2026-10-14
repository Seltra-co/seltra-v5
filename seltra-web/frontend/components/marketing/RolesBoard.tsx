'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { MapPin } from 'lucide-react'
import type { Job } from '@/lib/jobs'
import { cn } from '@/lib/utils'

export function RolesBoard({ jobs }: { jobs: Job[] }) {
  const departments = useMemo(() => Array.from(new Set(jobs.map((job) => job.department))), [jobs])
  const [active, setActive] = useState('All')
  const [hideClosed, setHideClosed] = useState(false)

  const visible = jobs.filter(
    (job) => (active === 'All' || job.department === active) && (!hideClosed || job.status === 'open'),
  )
  const groups = departments
    .map((department) => ({ department, jobs: visible.filter((job) => job.department === department) }))
    .filter((group) => group.jobs.length > 0)

  return (
    <div className="landing-menu">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          {['All', ...departments].map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActive(tab)}
              className={cn(
                'h-9 rounded-lg border px-4 text-[13px] transition-colors',
                active === tab
                  ? 'border-[#16a34a] bg-[#16a34a] text-white'
                  : 'border-white/10 bg-white/[0.03] text-white/70 hover:border-white/25 hover:text-white',
              )}
            >
              {tab === 'All' ? 'All roles' : tab}
            </button>
          ))}
        </div>

        <label className="flex h-9 w-fit cursor-pointer select-none items-center gap-3 rounded-lg border border-white/10 bg-white/[0.03] pl-3.5 pr-1.5 text-[13px] text-white/70">
          Hide closed
          <button
            type="button"
            role="switch"
            aria-checked={hideClosed}
            onClick={() => setHideClosed((value) => !value)}
            className={cn('relative h-5 w-9 rounded-full transition-colors', hideClosed ? 'bg-[#16a34a]' : 'bg-white/15')}
          >
            <span
              className={cn(
                'absolute left-0 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform',
                hideClosed ? 'translate-x-[18px]' : 'translate-x-0.5',
              )}
            />
          </button>
        </label>
      </div>

      <div className="mt-8 space-y-8">
        {groups.length === 0 ? (
          <p className="rounded-xl border border-white/10 bg-white/[0.03] p-6 text-center text-sm text-white/60">
            No roles match right now. Check back soon.
          </p>
        ) : (
          groups.map((group) => (
            <div key={group.department}>
              <h3 className="mb-3 text-[12px] uppercase tracking-[0.16em] text-white/45">{group.department}</h3>
              <div className="divide-y divide-white/[0.07] overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.02]">
                {group.jobs.map((job) => {
                  const closed = job.status === 'closed'
                  return (
                    <Link
                      key={job.slug}
                      href={`/careers/${job.slug}`}
                      className="group flex items-center gap-4 px-4 py-3.5 transition-colors hover:bg-white/[0.03] sm:px-5"
                    >
                      <p
                        className={cn(
                          'min-w-0 flex-1 text-[14px] font-medium transition-colors sm:text-[15px]',
                          closed ? 'text-white/45' : 'text-white group-hover:text-[#4ade80]',
                        )}
                      >
                        {job.title}
                      </p>
                      <span className="hidden items-center gap-1.5 text-[13px] text-white/50 sm:flex">
                        <MapPin className="h-3.5 w-3.5" /> {job.location.split(/[—-]/)[0].trim()}
                      </span>
                      <span
                        className={cn(
                          'inline-flex h-8 w-20 shrink-0 items-center justify-center rounded-lg border text-[13px] transition-colors',
                          closed
                            ? 'border-white/10 text-white/40'
                            : 'border-white/20 text-white group-hover:border-[#16a34a] group-hover:bg-[#16a34a]',
                        )}
                      >
                        {closed ? 'Closed' : 'Apply'}
                      </span>
                    </Link>
                  )
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
