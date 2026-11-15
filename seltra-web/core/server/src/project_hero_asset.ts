import { R2ObjectStore } from "./publish/r2.js";

const MIN_HERO_IMAGE_BYTES = 20 * 1024;
const MAX_HERO_IMAGE_BYTES = 14 * 1024 * 1024;

export function decodeProjectHeroWebp(base64: string): Buffer {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    throw new Error("Project hero image must be valid base64.");
  }
  const bytes = Buffer.from(base64, "base64");
  if (
    bytes.length <= MIN_HERO_IMAGE_BYTES ||
    bytes.length > MAX_HERO_IMAGE_BYTES ||
    bytes.toString("ascii", 0, 4) !== "RIFF" ||
    bytes.toString("ascii", 8, 12) !== "WEBP"
  ) {
    throw new Error("Project hero image must be a nonblank WebP between 20 KB and 14 MB.");
  }
  return bytes;
}

export async function uploadProjectHero(
  store: Pick<R2ObjectStore, "put">,
  bucket: string,
  projectId: string,
  base64: string,
): Promise<{ key: string; size: number }> {
  if (!bucket.trim() || !/^[A-Za-z0-9_-]{1,128}$/.test(projectId)) {
    throw new Error("Project hero storage identity is invalid.");
  }
  const bytes = decodeProjectHeroWebp(base64);
  const key = `projects/${projectId}/hero.webp`;
  await store.put(bucket, key, bytes, "image/webp");
  return { key, size: bytes.length };
}

export function projectHeroPublicUrl(
  corePublicUrl: string,
  projectId: string,
  version: string,
): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(projectId) || !/^\d+$/.test(version)) {
    throw new Error("Project hero URL identity is invalid.");
  }
  const url = new URL(corePublicUrl);
  url.pathname = `/v1/projects/${encodeURIComponent(projectId)}/hero.webp`;
  url.search = `?v=${version}`;
  url.hash = "";
  return url.toString();
}
