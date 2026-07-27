import test from "node:test";
import assert from "node:assert/strict";
import { discoverMentions } from "../src/discovery.mjs";

const profile = {
  aliases: ["Jane Doe"],
  excludeTerms: [],
  contextTerms: ["Acme", "Seattle"],
  requireContext: false
};
const limits = { fetchTimeoutMs: 1_000, maxResultsPerFeed: 25 };

test("full_search mode parses web results and applies the name prefilter", async () => {
  const html = `
    <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fjane">Jane Doe at Acme</a>
    <a class="result__snippet">Jane Doe works in Seattle.</a>
    <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fother">Unrelated result</a>
    <a class="result__snippet">No watched name here.</a>`;
  const result = await discoverMentions({
    discoveryMode: "full_search",
    fullSearchUrls: ["https://html.duckduckgo.com/html/?q=test"],
    rssUrls: ["https://example.com/unused.xml"],
    profile,
    limits
  }, async () => ({ ok: true, text: async () => html }));
  assert.equal(result.errors.length, 0);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].url, "https://example.com/jane");
});

test("rss mode reads only configured feeds", async () => {
  const xml = `<rss><channel><item><title>Jane Doe update</title><link>https://example.com/rss</link><description>Jane Doe at Acme.</description></item></channel></rss>`;
  let requested;
  const result = await discoverMentions({
    discoveryMode: "rss",
    fullSearchUrls: ["https://html.duckduckgo.com/html/?q=unused"],
    rssUrls: ["https://example.com/feed.xml"],
    profile,
    limits
  }, async (url) => {
    requested = url;
    return { ok: true, text: async () => xml };
  });
  assert.equal(requested, "https://example.com/feed.xml");
  assert.equal(result.candidates.length, 1);
});
