//seltra-web/frontend/app/(dashboard)/layout.tsx
import type { Metadata } from 'next'
import { noIndex } from '@/lib/seo'

export const metadata: Metadata = {
  ...noIndex,
  title: 'Dashboard',
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
