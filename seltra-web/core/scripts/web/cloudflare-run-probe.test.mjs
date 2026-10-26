import assert from "node:assert/strict";
import test from "node:test";
import { cloudflareRunProbeRequest } from "./cloudflare-run-probe.mjs";

test("Cloudflare run probe uses the model path and chat input schema", () => {
  const request = cloudflareRunProbeRequest(
    "account/id",
    "@cf/openai/gpt-oss-120b",
  );

  assert.equal(
    request.url,
    "https://api.cloudflare.com/client/v4/accounts/account%2Fid/ai/run/@cf/openai/gpt-oss-120b",
  );
  assert.deepEqual(request.body, {
    messages: [{ role: "user", content: "Reply with ok." }],
    stream: true,
    max_tokens: 8,
  });
});
