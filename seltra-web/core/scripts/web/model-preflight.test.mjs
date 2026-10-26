import test from "node:test";
import assert from "node:assert/strict";
import { checkCloudflareModel } from "./model-preflight.mjs";

test("Cloudflare model preflight accepts Cloudflare's object task shape", async () => {
  let calledUrl = "";
  const slugs = [
    "@cf/model-1",
    "@cf/model-2",
    "@cf/model-3",
    "@cf/model-4",
    "@cf/model-5",
    "@cf/model-6",
  ];
  await checkCloudflareModel({
    accountId: "account",
    apiKey: "secret",
    model: slugs[0],
    fetchImpl: async (url, options) => {
      calledUrl = String(url);
      assert.equal(options.headers.Authorization, "Bearer secret");
      return new Response(
        JSON.stringify({
          result: slugs.map((name) => ({
            name,
            task: { name: "Text Generation" },
          })),
        }),
      );
    },
  });
  assert.match(calledUrl, /task=Text%20Generation/);
  assert.match(calledUrl, /per_page=100/);
});

test("Cloudflare model preflight reports unknown slug and five available models", async () => {
  const slugs = ["one", "two", "three", "four", "five", "six"];
  await assert.rejects(
    checkCloudflareModel({
      accountId: "account",
      apiKey: "secret",
      model: "missing",
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            result: slugs.map((name) => ({
              name,
              task: { name: "Text Generation" },
            })),
          }),
        ),
    }),
    /Unknown Cloudflare text-generation model slug: missing\. Available streaming text-generation slugs: one, two, three, four, five\./,
  );
});
