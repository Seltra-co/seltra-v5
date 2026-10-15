import type { Metadata } from 'next'
import { noIndex } from '@/lib/seo'

export const metadata: Metadata = {
  ...noIndex,
  title: 'Apply',
}

export default function CareerApplyLayout({ children }: { children: React.ReactNode }) {
  return children
}
