import React from 'react'

export function AgentStreamStatus({ status, skeleton = false, phase }: { status?: string; skeleton?: boolean; phase?: string }) {
  return <section data-phase={phase} className={`my-2 flex min-h-10 items-center gap-3 text-sm text-white/75 ${phase === 'asking' ? 'rounded-xl border border-white/[0.08] bg-[#171b19] px-4 py-3' : ''}`} role="status" aria-live="polite" aria-label="Seltra response">
    <img src="/assets/brand/mark.png" alt="" className="h-6 w-6 shrink-0 object-contain" />
    {status ? <span>{status}</span> : skeleton ? <span aria-label="Seltra is preparing a response" className="h-3 w-32 animate-pulse rounded-full bg-white/10" /> : null}
  </section>
}
