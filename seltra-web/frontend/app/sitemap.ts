import type { MetadataRoute } from 'next'
import { JOBS } from '@/lib/jobs'
import { siteUrl } from '@/lib/seo'

const staticRoutes: Array<{ path: string; changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency']; priority: number }> = [
  { path: '/', changeFrequency: 'weekly', priority: 1 },
  { path: '/features', changeFrequency: 'monthly', priority: 0.8 },
  { path: '/careers', changeFrequency: 'weekly', priority: 0.7 },
  { path: '/apply', changeFrequency: 'monthly', priority: 0.8 },
  { path: '/privacy', changeFrequency: 'yearly', priority: 0.3 },
  { path: '/terms', changeFrequency: 'yearly', priority: 0.3 },
]

export default function sitemap(): MetadataRoute.Sitemap {
  const pages = staticRoutes.map((route) => ({
    url: route.path === '/' ? siteUrl : `${siteUrl}${route.path}`,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }))

  const jobs = JOBS.filter((job) => job.status === 'open').map((job) => ({
    url: `${siteUrl}/careers/${job.slug}`,
    changeFrequency: 'weekly' as const,
    priority: 0.6,
  }))

  return [...pages, ...jobs]
}
