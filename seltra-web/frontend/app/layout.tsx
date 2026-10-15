//seltra-web/frontend/app/layout.tsx
import type { Metadata } from 'next'
import Script from 'next/script'
import { GeistSans } from 'geist/font/sans'
import { GeistMono } from 'geist/font/mono'
import { Fraunces, Poppins } from 'next/font/google'
import { ThemeProvider } from 'next-themes'
import { Toaster } from 'sonner'
import { StoreProvider } from '@/context/StoreContext'
import { SessionGuard } from '@/components/auth/SessionGuard'
import { ScrollReveal } from '@/components/marketing/ScrollReveal'
import { ScrollToTop } from '@/components/marketing/ScrollToTop'
import { defaultDescription, ogImage, siteName, siteUrl } from '@/lib/seo'
import './globals.css'

const menuFont = Poppins({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-menu',
})

const displayFont = Fraunces({
  variable: '--font-display',
  subsets: ['latin'],
  display: 'swap',
  weight: ['300', '400', '500', '600', '700', '800', '900'],
  style: ['normal', 'italic'],
})

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),

  title: {
    default: 'Seltra | AI Commerce Platform for Modern Businesses',
    template: '%s | Seltra',
  },

  description: defaultDescription,

  applicationName: 'Seltra',

  keywords: [
    'Seltra',
    'AI commerce',
    'AI ecommerce',
    'AI storefront',
    'AI online store',
    'AI business',
    'AI agents',
    'AI shopping',
    'commerce automation',
    'ecommerce automation',
    'online store builder',
    'AI website builder',
    'merchant platform',
    'AI startup',
    'digital commerce',
    'small business software',
    'Africa ecommerce',
    'Ghana ecommerce',
    'AI business platform',
    'AI merchant tools',
    'storefront builder',
  ],

  authors: [{ name: 'Seltra' }],
  creator: 'Seltra',
  publisher: 'Seltra',

  category: 'Technology',

  referrer: 'origin-when-cross-origin',

  robots: {
    index: true,
    follow: true,
    nocache: false,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },

  icons: {
    icon: [{ url: '/assets/brand/favicon.png', type: 'image/png' }],
    shortcut: '/assets/brand/favicon.png',
    apple: '/assets/brand/favicon.png',
  },

  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: siteUrl,
    siteName: 'Seltra',
    title: 'Seltra | AI Commerce Platform for Modern Businesses',
    description: defaultDescription,
    images: [
      {
        url: ogImage,
        width: 1200,
        height: 630,
        alt: 'Seltra — AI Commerce Platform',
      },
    ],
  },

  twitter: {
    card: 'summary_large_image',
    site: '@seltra_co',
    creator: '@seltra_co',
    title: 'Seltra | AI Commerce Platform for Modern Businesses',
    description: defaultDescription,
    images: [ogImage],
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${GeistSans.variable} ${GeistMono.variable} ${displayFont.variable} ${menuFont.variable}`}
    >
      <head>
        <link rel="preload" href="/assets/brand/logo.png" as="image" />
      </head>
      <body suppressHydrationWarning>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem={false}
          disableTransitionOnChange
          storageKey="seltra-theme"
        >
          <Script
            id="seltra-jsonld"
            type="application/ld+json"
            dangerouslySetInnerHTML={{
              __html: JSON.stringify({
                '@context': 'https://schema.org',
                '@graph': [
                  {
                    '@type': 'Organization',
                    '@id': `${siteUrl}/#organization`,
                    name: siteName,
                    url: siteUrl,
                    logo: `${siteUrl}/assets/brand/mark.png`,
                  },
                  {
                    '@type': 'WebSite',
                    '@id': `${siteUrl}/#website`,
                    name: siteName,
                    url: siteUrl,
                    description: defaultDescription,
                    publisher: { '@id': `${siteUrl}/#organization` },
                  },
                  {
                    '@type': 'SoftwareApplication',
                    name: siteName,
                    applicationCategory: 'BusinessApplication',
                    operatingSystem: 'Web',
                    url: siteUrl,
                    description: defaultDescription,
                    provider: { '@id': `${siteUrl}/#organization` },
                  },
                ],
              }),
            }}
          />

          <StoreProvider>
            <SessionGuard>{children}</SessionGuard>
            <ScrollReveal />
            <ScrollToTop />
          </StoreProvider>
          <Toaster
            position="bottom-left"
            toastOptions={{
              style: {
                background: 'hsl(var(--card))',
                border: '1px solid hsl(var(--border))',
                color: 'hsl(var(--foreground))',
              },
            }}
          />
        </ThemeProvider>
      </body>
    </html>
  )
}
