import { gzipSync, gunzipSync } from "node:zlib";
import path from "node:path";

export type ArchiveFile = { path: string; data: Buffer };

export function createArchive(files: ArchiveFile[]): Buffer {
  const blocks: Buffer[] = [];
  let totalBytes = 0;
  for (const file of files) {
    totalBytes += file.data.length;
    if (totalBytes > 500 * 1024 * 1024) throw new Error("Workspace snapshot exceeds the supported bundle size.");
    const relative = safeArchivePath(file.path);
    if (Buffer.byteLength(relative) > 100) throw new Error("Snapshot path exceeds the supported archive path length.");
    const header = Buffer.alloc(512);
    writeString(header, 0, 100, relative);
    writeOctal(header, 100, 8, 0o600);
    writeOctal(header, 108, 8, 0);
    writeOctal(header, 116, 8, 0);
    writeOctal(header, 124, 12, file.data.length);
    writeOctal(header, 136, 12, 0);
    header.fill(0x20, 148, 156);
    header[156] = "0".charCodeAt(0);
    writeString(header, 257, 6, "ustar\0");
    writeString(header, 263, 2, "00");
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    writeOctal(header, 148, 8, checksum);
    blocks.push(header, file.data);
    const padding = (512 - (file.data.length % 512)) % 512;
    if (padding) blocks.push(Buffer.alloc(padding));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks), { level: 6 });
}

export function extractArchive(gzip: Buffer, maxTotalBytes = 500 * 1024 * 1024): ArchiveFile[] {
  const tar = gunzipSync(gzip, { maxOutputLength: maxTotalBytes });
  const files: ArchiveFile[] = [];
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = readString(header, 0, 100);
    const prefix = readString(header, 345, 155);
    const archivePath = safeArchivePath(prefix ? `${prefix}/${name}` : name);
    const type = String.fromCharCode(header[156]);
    const size = Number.parseInt(readString(header, 124, 12).replace(/\0.*$/, "").trim() || "0", 8);
    if (!Number.isSafeInteger(size) || size < 0 || size > 25 * 1024 * 1024) throw new Error("Snapshot archive contains an invalid file size.");
    offset += 512;
    if (type === "0" || type === "\0") {
      if (offset + size > tar.length) throw new Error("Snapshot archive is truncated.");
      files.push({ path: archivePath, data: Buffer.from(tar.subarray(offset, offset + size)) });
    } else if (type !== "5") {
      throw new Error("Snapshot archive contains an unsupported entry type.");
    }
    offset += Math.ceil(size / 512) * 512;
  }
  return files;
}

function safeArchivePath(value: string): string {
  const normalized = value.replaceAll("\\", "/");
  const posix = path.posix.normalize(normalized);
  if (!posix || posix === "." || posix === ".." || posix.startsWith("../") || posix.startsWith("/") || /^[A-Za-z]:/.test(posix)) throw new Error("Snapshot path is invalid.");
  return posix;
}
function writeString(buffer: Buffer, offset: number, length: number, value: string): void { buffer.write(value, offset, Math.min(length, Buffer.byteLength(value)), "utf8"); }
function writeOctal(buffer: Buffer, offset: number, length: number, value: number): void { buffer.write(`${Math.max(0, value).toString(8).padStart(length - 1, "0")}\0`, offset, length, "ascii"); }
function readString(buffer: Buffer, offset: number, length: number): string { return buffer.subarray(offset, offset + length).toString("utf8").replace(/\0.*$/, "").trim(); }
