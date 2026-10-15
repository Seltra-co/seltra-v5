import type { Metadata } from 'next'
import HomePage from '@/components/marketing/HomePage'
import { defaultDescription, pageMeta } from '@/lib/seo'

export const metadata: Metadata = pageMeta({
  title: 'Seltra | AI Commerce Platform for Modern Businesses',
  description: defaultDescription,
  path: '/',
  absoluteTitle: true,
})

export default function Page() {
  return <HomePage />
}
