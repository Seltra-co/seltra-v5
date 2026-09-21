//seltra-web/frontend/components/storefront/sections/SocialProof.tsx
'use client'
import { motion } from 'framer-motion'

const STARS = '★★★★★'

export function SocialProof({ style, headline, subtext, reviews }: {
  style: 'marquee' | 'grid' | 'cards'
  headline?: string
  subtext?: string
  reviews?: Array<{ text: string; author: string }>
}) {
  if (!reviews?.length) return null
  const items = reviews
  if (style === 'marquee') return (
    <section
      className="border-t"
      style={{
        borderColor: 'var(--store-border)',
        background: 'var(--store-surface)',
        paddingTop: 'clamp(2rem, 4vh, 3rem)',
        paddingBottom: 'clamp(2rem, 4vh, 3rem)',
      }}
    >
      {headline && (
        <p
          className="store-eyebrow mb-4 text-center"
          style={{ color: 'var(--store-muted)' }}
        >
          {headline}
        </p>
      )}
      <div
        style={{
          overflow: 'hidden',
          mask: 'linear-gradient(90deg, transparent, black 8%, black 92%, transparent)',
          WebkitMask: 'linear-gradient(90deg, transparent, black 8%, black 92%, transparent)',
        }}
      >
        <div className="store-marquee-inner">
          {[...items, ...items].map((r, i) => (
            <span
              key={i}
              className="whitespace-nowrap text-[0.8rem]"
              style={{
                borderRadius: '9999px',
                border: '1px solid var(--store-border)',
                padding: '0.5rem 1.25rem',
                color: 'var(--store-muted)',
                background: 'var(--store-bg)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.5rem',
                flexShrink: 0,
              }}
            >
              <span style={{ color: 'var(--store-accent)', fontSize: '0.7rem' }}>{STARS}</span>
              {r.text}
            </span>
          ))}
        </div>
      </div>
    </section>
  )

  // cards or grid
  return (
    <section
      className="border-t"
      style={{
        borderColor: 'var(--store-border)',
        background: 'var(--store-bg)',
        paddingTop: 'clamp(3rem, 6vh, 5rem)',
        paddingBottom: 'clamp(3rem, 6vh, 5rem)',
        paddingLeft: 'clamp(1rem, 4vw, 2rem)',
        paddingRight: 'clamp(1rem, 4vw, 2rem)',
      }}
    >
      {(headline || subtext) && (
        <div className="mb-10 text-center">
          {headline && (
            <h2
              className="store-heading text-[clamp(1.5rem,3vw,2.25rem)] font-black"
            >
              {headline}
            </h2>
          )}
          {subtext && (
            <p className="mt-2 text-sm" style={{ color: 'var(--store-muted)' }}>
              {subtext}
            </p>
          )}
        </div>
      )}

      {/* Cards: horizontal scroll with hidden scrollbar */}
      {style === 'cards' ? (
        <div
          style={{
            display: 'flex',
            gap: '1rem',
            overflowX: 'auto',
            paddingBottom: '0.25rem',
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
          }}
          // hide webkit scrollbar via inline ref trick
          ref={(el) => {
            if (el) {
              const style = document.createElement('style')
              style.textContent = `.proof-scroll::-webkit-scrollbar { display: none; }`
              el.classList.add('proof-scroll')
              if (!document.head.querySelector('[data-proof-style]')) {
                style.setAttribute('data-proof-style', '')
                document.head.appendChild(style)
              }
            }
          }}
        >
          {items.map((r, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: i * 0.06 }}
              style={{
                background: 'var(--store-surface)',
                border: '1px solid var(--store-border)',
                borderRadius: 'var(--store-radius)',
                padding: '1.5rem',
                minWidth: '260px',
                maxWidth: '280px',
                flexShrink: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: '0.75rem',
              }}
            >
              <div style={{ color: 'var(--store-accent)', fontSize: '0.85rem', letterSpacing: '0.05em' }}>
                {STARS}
              </div>
              <p className="text-[0.85rem] leading-relaxed" style={{ color: 'var(--store-text)' }}>
                &ldquo;{r.text}&rdquo;
              </p>
              <p className="text-[0.72rem] font-semibold" style={{ color: 'var(--store-muted)' }}>
                — {r.author}
              </p>
            </motion.div>
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-3">
          {items.slice(0, 3).map((r, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: i * 0.07 }}
              style={{
                background: 'var(--store-surface)',
                border: '1px solid var(--store-border)',
                borderRadius: 'var(--store-radius)',
                padding: '1.5rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.75rem',
              }}
            >
              <div style={{ color: 'var(--store-accent)', fontSize: '0.85rem' }}>{STARS}</div>
              <p className="text-[0.85rem] leading-relaxed" style={{ color: 'var(--store-text)' }}>
                &ldquo;{r.text}&rdquo;
              </p>
              <p className="text-[0.72rem] font-semibold" style={{ color: 'var(--store-muted)' }}>
                — {r.author}
              </p>
            </motion.div>
          ))}
        </div>
      )}
    </section>
  )
}