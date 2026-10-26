//seltra-web/frontend/app/careers/page.tsx
import type { Metadata } from 'next'
import { BackgroundMark } from '@/components/marketing/BackgroundMark'
import { CareersStats } from '@/components/marketing/CareersStats'
import { RolesBoard } from '@/components/marketing/RolesBoard'
import { SiteFooter } from '@/components/marketing/SiteFooter'
import { SiteHeader } from '@/components/marketing/SiteHeader'
import { SlashDivider } from '@/components/marketing/SlashDivider'
import { SpinningGlobe } from '@/components/marketing/spinningGlobe'
import { JOBS } from '@/lib/jobs'
import { publicImages, publicPhoto } from '@/lib/public-asset'
import { pageMeta } from '@/lib/seo'
import { cn } from '@/lib/utils'

export const metadata: Metadata = pageMeta({
  title: 'Careers',
  description: 'Join the founding team building commerce that runs itself. Remote roles across engineering, operations, and go-to-market.',
  path: '/careers',
})

const STATS = [
  { value: '02', label: 'Launch markets — Ghana & Nigeria' },
  { value: '150+', label: 'Merchants in active pipeline' },
  { value: '<15 min', label: 'From prompt to live store' },
  { value: 'Remote', label: 'Global, distributed team' },
]

const PERKS = ['Competitive stipend and founding-team equity', 'Fully remote, working globally from day one']

function Photo({ src, alt, className }: { src: string | null; alt: string; className?: string }) {
  return (
    <div className={cn('relative overflow-hidden', className)}>
      {src ? (
        <img src={src} alt={alt} className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <div className="photo-placeholder absolute inset-0" />
      )}
    </div>
  )
}

