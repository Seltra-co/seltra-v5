import type { Metadata } from 'next'
import { noIndex } from '@/lib/seo'

export const metadata: Metadata = {
  ...noIndex,
  title: 'Log in',
}

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return children
}
