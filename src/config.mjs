import { resolve } from "node:path";
import { duckDuckGoSearchUrl, FULL_SEARCH_PROVIDER } from "./web-search.mjs";

export const MARITIME_LLM_BASE_URL = "https://api.maritime.sh/api/llm/v1";

export function configFromEnv(env = process.env) {
  const name = clean(env.WATCH_NAME);
  const monitorToken = clean(env.MONITOR_TOKEN);
  if (!name) throw new Error("WATCH_NAME is required");
  if (monitorToken.length < 16) throw new Error("MONITOR_TOKEN must be at least 16 characters");

  const aliases = unique([name, ...list(env.WATCH_ALIASES)]);
  const contextTerms = unique(list(env.WATCH_CONTEXT));
  const checksPerDay = checksPerDayValue(env.CHECKS_PER_DAY, env.CHECK_EVERY_MINUTES);
  const discoveryMode = discoveryModeValue(env.DISCOVERY_MODE);
  const rssUrls = [1, 2, 3, 4, 5]
    .map((number) => clean(env[`RSS_URL_${number}`]))
    .filter(Boolean);

  return {
    profile: {
      name,
      aliases,
      contextTerms,
      excludeTerms: unique(list(env.EXCLUDE_TERMS)),
      requireContext: boolean(env.REQUIRE_CONTEXT, false)
    },
    monitorToken,
    llm: {
      baseUrl: MARITIME_LLM_BASE_URL,
      token: clean(env.MARITIME_LLM_TOKEN) || clean(env.OPENAI_API_KEY),
      model: clean(env.MARITIME_LLM_MODEL) || "gpt-4o-mini",
      maxOutputTokens: integer(env.MAX_OUTPUT_TOKENS, 220, 100, 300)
    },
    discoveryMode,
    fullSearchProvider: FULL_SEARCH_PROVIDER,
    fullSearchUrls: aliases.slice(0, 5).map(duckDuckGoSearchUrl),
    rssUrls: rssUrls.length ? rssUrls : [googleNewsRssUrl(name, contextTerms)],
    limits: {
      checksPerDay,
      checkEveryMinutes: 1_440 / checksPerDay,
      maxNewPerRun: integer(env.MAX_NEW_PER_RUN, 10, 1, 25),
      maxAnalysesPerDay: integer(env.MAX_ANALYSES_PER_DAY, 8, 1, 24),
      maxResultsPerFeed: integer(env.MAX_RESULTS_PER_FEED, 25, 1, 50),
      fetchTimeoutMs: integer(env.FETCH_TIMEOUT_MS, 10_000, 1_000, 30_000)
    },
    notifications: {
      telegramBotToken: clean(env.TELEGRAM_BOT_TOKEN),
      telegramChatId: clean(env.TELEGRAM_CHAT_ID),
      webhookUrl: clean(env.NOTIFY_WEBHOOK_URL),
      webhookToken: clean(env.NOTIFY_WEBHOOK_TOKEN)
    },
    port: integer(env.PORT, 8787, 1, 65_535),
    statePath: resolve(clean(env.STATE_PATH) || "./data/state.json"),
    autoRun: boolean(env.AUTO_RUN, true)
  };
}

export function googleNewsRssUrl(name, contextTerms = []) {
  const context = contextTerms.slice(0, 3).join(" OR ");
  const query = [`"${name}"`, context ? `(${context})` : "", "when:1d"].filter(Boolean).join(" ");
  const url = new URL("https://news.google.com/rss/search");
  url.searchParams.set("q", query);
  url.searchParams.set("hl", "en-US");
  url.searchParams.set("gl", "US");
  url.searchParams.set("ceid", "US:en");
  return url.toString();
}

function discoveryModeValue(value) {
  const mode = clean(value || "full_search").toLocaleLowerCase();
  if (!["full_search", "rss"].includes(mode)) {
    throw new Error("DISCOVERY_MODE must be full_search or rss");
  }
  return mode;
}

function checksPerDayValue(value, legacyMinutes) {
  if (value != null && value !== "") {
    const checks = integer(value, 24, 1, 24);
    if (![1, 2, 3, 4, 6, 8, 12, 24].includes(checks)) {
      throw new Error("CHECKS_PER_DAY must be one of 1, 2, 3, 4, 6, 8, 12, or 24");
    }
    return checks;
  }
  const minutes = integer(legacyMinutes, 60, 60, 1_440);
  const checks = 1_440 / minutes;
  if (!Number.isInteger(checks)) throw new Error("CHECK_EVERY_MINUTES must divide evenly into one day");
  return checks;
}
function clean(value) {
  return String(value ?? "").trim();
}

function list(value) {
  return clean(value).split(",").map((part) => part.trim()).filter(Boolean);
}

function unique(values) {
  return [...new Set(values.map((value) => value.toLocaleLowerCase()).map((lower, index, lowers) => {
    const first = lowers.indexOf(lower);
    return values[first].trim();
  }))];
}

function boolean(value, fallback) {
  if (value == null || value === "") return fallback;
  if (/^(?:1|true|yes|on)$/i.test(value)) return true;
  if (/^(?:0|false|no|off)$/i.test(value)) return false;
  throw new Error(`Invalid boolean value: ${value}`);
}

function integer(value, fallback, min, max) {
  const number = value == null || value === "" ? fallback : Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new Error(`Expected an integer from ${min} to ${max}, received ${value}`);
  }
  return number;
}
