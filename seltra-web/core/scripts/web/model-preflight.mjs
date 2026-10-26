const MODEL_SEARCH_URL = "https://api.cloudflare.com/client/v4/accounts/";

export async function checkCloudflareModel({
  accountId,
  apiKey,
  model,
  fetchImpl = fetch,
}) {
  if (!accountId || !apiKey) {
    throw new Error(
      "Cloudflare model preflight requires MODEL_ACCOUNT_ID and MODEL_API_KEY.",
    );
  }
  const response = await fetchImpl(
    `${MODEL_SEARCH_URL}${encodeURIComponent(accountId)}/ai/models/search?task=${encodeURIComponent("Text Generation")}&per_page=100`,
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    },
  );
  if (!response.ok) {
    throw new Error(
      `Cloudflare model catalog check failed with HTTP ${response.status}; verify MODEL_API_KEY and MODEL_ACCOUNT_ID.`,
    );
  }
  const payload = await response.json();
  const rows = Array.isArray(payload?.result) ? payload.result : [];
  const slugs = rows
    .filter((row) => {
      const task = typeof row?.task === "string" ? row.task : row?.task?.name;
      return task?.toLowerCase().replaceAll("-", " ") === "text generation";
    })
    .map((row) => row?.name ?? row?.id)
    .filter((slug) => typeof slug === "string" && slug.length > 0);
  if (!slugs.includes(model)) {
    const examples = [...new Set(slugs)].slice(0, 5);
    throw new Error(
      `Unknown Cloudflare text-generation model slug: ${model}. Available streaming text-generation slugs: ${examples.join(", ") || "none returned"}.`,
    );
  }
  return slugs;
}
