import { canonicalizeUrl, contentFingerprint, mentionId } from "./rss.mjs";

export const FULL_SEARCH_PROVIDER = "duckduckgo_html";

export function duckDuckGoSearchUrl(term) {
  const query = `"${String(term ?? "").trim()}"`;
  const url = new URL("https://html.duckduckgo.com/html/");
  url.searchParams.set("q", query);
  return url.toString();
}

export function parseDuckDuckGoHtml(html, searchUrl = "") {
  const source = String(html ?? "");
  const matches = [...source.matchAll(/<a\b([^>]*\bclass=(?:"[^"]*\bresult__a\b[^"]*"|'[^']*\bresult__a\b[^']*')[^>]*)>([\s\S]*?)<\/a>/gi)];
  return matches.map((match, index) => {
    const nextIndex = matches[index + 1]?.index ?? source.length;
    const resultHtml = source.slice(match.index, nextIndex);
    const href = attribute(match[1], "href");
    const url = canonicalizeUrl(unwrapDuckDuckGoUrl(href));
    const snippetMatch = resultHtml.match(/<(?:a|div)\b[^>]*\bclass=(?:"[^"]*\bresult__snippet\b[^"]*"|'[^']*\bresult__snippet\b[^']*')[^>]*>([\s\S]*?)<\/(?:a|div)>/i);
    const normalized = {
      title: plain(match[2]).slice(0, 500),
      url,
      snippet: plain(snippetMatch?.[1]).slice(0, 2_500),
      publishedAt: null,
      sourceName: hostname(url),
      feedUrl: searchUrl
    };
    return {
      ...normalized,
      id: mentionId(url),
      fingerprint: contentFingerprint(normalized)
    };
  }).filter((record) => record.title && /^https?:\/\//.test(record.url));
}

function unwrapDuckDuckGoUrl(value) {
  const decoded = decodeHtml(value);
  try {
    const redirect = new URL(decoded.startsWith("//") ? `https:${decoded}` : decoded);
    return redirect.searchParams.get("uddg") || redirect.toString();
  } catch {
    return decoded;
  }
}

function attribute(value, name) {
  const match = String(value ?? "").match(new RegExp(`\\b${name}=(?:"([^"]*)"|'([^']*)')`, "i"));
  return match?.[1] || match?.[2] || "";
}

function plain(value) {
  return decodeHtml(String(value ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function decodeHtml(value) {
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
