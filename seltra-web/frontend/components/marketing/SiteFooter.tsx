import Link from 'next/link'
import { Instagram, Linkedin } from 'lucide-react'
import { SiX } from '@icons-pack/react-simple-icons'
import { Aurora } from '@/components/marketing/Aurora'
import { SlashDivider } from '@/components/marketing/SlashDivider'

const socials = [
  { href: 'https://x.com/seltra_co', label: 'X', icon: <SiX size={15} /> },
  { href: 'https://www.linkedin.com/company/seltra-inc/', label: 'LinkedIn', icon: <Linkedin className="h-[17px] w-[17px]" /> },
  { href: 'https://www.instagram.com/seltra.co/', label: 'Instagram', icon: <Instagram className="h-[17px] w-[17px]" /> },
]

const footerLinks = [
  { href: '/#showcase', label: 'Showcase' },
  { href: '/features', label: 'Features' },
  { href: '/careers', label: 'Careers' },
  { href: '/terms', label: 'Terms of Service' },
  { href: '/privacy', label: 'Privacy Policy' },
]

export function SiteFooter() {
  return (
    <footer className="relative px-5 pb-8 sm:px-8">
      <div className="site-footer-panel mx-auto max-w-[1264px] rounded-[2rem] px-6 py-12 text-center text-white sm:px-10 sm:py-14">
        <Aurora tone="dark" />
        <div className="relative z-10">
          <Link href="/" className="inline-flex items-center justify-center">
            <img src="/assets/brand/logo.png" alt="seltra" className="h-7 w-auto sm:h-8" />
          </Link>

          <nav className="landing-menu mt-8 flex flex-wrap items-center justify-center gap-x-7 gap-y-3 text-[14px] text-white/75 sm:gap-x-10">
            {footerLinks.map((item) => (
              <Link key={item.href} href={item.href} className="transition-colors hover:text-white">
                {item.label}
              </Link>
            ))}
          </nav>

          <SlashDivider className="mt-8" />

          <div className="mt-7 flex items-center justify-center gap-2 text-white/85">
            {socials.map(({ href, label, icon }) => (
              <a
                key={label}
                href={href}
                target="_blank"
                rel="noreferrer"
                aria-label={label}
                className="flex h-9 w-9 items-center justify-center rounded-full transition-colors hover:bg-white/[0.08] hover:text-[#4ade80]"
              >
                {icon}
              </a>
            ))}
          </div>

          <p className="landing-menu mt-5 text-[12px] text-white/60">© Copyright 2026, All Rights Reserved</p>
        </div>
      </div>
    </footer>
  )
}
