'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { Menu, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

function getToken() {
  return typeof window !== 'undefined' ? localStorage.getItem('seltra:token') : null
}

export function SiteHeader() {
  const [open, setOpen] = useState(false)
  const [authed, setAuthed] = useState(false)

  useEffect(() => setAuthed(Boolean(getToken())), [])

  return (
    <header className="fixed left-0 right-0 top-0 z-50 border-b border-border bg-background/70 backdrop-blur-xl">
      <div className="container mx-auto px-4 sm:px-6">
        <div className="flex h-16 items-center justify-between">
          <div className="flex min-w-0 items-center gap-6 lg:gap-10">
            <Link href="/" className="flex min-w-0 items-center gap-2">
              <img src="https://res.cloudinary.com/dfmsaarli/image/upload/v1782364695/ICON_large_ngiv41.png" alt="Seltra" className="h-9 w-9 rounded-md" />
              <span className="font-mono font-semibold tracking-tight text-foreground">seltra</span>
              <span className="hidden rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline">beta</span>
            </Link>
            <nav className="hidden items-center gap-7 font-mono text-xs text-muted-foreground lg:flex">
              <Link href="/#showcase" className="transition-colors hover:text-primary">/showcase</Link>
              <Link href="/careers" className="transition-colors hover:text-primary">/careers</Link>
              <Link href="/apply" className="transition-colors hover:text-primary">/apply</Link>
            </nav>
          </div>

          <div className="flex items-center gap-2">
            <Button asChild size="sm" variant={authed ? 'default' : 'ghost'} className="hidden rounded-md font-mono text-xs sm:inline-flex">
              <Link href={authed ? '/dashboard' : '/auth?next=/dashboard'}>Merchant login</Link>
            </Button>
            <Button asChild size="sm" className="rounded-md font-mono text-xs">
              <Link href="/apply">Apply to sell on Seltra</Link>
            </Button>
            <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setOpen((value) => !value)} aria-label="Toggle menu">
              {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>
          </div>
        </div>
      </div>

      {open && (
        <div className="border-t border-border bg-background lg:hidden">
          <nav className="container mx-auto flex flex-col gap-3 px-4 py-4 font-mono text-sm">
            <Link href="/#showcase" className="py-2 text-muted-foreground hover:text-primary" onClick={() => setOpen(false)}>/showcase</Link>
            <Link href="/careers" className="py-2 text-muted-foreground hover:text-primary" onClick={() => setOpen(false)}>/careers</Link>
            <Link href="/apply" className="py-2 text-muted-foreground hover:text-primary" onClick={() => setOpen(false)}>/apply</Link>
            <Link href="/auth?next=/dashboard" className="py-2 text-muted-foreground hover:text-primary sm:hidden" onClick={() => setOpen(false)}>/merchant-login</Link>
          </nav>
        </div>
      )}
    </header>
  )
}
