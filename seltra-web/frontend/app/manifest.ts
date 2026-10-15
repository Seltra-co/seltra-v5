import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Seltra',
    short_name: 'Seltra',
    description: 'Commerce that runs itself.',
    start_url: '/',
    display: 'standalone',
    background_color: '#0B0B0C',
    theme_color: '#16A34A',
    icons: [
      {
        src: '/assets/brand/favicon.png',
        sizes: '256x256',
        type: 'image/png',
      },
    ],
  }
}