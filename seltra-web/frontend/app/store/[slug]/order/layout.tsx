import type { Metadata } from 'next'
import { noIndex } from '@/lib/seo'

export const metadata: Metadata = {
  ...noIndex,
  title: 'Order',
}

export default function OrderLayout({ children }: { children: React.ReactNode }) {
  return children
}
