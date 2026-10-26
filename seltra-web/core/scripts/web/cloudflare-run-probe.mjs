const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4/accounts/";

export function cloudflareRunProbeRequest(accountId, slug) {
  return {
    url: `${CLOUDFLARE_API}${encodeURIComponent(accountId)}/ai/run/${slug}`,
    body: {
      messages: [{ role: "user", content: "Reply with ok." }],
      stream: true,
      max_tokens: 8,
    },
  };
}
