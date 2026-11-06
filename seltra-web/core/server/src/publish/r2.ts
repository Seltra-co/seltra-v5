import { createHash, createHmac } from "node:crypto";

export type R2Config = { endpoint: string; accountId: string; accessKeyId: string; secretAccessKey: string };
export type R2Object = { key: string; size: number; lastModified: string };

export class R2ObjectStore {
  private readonly endpoint: URL;
  constructor(private readonly config: R2Config, private readonly fetcher: typeof fetch = fetch) {
    this.endpoint = new URL(config.endpoint);
    if (this.endpoint.pathname !== "/" || this.endpoint.search || this.endpoint.hash) throw new Error("R2 endpoint must be normalized to scheme and host.");
  }

  async put(bucket: string, key: string, data: Buffer, contentType = "application/octet-stream"): Promise<void> {
    const response = await this.request("PUT", bucket, key, data, { "content-type": contentType });
    if (!response.ok) throw r2Error("R2_UPLOAD_FAILED", response.status);
  }

  async get(bucket: string, key: string): Promise<Buffer> {
    const response = await this.request("GET", bucket, key);
    if (!response.ok) throw r2Error(response.status === 404 ? "R2_OBJECT_NOT_FOUND" : "R2_DOWNLOAD_FAILED", response.status);
    return Buffer.from(await response.arrayBuffer());
  }

  async delete(bucket: string, key: string): Promise<void> {
    const response = await this.request("DELETE", bucket, key);
    if (!response.ok && response.status !== 404) throw r2Error("R2_DELETE_FAILED", response.status);
  }

  async list(bucket: string, prefix: string): Promise<R2Object[]> {
    const rows: R2Object[] = [];
    let continuationToken: string | undefined;
    do {
      const query: Record<string, string> = { "list-type": "2", prefix };
      if (continuationToken) query["continuation-token"] = continuationToken;
      const response = await this.request("GET", bucket, "", undefined, {}, query);
      if (!response.ok) throw r2Error("R2_LIST_FAILED", response.status);
      const xml = await response.text();
      for (const match of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
        const block = match[1];
        const key = xmlUnescape(block.match(/<Key>([\s\S]*?)<\/Key>/)?.[1] ?? "");
        const size = Number(block.match(/<Size>(\d+)<\/Size>/)?.[1] ?? 0);
        const lastModified = block.match(/<LastModified>([\s\S]*?)<\/LastModified>/)?.[1] ?? "";
        if (key) rows.push({ key, size, lastModified });
      }
      continuationToken = xmlUnescape(xml.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/)?.[1] ?? "") || undefined;
    } while (continuationToken);
    return rows;
  }

  private async request(method: string, bucket: string, key: string, body: Uint8Array = new Uint8Array(), extra: Record<string, string> = {}, query: Record<string, string> = {}): Promise<Response> {
    const date = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
    const dateStamp = date.slice(0, 8);
    const payloadHash = createHash("sha256").update(body).digest("hex");
    const uri = `/${awsEncode(bucket)}${key ? `/${key.split("/").map(awsEncode).join("/")}` : ""}`;
    const queryString = Object.entries(query).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${awsEncode(k)}=${awsEncode(v)}`).join("&");
    const headers: Record<string, string> = {
      host: this.endpoint.host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": date,
      ...extra,
    };
    const signedHeaders = Object.keys(headers).map((name) => name.toLowerCase()).sort();
    const canonicalHeaders = signedHeaders.map((name) => `${name}:${headers[name].trim().replace(/\s+/g, " ")}\n`).join("");
    const credentialScope = `${dateStamp}/auto/s3/aws4_request`;
    const canonicalRequest = [method, uri, queryString, canonicalHeaders, signedHeaders.join(";"), payloadHash].join("\n");
    const stringToSign = ["AWS4-HMAC-SHA256", date, credentialScope, sha256(canonicalRequest)].join("\n");
    const signingKey = deriveSigningKey(this.config.secretAccessKey, dateStamp);
    const signature = hmac(signingKey, stringToSign, "hex");
    headers.authorization = `AWS4-HMAC-SHA256 Credential=${this.config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders.join(";")}, Signature=${signature}`;
    return this.fetcher(`${this.endpoint.origin}${uri}${queryString ? `?${queryString}` : ""}`, { method, headers, ...(method === "GET" || method === "HEAD" || method === "DELETE" ? {} : { body: new Blob([Uint8Array.from(body)]) }) });
  }
}

function deriveSigningKey(secret: string, date: string): Buffer {
  const dateKey = Buffer.from(hmac(`AWS4${secret}`, date));
  const regionKey = Buffer.from(hmac(dateKey, "auto"));
  const serviceKey = Buffer.from(hmac(regionKey, "s3"));
  return Buffer.from(hmac(serviceKey, "aws4_request"));
}
function hmac(key: string | Uint8Array, value: string, encoding?: "hex"): Buffer | string { const out = createHmac("sha256", key).update(value).digest(); return encoding ? out.toString(encoding) : out; }
function sha256(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function awsEncode(value: string): string { return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`); }
function xmlUnescape(value: string): string { return value.replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&apos;", "'"); }
function r2Error(code: string, status: number): Error & { code: string } { return Object.assign(new Error(`R2 request failed with status ${status}.`), { code }); }
