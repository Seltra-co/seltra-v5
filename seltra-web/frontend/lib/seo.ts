import type { Metadata } from 'next'

export const siteUrl = 'https://www.seltra.co'
export const siteName = 'Seltra'
export const ogImage = '/seltra/og-image.png'

const description =
  'Launch an AI-powered online business in minutes. Seltra deploys autonomous AI agents to manage your storefront, inventory, payments, customer support, marketing, and fulfillment.'

export const defaultDescription = description

type PageMetaInput = {
  title: string
  description: string
  path: string
  index?: boolean
  absoluteTitle?: boolean
}

export function pageMeta({
  title,
  description: pageDescription,
  path,
  index = true,
  absoluteTitle = false,
}: PageMetaInput): Metadata {
  const url = path === '/' ? siteUrl : `${siteUrl}${path}`
  return {
    title: absoluteTitle ? { absolute: title } : title,
    description: pageDescription,
    alternates: { canonical: path },
    robots: index
      ? { index: true, follow: true }
      : { index: false, follow: false, nocache: true },
    openGraph: {
      type: 'website',
      locale: 'en_US',
      url,
      siteName,
      title,
      description: pageDescription,
      images: [{ url: ogImage, width: 1200, height: 630, alt: title }],
    },
    twitter: {
      card: 'summary_large_image',
      site: '@seltra_co',
      creator: '@seltra_co',
      title,
      description: pageDescription,
      images: [ogImage],
    },
  }
}

export const noIndex: Metadata = {
  robots: { index: false, follow: false, nocache: true },
}
