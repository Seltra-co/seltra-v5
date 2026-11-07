export interface PrimaryGatewayHostConfig {
  GATEWAY_HOST: string;
  GATEWAY_PUBLIC_HOSTS: string;
  PREVIEW_BASE_DOMAIN: string;
  CORE_PUBLIC_URL?: string;
}

export function isPrimaryGatewayHost(
  hostHeader: string | undefined,
  config: PrimaryGatewayHostConfig,
): boolean {
  const requestHost = (hostHeader ?? "").split(":")[0].toLowerCase();
  if (requestHost === config.GATEWAY_HOST.toLowerCase()) return true;
  if (
    requestHost === "127.0.0.1" ||
    requestHost === "localhost" ||
    requestHost === "[::1]"
  ) return true;
  if (requestHost === config.PREVIEW_BASE_DOMAIN.toLowerCase()) return true;

  let configuredCoreHost = "";
  try {
    configuredCoreHost = config.CORE_PUBLIC_URL
      ? new URL(config.CORE_PUBLIC_URL).hostname.toLowerCase()
      : "";
  } catch {
    // Invalid optional public URLs are rejected by configuration validation.
  }
  if (requestHost && requestHost === configuredCoreHost) return true;

  return config.GATEWAY_PUBLIC_HOSTS.split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean)
    .includes(requestHost);
}
