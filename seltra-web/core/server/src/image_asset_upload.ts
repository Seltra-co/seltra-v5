import { R2ObjectStore } from "./publish/r2.js";

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

const imageFormat = (bytes: Buffer): { extension: "png" | "jpg" | "webp"; mimeType: string } | undefined => {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { extension: "png", mimeType: "image/png" };
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { extension: "jpg", mimeType: "image/jpeg" };
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return { extension: "webp", mimeType: "image/webp" };
  return undefined;
};

export async function uploadGeneratedImage(
  store: Pick<R2ObjectStore, "put">,
  bucket: string,
  workspaceId: string,
  appId: number,
  slot: string,
  bytes: Buffer,
  mimeType: string,
): Promise<{ key: string; size: number }> {
  if (!bucket.trim() || !/^[a-f0-9-]{16,128}$/i.test(workspaceId) || !Number.isSafeInteger(appId) || appId < 1 || !/^[a-z0-9][a-z0-9-]{0,63}$/i.test(slot)) {
    throw new Error("Generated image storage identity is invalid.");
  }
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error("Generated image exceeds the supported size.");
  const format = imageFormat(bytes);
  if (!format || mimeType !== format.mimeType) throw new Error("Generated image format does not match its raster bytes.");
  const key = `projects/${workspaceId}/apps/${appId}/assets/${slot}.${format.extension}`;
  await store.put(bucket, key, bytes, format.mimeType);
  return { key, size: bytes.length };
}
