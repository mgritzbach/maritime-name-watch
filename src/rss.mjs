import { createHash } from "node:crypto";

export function parseFeed(xml, feedUrl = "") {
  const source = String(xml ?? "");
  const rssItems = blocks(source, "item");
  const atomEntries = blocks(source, "entry");
  const records = rssItems.length ? rssItems.map(parseRssItem) : atomEntries.map(parseAtomEntry);
  return records
    .map((record) => normalizeRecord(record, feedUrl))
    .filter((record) => record.title && record.url);
}

export function canonicalizeUrl(value) {
  try {
    const url = new URL(decodeXml(value));
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_.+|fbclid|gclid|mc_[ce]id|ref)$/i.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString();
  } catch {
    return String(value ?? "").trim();
  }
}

export function contentFingerprint({ title, snippet, sourceName = "" }) {
  const withoutSource = sourceName
    ? String(title).replace(new RegExp(`\\s+-\\s+${escapeRegex(sourceName)}$`, "i"), "")
    : String(title);
  const material = `${plain(withoutSource)}\n${plain(snippet)}`.toLocaleLowerCase().replace(/\s+/g, " ").trim();
  return createHash("sha256").update(material).digest("hex");
}

export function mentionId(url) {
  return createHash("sha256").update(canonicalizeUrl(url)).digest("hex").slice(0, 24);
}

function parseRssItem(block) {
  return {
    title: tag(block, "title"),
    url: tag(block, "link") || tag(block, "guid"),
    snippet: tag(block, "description") || tag(block, "content:encoded"),
    publishedAt: tag(block, "pubDate") || tag(block, "dc:date"),
    sourceName: tag(block, "source")
  };
}

function parseAtomEntry(block) {
  const href = block.match(/<link\b[^>]*\bhref=(?:"([^"]+)"|'([^']+)')[^>]*\/?>/i);
  return {
    title: tag(block, "title"),
    url: href?.[1] || href?.[2] || tag(block, "link") || tag(block, "id"),
    snippet: tag(block, "summary") || tag(block, "content"),
    publishedAt: tag(block, "published") || tag(block, "updated"),
    sourceName: tag(block, "source")
  };
}

function normalizeRecord(record, feedUrl) {
  const url = canonicalizeUrl(record.url);
  const published = new Date(record.publishedAt);
  const normalized = {
    title: plain(record.title).slice(0, 500),
    url,
    snippet: plain(record.snippet).slice(0, 2_500),
    publishedAt: Number.isNaN(published.getTime()) ? null : published.toISOString(),
    sourceName: plain(record.sourceName) || hostname(url),
    feedUrl
  };
  return {
    ...normalized,
    id: mentionId(url),
    fingerprint: contentFingerprint(normalized)
  };
}

function blocks(xml, name) {
  return [...xml.matchAll(new RegExp(`<${escapeRegex(name)}\\b[^>]*>([\\s\\S]*?)<\\/${escapeRegex(name)}>`, "gi"))]
    .map((match) => match[1]);
}

function tag(xml, name) {
  const match = xml.match(new RegExp(`<${escapeRegex(name)}\\b[^>]*>([\\s\\S]*?)<\\/${escapeRegex(name)}>`, "i"));
  return match ? decodeXml(match[1].replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, "$1")) : "";
}

function plain(value) {
  return decodeXml(String(value ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function decodeXml(value) {
  return String(value ?? "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function hostname(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
