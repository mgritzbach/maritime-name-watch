import test from "node:test";
import assert from "node:assert/strict";
import { canonicalizeUrl, parseFeed } from "../src/rss.mjs";

test("parses RSS and strips markup from descriptions", () => {
  const xml = `<?xml version="1.0"?>
    <rss><channel><item>
      <title><![CDATA[Jane Doe launches a project - Example News]]></title>
      <link>https://example.com/story?utm_source=rss&amp;id=7</link>
      <description><![CDATA[<b>Jane Doe</b> launched a community project.]]></description>
      <pubDate>Sun, 26 Jul 2026 15:00:00 GMT</pubDate>
      <source>Example News</source>
    </item></channel></rss>`;
  const [item] = parseFeed(xml, "https://example.com/feed");
  assert.equal(item.title, "Jane Doe launches a project - Example News");
  assert.equal(item.snippet, "Jane Doe launched a community project.");
  assert.equal(item.url, "https://example.com/story?id=7");
  assert.equal(item.sourceName, "Example News");
  assert.equal(item.publishedAt, "2026-07-26T15:00:00.000Z");
  assert.equal(item.id.length, 24);
  assert.equal(item.fingerprint.length, 64);
});

test("parses Atom entries and canonicalizes tracking URLs", () => {
  const xml = `<feed><entry>
    <title>Jane Doe interviewed</title>
    <link href="https://example.org/post/?fbclid=abc"/>
    <summary>Interview with Jane Doe.</summary>
    <updated>2026-07-26T16:00:00Z</updated>
  </entry></feed>`;
  const [item] = parseFeed(xml);
  assert.equal(item.url, "https://example.org/post");
  assert.equal(item.sourceName, "example.org");
  assert.equal(canonicalizeUrl("not a url"), "not a url");
});
