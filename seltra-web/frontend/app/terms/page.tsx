import type { Metadata } from 'next'
import { LegalPage } from '@/components/marketing/LegalPage'
import { pageMeta } from '@/lib/seo'

export const metadata: Metadata = pageMeta({
  title: 'Terms of Service',
  description: 'The terms for creating and operating an AI-generated store on Seltra.',
  path: '/terms',
})

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      lead="Seltra is a platform that enables merchants to create and operate AI-generated online stores. By using Seltra, you agree to these terms."
      sections={[
        {
          heading: 'Use of Service',
          body: 'You may use Seltra to create and manage storefronts for legitimate commercial purposes. You are responsible for the content of your store and compliance with local laws.',
        },
        {
          heading: 'Payments',
          body: 'Payment processing is handled by Moolre. Seltra is not responsible for payment disputes, but we assist in instant resolution and payment reliability. A platform fee applies to each transaction.',
        },
        {
          heading: 'Data',
          body: 'We store your store data, product catalog, and order information to operate the platform. We do not sell your data to third parties.',
        },
      ]}
    />
  )
}
