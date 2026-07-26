import { MARITIME_LLM_BASE_URL } from "./config.mjs";

export class MaritimeAnalyzer {
  constructor({ token, model = "gpt-4o-mini", maxOutputTokens = 220, fetchImpl = fetch }) {
    this.token = token;
    this.model = model;
    this.maxOutputTokens = maxOutputTokens;
    this.fetchImpl = fetchImpl;
  }

  async analyze(candidate, profile) {
    if (!this.token) {
      throw new Error("Maritime LLM token is missing. Deploy with “Use Maritime LLM” enabled.");
    }

    const response = await this.fetchImpl(`${MARITIME_LLM_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0,
        max_tokens: this.maxOutputTokens,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: [
              "You analyze an online mention of a named person.",
              "Return JSON only with keys: relevant, identity_confidence, summary, positive, negative, neutral, sentiment_confidence.",
              "All confidence and sentiment fields are numbers from 0 to 100.",
              "positive + negative + neutral must total 100.",
              "Judge sentiment toward the monitored person, not the article's general mood.",
              "Keep summary factual, attributed, and under 240 characters.",
              "If identity is uncertain, set relevant false rather than guessing."
            ].join(" ")
          },
          {
            role: "user",
            content: JSON.stringify({
              monitoredPerson: profile.name,
              aliases: profile.aliases,
              identityContext: profile.contextTerms,
              source: candidate.sourceName,
              title: candidate.title,
              snippet: candidate.snippet.slice(0, 2_500),
              publishedAt: candidate.publishedAt
            })
          }
        ]
      })
    });

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`Maritime LLM request failed (${response.status}): ${safeError(body)}`);
    }
    const content = body?.choices?.[0]?.message?.content;
    if (!content) throw new Error("Maritime LLM returned no message content");
    return normalizeAnalysis(parseJson(content));
  }
}

export function normalizeAnalysis(value) {
  const raw = value && typeof value === "object" ? value : {};
  const scores = normalizeScores(raw.positive, raw.negative, raw.neutral);
  return {
    relevant: raw.relevant === true,
    identityConfidence: percent(raw.identity_confidence),
    summary: String(raw.summary ?? "").replace(/\s+/g, " ").trim().slice(0, 240),
    positive: scores.positive,
    negative: scores.negative,
    neutral: scores.neutral,
    sentimentConfidence: percent(raw.sentiment_confidence)
  };
}

function normalizeScores(positive, negative, neutral) {
  const values = [percent(positive), percent(negative), percent(neutral)];
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return { positive: 0, negative: 0, neutral: 100 };
  const normalized = values.map((value) => value / total * 100);
  return {
    positive: round(normalized[0]),
    negative: round(normalized[1]),
    neutral: round(100 - normalized[0] - normalized[1])
  };
}

function percent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  const scaled = number >= 0 && number <= 1 ? number * 100 : number;
  return Math.min(100, Math.max(0, scaled));
}

function parseJson(value) {
  const cleaned = String(value).trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new Error("Maritime LLM returned invalid JSON");
  }
}

function safeError(body) {
  return String(body?.error?.message ?? body?.error ?? body?.message ?? "unknown error").slice(0, 300);
}

function round(value) {
  return Math.round(value * 10) / 10;
}
