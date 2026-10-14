import fs from 'node:fs'
import path from 'node:path'

const PUBLIC_DIR = path.join(process.cwd(), 'public')

/** Returns the public URL when the file exists under `public/`, otherwise null. */
export function publicAsset(url: string): string | null {
  return fs.existsSync(path.join(PUBLIC_DIR, url)) ? url : null
}

/** Like `publicAsset`, but accepts a path without extension and tries common image formats. */
export function publicPhoto(base: string): string | null {
  for (const ext of ['jpg', 'jpeg', 'png', 'webp', 'avif']) {
    const url = publicAsset(`${base}.${ext}`)
    if (url) return url
  }
  return null
}

/** Lists image URLs inside a `public/` sub-folder, sorted by file name. */
export function publicImages(folder: string): string[] {
  const dir = path.join(PUBLIC_DIR, folder)
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((name) => /\.(png|jpe?g|webp|avif)$/i.test(name))
    .sort()
    .map((name) => `/${folder.replace(/^\/+|\/+$/g, '')}/${name}`)
}
