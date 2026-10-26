'use client'

import { useEffect, useState } from 'react'

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001'

export function CareersStats({ stats }: { stats: { value: string; label: string }[] }) {
  const [merchantCount, setMerchantCount] = useState(2)

  useEffect(() => {
    let active = true
    const refresh = async () => {
      try {
        const response = await fetch(`${API_BASE}/api/v5/public/metrics`, { cache: 'no-store' })
        if (!response.ok) return
        const metrics = await response.json() as { merchants?: number }
        if (active && Number.isFinite(metrics.merchants)) setMerchantCount(Math.max(0, metrics.merchants ?? 0))
      } catch {
        // Keep the last known count visible if the public metric endpoint is temporarily unavailable.
      }
    }
    void refresh()
    const interval = window.setInterval(() => void refresh(), 10_000)
    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [])

  return (
    <div className="grid grid-cols-2 gap-3 rounded-[1.5rem] border border-white/80 bg-white/85 px-4 py-8 shadow-[0_30px_70px_-40px_rgba(22,120,60,0.45)] sm:py-10 md:grid-cols-4 md:divide-x md:divide-neutral-200">
      {stats.map((stat, index) => (
        <div key={stat.label} className="px-2 text-center sm:px-4">
          <p className="whitespace-nowrap text-[1.45rem] font-semibold tracking-[-0.03em] text-[#16a34a] min-[375px]:text-[1.8rem] sm:text-[2.2rem]">
            {index === 1 ? `${merchantCount.toLocaleString()}+` : stat.value}
          </p>
          <p className="mx-auto mt-1.5 max-w-[11rem] text-[11px] uppercase leading-snug tracking-[0.12em] text-neutral-600">
            {stat.label}
          </p>
        </div>
      ))}
    </div>
  )
}
