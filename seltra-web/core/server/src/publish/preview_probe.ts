import type { WorkspaceRuntime } from "../workspace_supervisor.js";

type PreviewProbeRuntime = Pick<
  WorkspaceRuntime,
  "baseUrl" | "rpcSecret" | "workspaceKey" | "signGatewayRequest"
>;

export async function probeWorkspacePreviewStatus(
  runtime: PreviewProbeRuntime,
  appId: number,
  fetcher: typeof fetch = fetch,
): Promise<number> {
  if (!Number.isSafeInteger(appId) || appId < 1) {
    throw new Error("A valid app ID is required for a preview probe.");
  }

  if (runtime.signGatewayRequest) {
    const route = `/v1/workspaces/${runtime.workspaceKey}/preview/${appId}/`;
    const gatewayBase = runtime.baseUrl.replace(/\/runtime$/, "");
    const response = await fetcher(new URL(route, gatewayBase), {
      headers: {
        ...runtime.signGatewayRequest("GET", route),
        accept: "text/html",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(5_000),
    });
    await response.body?.cancel().catch(() => undefined);
    return response.status;
  }

  const targetResponse = await fetcher(
    new URL(`/internal/preview-target/${appId}`, runtime.baseUrl),
    {
      headers: { authorization: `Bearer ${runtime.rpcSecret}` },
      signal: AbortSignal.timeout(3_000),
    },
  );
  const target = targetResponse.ok
    ? (await targetResponse.json()) as {
        appId?: number;
        host?: string;
        port?: number;
        previewHost?: string;
      }
    : null;
  if (
    target?.appId !== appId ||
    target.host !== "127.0.0.1" ||
    !Number.isInteger(target.port) ||
    target.port! < 1024 ||
    target.port! > 65535 ||
    (target.previewHost !== "localhost" &&
      target.previewHost !== `app-${appId}.localhost`)
  ) {
    await targetResponse.body?.cancel().catch(() => undefined);
    return 0;
  }

  await targetResponse.body?.cancel().catch(() => undefined);
  const response = await fetcher(`http://127.0.0.1:${target.port}/`, {
    headers: {
      host: `${target.previewHost}:${target.port}`,
      accept: "text/html",
    },
    redirect: "manual",
    signal: AbortSignal.timeout(5_000),
  });
  await response.body?.cancel().catch(() => undefined);
  return response.status;
}
