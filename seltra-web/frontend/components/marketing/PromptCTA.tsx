'use client'

import { MarketingComposer } from '@/components/marketing/MarketingComposer'
import { Aurora } from '@/components/marketing/Aurora'

const prompts = [
  'Ask Seltra to launch a premium coffee brand for...',
  'Ask Seltra to open a bakery selling artisan pastries that...',
  'Ask Seltra to start an organic grocery delivery store...',
]

export function PromptCTA() {
  return <section className="relative overflow-visible px-5 py-20 sm:py-28">
    <Aurora tone="cta" />
    <div className="relative z-10 mx-auto max-w-2xl text-center">
      <h2 className="text-[1.75rem] font-semibold tracking-[-0.035em] text-neutral-950 sm:text-[2.1rem]">Your store is <span className="text-[#16a34a]">one prompt away</span></h2>
      <p className="mx-auto mt-4 text-[15px] text-neutral-500 sm:text-base">No code. No designers. No manual setup. Just describe what you are building.</p>
      <div className="mx-auto mt-8 w-full"><MarketingComposer prompts={prompts}/></div>
    </div>
  </section>
}
