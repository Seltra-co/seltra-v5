import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background text-center px-4">
      <div className="font-mono text-[11px] text-primary mb-4">{'// 404'}</div>
      <h1 className="text-5xl font-black tracking-tight mb-3">Not found</h1>
      <p className="text-muted-foreground mb-8">This page does not exist or was moved.</p>
      <Link href="/" className="flex items-center gap-2 text-sm text-primary hover:text-primary/80 transition-colors">
        <ArrowLeft className="h-4 w-4" /> Back to Seltra
      </Link>
    </div>
  )
}
