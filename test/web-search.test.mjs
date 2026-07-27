import test from "node:test";
import assert from "node:assert/strict";
import { duckDuckGoSearchUrl, parseDuckDuckGoHtml } from "../src/web-search.mjs";

test("builds an exact-name DuckDuckGo full-search URL", () => {
  const url = new URL(duckDuckGoSearchUrl("Jane Doe"));
  assert.equal(url.hostname, "html.duckduckgo.com");
  assert.equal(url.searchParams.get("q"), '"Jane Doe"');
});

test("parses DuckDuckGo result links, snippets, and redirect targets", () => {
  const html = `
    <div class="result results_links results_links_deep web-result">
      <h2 class="result__title">
        <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fjane%3Futm_source%3Dsearch&amp;rut=abc">Jane Doe &amp; Acme</a>
      </h2>
      <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fjane">Jane Doe joined <b>Acme</b> in Seattle.</a>
    </div>`;
  const [item] = parseDuckDuckGoHtml(html, "https://html.duckduckgo.com/html/?q=test");
  assert.equal(item.title, "Jane Doe & Acme");
  assert.equal(item.url, "https://example.com/jane");
  assert.equal(item.snippet, "Jane Doe joined Acme in Seattle.");
  assert.equal(item.sourceName, "example.com");
  assert.equal(item.publishedAt, null);
  assert.equal(item.id.length, 24);
  assert.equal(item.fingerprint.length, 64);
});
