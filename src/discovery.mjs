import { parseFeed } from "./rss.mjs";

export async function discoverMentions(config, fetchImpl = fetch) {
  const candidates = [];
  const errors = [];

  for (const feedUrl of config.rssUrls) {
    try {
      const response = await fetchWithTimeout(feedUrl, config.limits.fetchTimeoutMs, fetchImpl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const xml = await response.text();
      candidates.push(...parseFeed(xml, feedUrl).slice(0, config.limits.maxResultsPerFeed));
    } catch (error) {
      errors.push({ feedUrl, error: error.message });
    }
  }

  return { candidates: candidates.filter((candidate) => prefilter(candidate, config.profile)), errors };
}

export function prefilter(candidate, profile) {
  const text = `${candidate.title} ${candidate.snippet}`.toLocaleLowerCase();
  if (!profile.aliases.some((alias) => text.includes(alias.toLocaleLowerCase()))) return false;
  if (profile.excludeTerms.some((term) => text.includes(term.toLocaleLowerCase()))) return false;
  if (profile.requireContext && profile.contextTerms.length) {
    return profile.contextTerms.some((term) => text.includes(term.toLocaleLowerCase()));
  }
  return true;
}

async function fetchWithTimeout(url, timeoutMs, fetchImpl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, {
      signal: controller.signal,
      headers: { "user-agent": "MaritimeNameWatch/0.1 (+https://github.com/)" }
    });
  } finally {
    clearTimeout(timeout);
  }
}
