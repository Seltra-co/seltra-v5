//seltra-web/frontend/components/storefront/sections/Newsletter.tsx
'use client'
import { useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowRight } from 'lucide-react'

export function Newsletter({ headline, subtext, placeholder = 'Enter your email', buttonLabel }: {
  headline: string; subtext: string; placeholder?: string; buttonLabel?: string
}) {
  const [submitted, setSubmitted] = useState(false)
  const [value, setValue] = useState('')

  return (
    <section
      className="relative overflow-hidden"
      style={{
        background: 'var(--store-accent)',
        borderTop: '1px solid var(--store-border)',
        paddingTop: 'clamp(4rem, 8vh, 7rem)',
        paddingBottom: 'clamp(4rem, 8vh, 7rem)',
        paddingLeft: 'clamp(1rem, 4vw, 2rem)',
        paddingRight: 'clamp(1rem, 4vw, 2rem)',
      }}
    >
      {/* Subtle texture overlay */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage: 'radial-gradient(circle at 2px 2px, currentColor 1px, transparent 0)',
          backgroundSize: '32px 32px',
          color: 'var(--store-accent-text)',
        }}
      />

      <div className="relative mx-auto max-w-lg text-center">
        <motion.h2
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.55 }}
          className="store-heading mb-3 text-[clamp(1.75rem,4vw,3rem)] font-black"
          style={{ color: 'var(--store-accent-text)', lineHeight: 1.05 }}
        >
          {headline}
        </motion.h2>

        <motion.p
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.55, delay: 0.08 }}
          className="mb-8 text-sm leading-relaxed"
          style={{ color: 'color-mix(in srgb, var(--store-accent-text) 75%, transparent)' }}
        >
          {subtext}
        </motion.p>

        {submitted ? (
          <motion.p
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="text-base font-bold"
            style={{ color: 'var(--store-accent-text)' }}
          >
            ✓ You&apos;re in. Welcome.
          </motion.p>
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.15 }}
            className="flex gap-2"
            style={{ maxWidth: 420, margin: '0 auto' }}
          >
            <input
              type="email"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={placeholder}
              onKeyDown={(e) => e.key === 'Enter' && value.includes('@') && setSubmitted(true)}
              className="flex-1 border-0 text-sm outline-none"
              style={{
                background: 'color-mix(in srgb, var(--store-accent-text) 15%, transparent)',
                color: 'var(--store-accent-text)',
                borderRadius: '9999px',
                padding: '0.75rem 1.25rem',
              }}
            />
            <button
              onClick={() => value.includes('@') && setSubmitted(true)}
              className="flex shrink-0 items-center gap-1.5 text-sm font-bold"
              style={{
                background: 'var(--store-cta-newsletter-bg)',
                color: 'var(--store-cta-newsletter-text)',
                borderRadius: '9999px',
                padding: '0.75rem 1.5rem',
                border: 'none',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {buttonLabel ?? 'Subscribe'} <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </motion.div>
        )}

        <p
          className="mt-4 text-[0.7rem]"
          style={{ color: 'color-mix(in srgb, var(--store-accent-text) 50%, transparent)' }}
        >
          No spam. Unsubscribe anytime.
        </p>
      </div>
    </section>
  )
}
