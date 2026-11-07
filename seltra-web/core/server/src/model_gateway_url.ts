/** Build the stable Seltra Engine URL used by remote workspaces. */
export function seltraEngineModelBaseUrl(publicApiUrl: string): string {
  const apiUrl = new URL(publicApiUrl);
  apiUrl.pathname = apiUrl.pathname
    .replace(/\/(?:api\/v1|api\/v5)\/?$/i, "")
    .replace(/\/+$/, "") + "/v1";
  apiUrl.search = "";
  apiUrl.hash = "";
  return apiUrl.toString().replace(/\/$/, "");
}
