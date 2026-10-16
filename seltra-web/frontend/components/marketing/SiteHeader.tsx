'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ChevronDown, Menu, X } from 'lucide-react'
import { AuthFlowModal } from '@/components/marketing/AuthFlowModal'
import { cn } from '@/lib/utils'

const featureLinks = [
  { href: '/features', label: 'All features' },
  { href: '/#pipeline', label: 'How it works' },
  { href: '/#features', label: 'Specialized agents' },
]

export function SiteHeader({ transparentTop = false, dark = false }: { transparentTop?: boolean; dark?: boolean }) {
  const [open, setOpen] = useState(false)
  const [featuresOpen, setFeaturesOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const [brandReady, setBrandReady] = useState(false)
  const [authOpen, setAuthOpen] = useState(false)
  const [authSession, setAuthSession] = useState(0)

  const bindLogo = (node: HTMLImageElement | null) => {
    if (!node) return
    const ready = () => setBrandReady(true)
    if (node.complete && node.naturalWidth > 0) ready()
    else node.addEventListener('load', ready, { once: true })
  }

  const openLogin = () => {
    setAuthSession((session) => session + 1)
    setAuthOpen(true)
  }

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    if (!open) setFeaturesOpen(false)
  }, [open])

  useEffect(() => {
    if (!featuresOpen || open) return
    const close = () => setFeaturesOpen(false)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [featuresOpen, open])

  const linkTone = dark ? 'text-white/85 hover:text-white' : 'text-neutral-800 hover:text-neutral-950'

  return (
    <>
      <header
        className={cn(
          'landing-header fixed left-0 right-0 top-0 z-50',
          (!transparentTop || scrolled || open) && 'is-scrolled',
          dark && 'is-dark',
        )}
      >
        <div className="mx-auto max-w-[1328px] px-5 sm:px-8">
          <div className="flex h-16 items-center justify-between sm:h-[76px]">
            <div
              className={cn(
                'flex min-w-0 items-center gap-6 transition-opacity duration-300 lg:gap-14',
                brandReady ? 'opacity-100' : 'opacity-0',
              )}
            >
              <Link href="/" className="flex min-w-0 items-center">
                <img
                  ref={bindLogo}
                  src="/assets/brand/logo.png"
                  alt="seltra"
                  onLoad={() => setBrandReady(true)}
                  onError={() => setBrandReady(true)}
                  className="h-[22px] w-auto shrink-0 object-contain sm:h-6"
                />
              </Link>

              <nav className="landing-menu hidden items-center gap-1 text-[15px] md:flex">
                <Link href="/#showcase" className={cn('nav-link', linkTone)}>Showcase</Link>
                <div className="relative">
                  <button
                    type="button"
                    className={cn('nav-link inline-flex items-center gap-1', linkTone)}
                    aria-expanded={featuresOpen}
                    aria-haspopup="true"
                    onClick={(e) => {
                      e.stopPropagation()
                      setFeaturesOpen((value) => !value)
                    }}
                  >
                    Features
                    <ChevronDown className={cn('h-3.5 w-3.5 transition-transform duration-200', featuresOpen && 'rotate-180')} />
                  </button>
                  {featuresOpen && (
                    <div className="landing-menu-glass absolute left-0 top-full z-20 mt-2 min-w-[12.5rem] overflow-hidden rounded-2xl p-1.5">
                      {featureLinks.map((item) => (
                        <Link
                          key={item.href}
                          href={item.href}
                          className="block rounded-xl px-3 py-2 text-[14px] text-neutral-700 transition-colors hover:bg-black/[0.04] hover:text-neutral-950"
                          onClick={() => setFeaturesOpen(false)}
                        >
                          {item.label}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
                <Link href="/careers" className={cn('nav-link', linkTone)}>Careers</Link>
              </nav>
            </div>

            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={openLogin}
                className={cn('btn hidden md:inline-flex', dark ? 'btn-glass-dark' : 'btn-secondary')}
              >
                Log in
              </button>
              <Link href="/apply" className="btn btn-primary">
                Try it for free
              </Link>
              <button
                type="button"
                className={cn(
                  'inline-flex h-10 w-10 items-center justify-center rounded-full transition-colors md:hidden',
                  dark ? 'text-white hover:bg-white/10' : 'text-neutral-800 hover:bg-black/5',
                )}
                onClick={() => setOpen((v) => !v)}
                aria-label="Toggle menu"
              >
                {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </button>
            </div>
          </div>
        </div>

        {open && (
          <div className="md:hidden">
            <nav
              className={cn(
                'landing-menu mx-auto flex max-w-6xl flex-col gap-0.5 px-3 pb-4 pt-1 text-[15px]',
                dark ? 'text-white/80' : 'text-neutral-700',
              )}
            >
              <Link
                href="/#showcase"
                className={cn('rounded-xl px-3 py-2.5', dark ? 'hover:bg-white/[0.06]' : 'hover:bg-black/[0.04]')}
                onClick={() => setOpen(false)}
              >
                Showcase
              </Link>

              <div>
                <button
                  type="button"
                  className={cn(
                    'flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left',
                    dark ? 'hover:bg-white/[0.06]' : 'hover:bg-black/[0.04]',
                  )}
                  aria-expanded={featuresOpen}
                  onClick={() => setFeaturesOpen((value) => !value)}
                >
                  Features
                  <ChevronDown className={cn('h-4 w-4 transition-transform duration-200', featuresOpen && 'rotate-180')} />
                </button>
                {featuresOpen && (
                  <div className={cn('mb-1 ml-2 flex flex-col gap-0.5 border-l pl-2', dark ? 'border-white/15' : 'border-black/10')}>
                    {featureLinks.map((item) => (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={cn(
                          'rounded-xl px-3 py-2 text-[14px]',
                          dark ? 'text-white/70 hover:bg-white/[0.06] hover:text-white' : 'text-neutral-600 hover:bg-black/[0.04] hover:text-neutral-950',
                        )}
                        onClick={() => {
                          setFeaturesOpen(false)
                          setOpen(false)
                        }}
                      >
                        {item.label}
                      </Link>
                    ))}
                  </div>
                )}
              </div>

              <Link
                href="/careers"
                className={cn('rounded-xl px-3 py-2.5', dark ? 'hover:bg-white/[0.06]' : 'hover:bg-black/[0.04]')}
                onClick={() => setOpen(false)}
              >
                Careers
              </Link>

              <div className="mt-2 grid grid-cols-2 gap-2 px-1">
                <button
                  type="button"
                  className={cn('btn', dark ? 'btn-glass-dark' : 'btn-secondary')}
                  onClick={() => {
                    setOpen(false)
                    openLogin()
                  }}
                >
                  Log in
                </button>
                <Link href="/apply" className="btn btn-primary" onClick={() => setOpen(false)}>
                  Try it for free
                </Link>
              </div>
            </nav>
          </div>
        )}
      </header>
      <AuthFlowModal key={authSession} open={authOpen} nextPath="/dashboard" onClose={() => setAuthOpen(false)} />
    </>
  )
}
