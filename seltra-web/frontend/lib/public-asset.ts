import fs from 'node:fs'
import path from 'node:path'

const PUBLIC_DIR = path.join(process.cwd(), 'public')
const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'webp', 'avif'] as const

function toUrl(file: string) {
  return `/${path.relative(PUBLIC_DIR, file).split(path.sep).join('/')}`
}

/** `seltra/features/payments.jpg` is also checked at `assets/features/payments.jpg`. */
function candidates(url: string) {
  const relative = url.replace(/^\/+/, '')
  const stripped = relative.replace(/^seltra\//, '')
  const files = stripped === relative ? [relative] : [`assets/${stripped}`, relative]
  return files.map((file) => path.join(PUBLIC_DIR, file))
}

/** Returns the public URL when the file exists under `public/`, preferring `public/assets`. */
export function publicAsset(url: string): string | null {
  for (const file of candidates(url)) {
    if (fs.existsSync(file)) return toUrl(file)
  }
  return null
}

/** Like `publicAsset`, but accepts a path without extension and tries common image formats. */
export function publicPhoto(base: string): string | null {
  for (const ext of IMAGE_EXT) {
    const url = publicAsset(`${base}.${ext}`)
    if (url) return url
  }
  return null
}

/** Lists image URLs inside a `public/` sub-folder, preferring the matching `assets/` folder. */
export function publicImages(folder: string): string[] {
  const relative = folder.replace(/^\/+|\/+$/g, '')
  const stripped = relative.replace(/^seltra\//, '')
  const dirs = stripped === relative
    ? [path.join(PUBLIC_DIR, relative)]
    : [path.join(PUBLIC_DIR, 'assets', stripped), path.join(PUBLIC_DIR, relative)]

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue
    const images = fs
      .readdirSync(dir)
      .filter((name) => /\.(png|jpe?g|webp|avif)$/i.test(name))
      .sort()
      .map((name) => toUrl(path.join(dir, name)))
    if (images.length) return images
  }
  return []
}
