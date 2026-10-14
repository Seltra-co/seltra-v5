import { SiteFooter } from '@/components/marketing/SiteFooter'
import { SiteHeader } from '@/components/marketing/SiteHeader'

export type LegalSection = { heading: string; body: string }

export function LegalPage({ title, lead, sections }: { title: string; lead: string; sections: LegalSection[] }) {
  return (
    <div className="site-dark relative min-h-screen overflow-hidden">
      <SiteHeader dark />
      <img src="/seltra/mark-left.png" alt="" aria-hidden className="pointer-events-none absolute left-0 top-28 w-24 select-none sm:w-36 lg:w-44" />

      <main className="relative z-10 mx-auto max-w-3xl px-5 pb-24 pt-36 sm:px-6 sm:pt-44">
        <h1 className="text-[2.5rem] font-semibold tracking-[-0.04em] sm:text-[3.4rem]">
          {title}
          <span className="text-[#4ade80]">.</span>
        </h1>
        <p className="mt-6 text-[16px] leading-relaxed text-white/75 sm:text-lg">{lead}</p>

        <div className="mt-12 space-y-10">
          {sections.map((section) => (
            <section key={section.heading} data-reveal>
              <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">{section.heading}</h2>
              <p className="mt-3 text-[15px] leading-relaxed text-white/65 sm:text-base">{section.body}</p>
            </section>
          ))}

          <section data-reveal className="site-dark-card rounded-[1.5rem] p-6 sm:p-7">
            <h2 className="text-lg font-semibold">Contact email</h2>
            <a href="mailto:hello@seltra.co" className="mt-2 inline-block text-[15px] text-[#4ade80] hover:underline">
              hello@seltra.co
            </a>
          </section>
        </div>
      </main>

      <SiteFooter />
    </div>
  )
}