export default function CareersPage() {
  const orderedJobs = [...JOBS.filter((job) => job.status === 'open'), ...JOBS.filter((job) => job.status === 'closed')]
  const teamPhoto = publicPhoto('/seltra/careers/team')
  const perksPhoto = publicPhoto('/seltra/careers/perks')
  const globeImage = publicPhoto('/seltra/careers/globe')
  const gallery = publicImages('seltra/careers/gallery')
  const gallerySlots: (string | null)[] = gallery.length > 0 ? gallery : Array.from({ length: 8 }, () => null)

  return (
    <div className="landing-page min-h-screen">
      <SiteHeader />

      <section className="px-3 sm:px-6">
        <div className="careers-hero relative mx-auto flex min-h-[560px] max-w-[1400px] items-center justify-center overflow-hidden rounded-b-[2rem] px-5 pb-16 pt-32 text-center text-white sm:h-[88svh] sm:max-h-[860px] sm:rounded-b-[2.5rem] sm:pt-28">
          <div className="relative z-10 mx-auto max-w-2xl">
            <h1 className="text-balance text-[2.1rem] font-semibold leading-[1.1] tracking-[-0.035em] sm:text-[2.1rem]">
              Build commerce that runs itself.
            </h1>
            <p className="mx-auto mt-3 max-w-xl text-[15px] leading-relaxed text-white/75 sm:text-base">
              A tiny founding team shipping AI-native e-commerce infrastructure for the next million merchants.
            </p>
            <a href="#roles" className="btn mt-7 !h-11 !rounded-[10px] border border-white/60 bg-transparent !px-6 !font-normal text-white hover:bg-white/10">
              See open roles
            </a>
          </div>
        </div>
      </section>

      <main className="relative overflow-hidden">
        <section data-reveal className="relative pb-14 pt-16 sm:pt-20">
          <div className="mx-auto grid max-w-[1500px] items-center gap-10 lg:grid-cols-2 lg:gap-0">
            <div>
              <div className="mx-auto w-full max-w-[1264px] px-5 sm:px-8 lg:ml-auto lg:mr-0 lg:max-w-[632px] lg:px-10">
                <h2 className="text-[1.75rem] font-semibold tracking-[-0.035em] text-[#16844a] sm:text-[1.9rem]">Who we are.</h2>
                <p className="mt-4 max-w-md text-[15px] leading-[1.65] text-neutral-700">
                  We are a tiny founding team shipping AI-native e-commerce infrastructure for the next million merchants.
                  If you want real ownership at the earliest stage, come build with us.
                </p>
                <p className="mt-4 max-w-md text-[15px] leading-[1.65] text-neutral-700">
                  We are looking for people who are excited to ship products used by thousands of merchants and millions of
                  customers — a globally remote, distributed team, moving fast.
                </p>
              </div>
              <img
                src="/assets/brand/mark.png"
                alt=""
                aria-hidden
                className="page-mark-light pointer-events-none -mt-20 ml-0 block h-auto w-[180px] max-w-none select-none !opacity-[0.14] sm:-mt-28 sm:w-[250px] lg:absolute lg:bottom-0 lg:left-0 lg:-translate-x-[45%] lg:w-[300px]"
              />
            </div>
            <div className="mx-auto w-full max-w-[1264px] px-5 sm:px-8 lg:mr-auto lg:max-w-[632px] lg:px-10">
              <Photo
                src={teamPhoto}
                alt="The Seltra team"
                className="aspect-[3/2] rounded-[1.5rem] shadow-[0_30px_70px_-40px_rgba(0,0,0,0.55)]"
              />
            </div>
          </div>
        </section>

        <section data-reveal className="mx-auto grid max-w-[1264px] grid-cols-2 gap-3 px-5 pb-20 sm:grid-cols-4 sm:gap-4 sm:px-8 sm:pb-24">
          {gallerySlots.map((src, index) => (
            <Photo key={src ?? index} src={src} alt="" className="aspect-[4/3] rounded-[1rem] transition-[transform,box-shadow] duration-300 ease-out hover:z-10 hover:-translate-y-1.5 hover:scale-[1.06] hover:shadow-[0_24px_50px_-18px_rgba(0,0,0,0.45)] motion-reduce:transition-none motion-reduce:hover:transform-none" />
          ))}
        </section>

        <section data-reveal className="site-dark-card relative mx-auto grid w-[min(1264px,calc(100%-2.5rem))] items-center gap-8 rounded-[1.75rem] p-5 text-white sm:w-[min(1264px,calc(100%-4rem))] sm:p-8 lg:grid-cols-2 lg:gap-14 lg:p-10">
          <BackgroundMark tone="dark" className="right-0 top-1/2 hidden w-[220px] -translate-y-1/2 !opacity-[0.13] lg:block" />
          <Photo src={perksPhoto} alt="The Seltra team at work" className="aspect-[16/10] rounded-[1.25rem]" />
          <div className="relative">
            <h2 className="text-[1.75rem] font-semibold tracking-[-0.035em] sm:text-[1.9rem]">
              <span className="text-[#4ade80]">Perks</span> & benefits
            </h2>
            <p className="mt-3 text-[15px] text-white/65">Here is what you get when you join.</p>
            <ol className="mt-6 space-y-4">
              {PERKS.map((perk, index) => (
                <li key={perk} className="flex items-center gap-3.5">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-[12px] font-semibold text-neutral-900">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span className="text-[15px] text-white/85">{perk}</span>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section data-reveal className="mx-auto max-w-[1264px] px-5 py-16 sm:px-8 sm:py-20">
          <CareersStats stats={STATS} />
        </section>

        <section data-reveal className="site-dark-card mx-auto mb-20 grid w-[min(1264px,calc(100%-2.5rem))] items-center gap-8 rounded-[1.75rem] px-6 py-12 text-white sm:mb-24 sm:w-[min(1264px,calc(100%-4rem))] sm:px-12 sm:py-14 lg:grid-cols-2">
          <div>
            <h2 className="text-[1.75rem] font-semibold leading-tight tracking-[-0.035em] sm:text-[1.9rem]">
              We work together,
              <br />
              <span className="text-[#4ade80]">wherever we are.</span>
            </h2>
            <p className="mt-5 max-w-lg text-[15px] leading-relaxed text-white/65">
              Seltra was born remote, out of Accra. We are building for merchants across Ghana and Nigeria today, with our
              sights set on Y Combinator and an eventual base in San Francisco. Wherever you are, if you can do the work at
              a world-class bar, there is a seat here.
            </p>
            <p className="mt-4 max-w-lg text-[15px] leading-relaxed text-white/65">
              We stay close over Slack, Notion, and weekly syncs — asynchronous by default, aligned on outcomes.
            </p>
          </div>
          {globeImage ? (
            <img src={globeImage} alt="" className="mx-auto w-full max-w-[380px] opacity-80 mix-blend-screen invert" />
          ) : (
            <SpinningGlobe />
          )}
        </section>
      </main>

      <div className="bg-[#212121] text-white">
        <section id="roles" className="mx-auto max-w-[1328px] scroll-mt-24 px-5 pb-16 pt-16 sm:px-8 sm:pt-20">
          <h2 className="text-[1.75rem] font-semibold leading-tight tracking-[-0.035em] sm:text-[1.9rem]">
            Find open <span className="text-[#4ade80]">roles available.</span>
          </h2>
          <p className="mt-3 max-w-xl text-[15px] text-white/60">
            Pick a department to see where you could make the biggest dent.
          </p>
          <div className="mt-8">
            <RolesBoard jobs={orderedJobs} />
          </div>
          <p className="mt-8 text-[14px] text-white/55">
            Don&apos;t see a role that fits? We are always meeting talent — write to{' '}
            <a href="mailto:williamofosu677@gmail.com?subject=Seltra%20General%20interest" className="text-[#4ade80] hover:underline">
              williamofosu677@gmail.com
            </a>{' '}
            with what you would want to own.
          </p>
          <SlashDivider className="mt-16 text-center" />
        </section>
        <SiteFooter />
      </div>
    </div>
  )
}
