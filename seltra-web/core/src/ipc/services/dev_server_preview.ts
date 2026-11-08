import { stripVTControlCharacters } from "node:util";
import type { Readable } from "node:stream";

const DEV_URL_PATTERN = /https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]|::1):\d+(?:\/[^\s]*)?/g;
const MAX_DETECTION_BUFFER = 16 * 1024;

export class DevServerUrlScanner {
  private rawBuffer = "";
  private readonly reported = new Set<string>();

  push(chunk: string): string[] {
    this.rawBuffer = (this.rawBuffer + chunk).slice(
      -MAX_DETECTION_BUFFER,
    );
    const buffer = stripVTControlCharacters(this.rawBuffer);
    const urls = [...buffer.matchAll(DEV_URL_PATTERN)].map((match) =>
      match[0].replace(/[),.;]+$/, ""),
    );
    const fresh = urls.filter((url) => !this.reported.has(url));
    for (const url of fresh) this.reported.add(url);
    return fresh;
  }
}

/** Node Readable streams retain output written before a data listener is attached. */
export function listenForDevServerUrls(
  stream: Readable,
  scanner: DevServerUrlScanner,
  onUrl: (url: string) => void,
): void {
  listenForDevServerOutput(stream, (chunk) => {
    for (const url of scanner.push(String(chunk))) onUrl(url);
  });
}

export function listenForDevServerOutput(
  stream: Readable,
  onChunk: (chunk: string) => void | Promise<void>,
): void {
  // Child stdout can already contain the Vite ready line before this listener is attached.
  const buffered = stream.read();
  if (buffered !== null) void onChunk(String(buffered));
  stream.on("data", (chunk: Buffer | string) => {
    void onChunk(String(chunk));
  });
}

export type LoopbackProbe = {
  host: "127.0.0.1" | "::1";
  status?: number;
  errorClass?: string;
};

export type DevServerProbeResult = {
  targetUrl?: string;
  host?: LoopbackProbe["host"];
  status?: number;
  attempts: LoopbackProbe[];
  reason?: "non_loopback_dev_url" | "loopback_probe_failed";
};

export type ProbeRetryOptions = {
  attempts?: number;
  delayMs?: number;
  timeoutMs?: number;
};

export function expectedPortDevServerUrl(expectedPort: number): string | null {
  if (!Number.isInteger(expectedPort) || expectedPort < 1 || expectedPort > 65535) return null;
  return `http://localhost:${expectedPort}/`;
}

export async function probeExpectedDevServerPort(
  expectedPort: number,
  request: typeof fetch = fetch,
  options: ProbeRetryOptions = {},
): Promise<DevServerProbeResult> {
  const url = expectedPortDevServerUrl(expectedPort);
  if (!url) return { attempts: [], reason: "loopback_probe_failed" };
  return probeDevServerUntilReady(url, request, options);
}

export async function probeDevServerUntilReady(
  detectedUrl: string,
  request: typeof fetch = fetch,
  { attempts: maxAttempts = 8, delayMs = 300, timeoutMs = 2_500 }: ProbeRetryOptions = {},
): Promise<DevServerProbeResult> {
  let lastResult: DevServerProbeResult = { attempts: [], reason: "loopback_probe_failed" };
  const allAttempts: LoopbackProbe[] = [];
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    lastResult = await probeDevServer(detectedUrl, request, timeoutMs);
    allAttempts.push(...lastResult.attempts);
    if (lastResult.targetUrl || attempt + 1 === maxAttempts) return { ...lastResult, attempts: allAttempts };
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return lastResult;
}

export async function probeDevServer(
  detectedUrl: string,
  request: typeof fetch = fetch,
  timeoutMs = 1_000,
): Promise<DevServerProbeResult> {
  const original = new URL(detectedUrl);
  if (
    !["localhost", "127.0.0.1", "[::1]", "::1"].includes(original.hostname)
  ) {
    return { attempts: [], reason: "non_loopback_dev_url" };
  }

  const attempts = await Promise.all(
    (["127.0.0.1", "::1"] as const).map(async (host): Promise<LoopbackProbe> => {
      const target = new URL(original);
      target.hostname = host === "::1" ? "[::1]" : host;
      try {
        const response = await request(target, {
          method: "GET",
          signal: AbortSignal.timeout(timeoutMs),
        });
        await response.body?.cancel().catch(() => undefined);
        return { host, status: response.status };
      } catch (error) {
        return {
          host,
          errorClass: error instanceof Error ? error.name : "UnknownError",
        };
      }
    }),
  );
  const selected = attempts.find((attempt) => attempt.status === 200) ??
    attempts.find((attempt) => attempt.status !== undefined && attempt.status < 500);
  if (!selected?.status) {
    return { attempts, reason: "loopback_probe_failed" };
  }
  const target = new URL(original);
  target.hostname = selected.host === "::1" ? "[::1]" : selected.host;
  return {
    targetUrl: target.toString(),
    host: selected.host,
    status: selected.status,
    attempts,
  };
}
