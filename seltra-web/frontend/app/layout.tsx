//seltra-web/frontend/app/layout.tsx
import type { Metadata } from 'next'
import Script from 'next/script'
import { GeistSans } from 'geist/font/sans'
import { GeistMono } from 'geist/font/mono'
import { Fraunces } from 'next/font/google'
import { ThemeProvider } from 'next-themes'
import { Toaster } from 'sonner'
import { StoreProvider } from '@/context/StoreContext'
import { SessionGuard } from '@/components/auth/SessionGuard'
import './globals.css'

const displayFont = Fraunces({
  variable: '--font-display',
  subsets: ['latin'],
  display: 'swap',
  weight: ['300', '400', '500', '600', '700', '800', '900'],
  style: ['normal', 'italic'],
})

const siteUrl = 'https://www.seltra.co'
const siteImage ='https://res.cloudinary.com/dfmsaarli/image/upload/favicon-48x48_rtftsi.png'
const siteImageGraph = 'https://www.seltra.co/og-image.png'

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),

  title: {
    default: 'Seltra | AI Commerce Platform for Modern Businesses',
    template: '%s | Seltra',
  },

  description:
    'Launch an AI-powered online business in minutes. Seltra deploys autonomous AI agents to manage your storefront, inventory, payments, customer support, marketing, and fulfillment—all from a single platform.',

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

  alternates: {
    canonical: siteUrl,
  },

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
    icon: [
      { url: siteImage, type: 'image/png' },
    ],
    shortcut: siteImage,
    apple: siteImage,
  },

  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: siteUrl,
    siteName: 'Seltra',
    title: 'Seltra — AI Commerce Platform',
    description:
      'Autonomous AI agents that launch and operate your online business—from storefront creation to payments, fulfillment, customer support, and growth.',

    images: [
      {
        url: siteImageGraph,
        width: 1200,
        height: 630,
        alt: "Seltra — AI Commerce Platform",
      },
    ],
  },

  twitter: {
    card: 'summary_large_image',
    site: '@seltra_co',
    creator: '@seltra_co',
    title: 'Seltra — AI Commerce Platform',
    description:
      'Launch an AI-powered business in minutes with autonomous AI agents.',

    images: [siteImage],
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${GeistSans.variable} ${GeistMono.variable} ${displayFont.variable}`}
    >
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
      '@type': 'SoftwareApplication',
      name: 'Seltra',
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web',
      url: 'https://www.seltra.co',
      logo: siteImage,
      image: siteImage,
      description:
        'AI-native commerce platform that launches and operates online businesses using autonomous AI agents.',
      creator: {
        '@type': 'Organization',
        name: 'Seltra',
      },
    }),
  }}
/>

          <StoreProvider>
            <SessionGuard>{children}</SessionGuard>
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
