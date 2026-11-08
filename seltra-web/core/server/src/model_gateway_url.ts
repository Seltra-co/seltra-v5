/** Build the Core /v1 model URL used by isolated Cloudflare workspaces. */
export function seltraEngineModelBaseUrl(corePublicUrl: string): string {
  const coreUrl = new URL(corePublicUrl);
  const path = coreUrl.pathname.replace(/\/+$/, "").replace(/\/v1$/i, "");
  coreUrl.pathname = path + "/v1";
  coreUrl.search = "";
  coreUrl.hash = "";
  return coreUrl.toString().replace(/\/$/, "");
}
