import type { Metadata } from 'next'
import { LegalPage } from '@/components/marketing/LegalPage'
import { pageMeta } from '@/lib/seo'

export const metadata: Metadata = pageMeta({
  title: 'Privacy Policy',
  description: 'How Seltra collects and uses account, store, product, and order data.',
  path: '/privacy',
})

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      lead="Seltra collects only the information needed to operate your store: your email, store details, products, and order data."
      sections={[
        {
          heading: 'What we collect',
          body: 'Account email, store name and configuration, product catalog, order and customer data from your store buyers.',
        },
        {
          heading: 'How we use it',
          body: 'To operate your storefront, process orders, and improve the platform. We never sell your data.',
        },
        {
          heading: 'Third parties',
          body: 'Moolre processes payments. No advertising networks have access to your data.',
        },
      ]}
    />
  )
}
