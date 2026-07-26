import test from "node:test";
import assert from "node:assert/strict";
import { NameMonitor } from "../src/monitor.mjs";
import { MemoryStore } from "../src/store.mjs";

const config = {
  profile: {
    name: "Jane Doe",
    aliases: ["Jane Doe"],
    contextTerms: ["Acme"],
    excludeTerms: [],
    requireContext: false
  },
  llm: { token: "proxy" },
  limits: {
    checkEveryMinutes: 60,
    maxNewPerRun: 10,
    maxAnalysesPerDay: 8
  }
};

const candidate = {
  id: "mention-1",
  fingerprint: "fingerprint-1",
  title: "Jane Doe launches project",
  snippet: "Jane Doe of Acme launched a project.",
  url: "https://example.com/one",
  sourceName: "Example",
  publishedAt: "2026-07-26T12:00:00.000Z",
  feedUrl: "https://example.com/feed"
};

test("monitor analyzes and alerts a new mention exactly once", async () => {
  const store = new MemoryStore();
  let analyses = 0;
  const alerts = [];
  const now = () => new Date("2026-07-26T17:00:00.000Z");
  const monitor = new NameMonitor({
    config,
    store,
    now,
    discover: async () => ({ candidates: [candidate], errors: [] }),
    analyzer: {
      async analyze() {
        analyses += 1;
        return {
          relevant: true,
          identityConfidence: 95,
          summary: "Example reports that Jane Doe launched a project.",
          positive: 80,
          negative: 20,
          neutral: 0,
          sentimentConfidence: 90
        };
      }
    },
    notifier: {
      async send(message) {
        alerts.push(message);
      }
    }
  });

  const first = await monitor.tick({ force: true });
  const second = await monitor.tick({ force: true });
  assert.equal(first.discovered, 1);
  assert.equal(first.analyzed, 1);
  assert.equal(first.notified, 1);
  assert.equal(second.discovered, 0);
  assert.equal(second.analyzed, 0);
  assert.equal(analyses, 1);
  assert.equal(alerts.length, 1);
  assert.match(alerts[0], /80% positive \/ 20% negative/);
  assert.match(alerts[0], /baseline established/);
  assert.equal((await monitor.mentions()).length, 1);
});

test("daily analysis ceiling queues overflow without calling the analyzer", async () => {
  const state = new MemoryStore({
    version: 1,
    lastRunAt: null,
    nextRunAt: null,
    mentions: {},
    usageByDay: { "2026-07-26": 8 },
    recentRuns: []
  });
  let analyses = 0;
  const monitor = new NameMonitor({
    config,
    store: state,
    now: () => new Date("2026-07-26T17:00:00.000Z"),
    discover: async () => ({ candidates: [candidate], errors: [] }),
    analyzer: { async analyze() { analyses += 1; } },
    notifier: { async send() {} }
  });
  const result = await monitor.tick({ force: true });
  assert.equal(result.deferredByDailyLimit, 1);
  assert.equal(analyses, 0);
  assert.equal((await monitor.status()).counts.pending, 1);
});
