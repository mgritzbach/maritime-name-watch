import test from "node:test";
import assert from "node:assert/strict";
import { configFromEnv, MARITIME_LLM_BASE_URL } from "../src/config.mjs";

test("configuration generates a Google News feed and pins the Maritime LLM endpoint", () => {
  const config = configFromEnv({
    WATCH_NAME: "Jane Doe",
    WATCH_CONTEXT: "Acme, Seattle",
    MONITOR_TOKEN: "1234567890abcdef",
    OPENAI_API_KEY: "maritime-injected-token",
    CHECKS_PER_DAY: "12"
  });
  assert.equal(config.llm.baseUrl, MARITIME_LLM_BASE_URL);
  assert.equal(config.llm.token, "maritime-injected-token");
  assert.equal(config.limits.checksPerDay, 12);
  assert.equal(config.limits.checkEveryMinutes, 120);
  assert.match(config.rssUrls[0], /^https:\/\/news\.google\.com\/rss\/search/);
  assert.match(new URL(config.rssUrls[0]).searchParams.get("q"), /"Jane Doe"/);
  assert.deepEqual(config.profile.contextTerms, ["Acme", "Seattle"]);
});

test("configuration enforces supported checks per day", () => {
  assert.throws(() => configFromEnv({
    WATCH_NAME: "Jane Doe",
    MONITOR_TOKEN: "1234567890abcdef",
    CHECKS_PER_DAY: "5"
  }), /must be one of/);
});

test("configuration enforces hard analysis and token ceilings", () => {
  assert.throws(() => configFromEnv({
    WATCH_NAME: "Jane Doe",
    MONITOR_TOKEN: "1234567890abcdef",
    MAX_ANALYSES_PER_DAY: "25"
  }), /1 to 24/);
  assert.throws(() => configFromEnv({
    WATCH_NAME: "Jane Doe",
    MONITOR_TOKEN: "1234567890abcdef",
    MAX_OUTPUT_TOKENS: "301"
  }), /100 to 300/);
});
