import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'images.unsplash.com' },
      { protocol: 'https', hostname: '*.unsplash.com' },
      { protocol: 'https', hostname: 'res.cloudinary.com' },
      { protocol: 'https', hostname: 'storage.googleapis.com' },
      { protocol: 'https', hostname: 'fal.media' },
      { protocol: 'https', hostname: '*.fal.media' },
      { protocol: 'https', hostname: 'lh3.googleusercontent.com' },
      { protocol: 'https', hostname: 'api.dicebear.com' },
      { protocol: 'https', hostname: 'images.pexels.com' },
      { protocol: 'https', hostname: 'pixabay.com' },
      { protocol: 'https', hostname: 'cdn.pixabay.com' },
      { protocol: 'https', hostname: 'example.com' }, 
    ],
    dangerouslyAllowSVG: true,
  },
  env: {
    NEXT_PUBLIC_ROOT_DOMAIN: process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? 'seltra.co',
  },
  async redirects() {
    return [{ source: '/store', destination: '/dashboard', permanent: false }]
  },
  // Same-origin proxy so the browser never hits cross-origin CORS for auth/API calls
  // (fixes “couldn't reach Seltra” from LAN Network URLs and some preview hosts).
  async rewrites() {
    const api =
      process.env.API_PROXY_TARGET?.replace(/\/$/, '') ||
      process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, '') ||
      'https://seltra-merchant-backend.onrender.com'
    return [
      {
        source: '/api/v1/:path*',
        destination: `${api}/api/v1/:path*`,
      },
    ]
  },
}

export default nextConfig