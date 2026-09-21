//seltra-web/frontend/components/storefront/sections/FAQSection.tsx
'use client'
import * as Accordion from '@radix-ui/react-accordion'
import { Minus, Plus } from 'lucide-react'

const DEFAULT = [
  { question:'How long does delivery take?', answer:'Most orders are delivered within 2-5 business days depending on your location.' },
  { question:'What is your return policy?', answer:'We accept returns within 14 days of delivery. Items must be unused and in original packaging.' },
  { question:'Do you offer local pickup?', answer:'Yes. Select local pickup at checkout.' },
  { question:'How do I track my order?', answer:'You will receive a tracking link by email once your order ships.' },
]

export function FAQSection({ headline = 'Frequently asked questions', items }: { headline?: string; items?: Array<{ question: string; answer: string }> }) {
  const faqs = items?.length ? items : DEFAULT
  return (
    <section className="storefront-section border-t" style={{ borderColor:'var(--store-border)' }}>
      <div className="mx-auto max-w-3xl">
        <h2 className="store-heading mb-10 text-center text-[clamp(2rem,4vw,3rem)] font-black text-balance">
          {headline}
        </h2>
        <Accordion.Root type="single" collapsible className="space-y-0">
          {faqs.map((faq, i) => (
            <Accordion.Item
              key={i}
              value={String(i)}
              className="border-b"
              style={{ borderColor:'var(--store-border)' }}
            >
              <Accordion.Trigger
                className="group flex w-full items-center justify-between gap-4 py-6 text-left"
                style={{ color:'var(--store-text)' }}
              >
                <span
                  className="text-base font-bold leading-snug"
                  style={{ fontFamily:'var(--store-heading-font), serif' }}
                >
                  {faq.question}
                </span>
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border" style={{ borderColor:'var(--store-border)', color:'var(--store-muted)' }}>
                  <Plus className="h-3.5 w-3.5 group-data-[state=open]:hidden" />
                  <Minus className="hidden h-3.5 w-3.5 group-data-[state=open]:block" />
                </span>
              </Accordion.Trigger>
              <Accordion.Content
                className="overflow-hidden pb-6 text-sm leading-relaxed data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down"
                style={{ color:'var(--store-muted)' }}
              >
                {faq.answer}
              </Accordion.Content>
            </Accordion.Item>
          ))}
        </Accordion.Root>
      </div>
    </section>
  )
}
