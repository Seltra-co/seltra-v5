//seltra-web/frontend/components/storefront/sections/utils.ts
export function isValidImageUrl(url?: string | null) {
  if (!url) return false

  return (
    url.startsWith('http://') ||
    url.startsWith('https://') ||
    url.startsWith('data:image')
  )
}
