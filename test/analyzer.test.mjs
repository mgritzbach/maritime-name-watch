import test from "node:test";
import assert from "node:assert/strict";
import { MaritimeAnalyzer, normalizeAnalysis } from "../src/analyzer.mjs";
import { MARITIME_LLM_BASE_URL } from "../src/config.mjs";

test("analyzer calls only the Maritime proxy and normalizes structured output", async () => {
  let requestedUrl;
  const analyzer = new MaritimeAnalyzer({
    token: "proxy-token",
    fetchImpl: async (url, options) => {
      requestedUrl = url;
      const request = JSON.parse(options.body);
      assert.equal(request.model, "gpt-4o-mini");
      assert.equal(request.max_tokens, 220);
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              relevant: true,
              identity_confidence: 0.91,
              summary: "Example News reports that Jane Doe launched a project.",
              positive: 70,
              negative: 20,
              neutral: 10,
              sentiment_confidence: 88
            })
          }
        }]
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });
  const result = await analyzer.analyze({
    title: "Jane Doe launches a project",
    snippet: "Jane Doe launched a community project.",
    sourceName: "Example News",
    publishedAt: "2026-07-26T15:00:00.000Z"
  }, {
    name: "Jane Doe",
    aliases: ["Jane Doe"],
    contextTerms: ["Acme"]
  });
  assert.equal(requestedUrl, `${MARITIME_LLM_BASE_URL}/chat/completions`);
  assert.equal(result.identityConfidence, 91);
  assert.deepEqual(
    { positive: result.positive, negative: result.negative, neutral: result.neutral },
    { positive: 70, negative: 20, neutral: 10 }
  );
});

test("analysis normalization handles zero and fractional scores", () => {
  assert.deepEqual(normalizeAnalysis({
    relevant: true,
    identity_confidence: 0.8,
    summary: "Neutral mention.",
    positive: 0,
    negative: 0,
    neutral: 0,
    sentiment_confidence: 0.5
  }), {
    relevant: true,
    identityConfidence: 80,
    summary: "Neutral mention.",
    positive: 0,
    negative: 0,
    neutral: 100,
    sentimentConfidence: 50
  });
});
