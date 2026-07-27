import { aggregateMentions, calculateChange } from "./sentiment.mjs";
import { formatAlert, publicMention } from "./notifier.mjs";

export class NameMonitor {
  #running = null;

  constructor({ config, store, discover, analyzer, notifier, now = () => new Date() }) {
    Object.assign(this, { config, store, discover, analyzer, notifier, now });
  }

  tick(options = {}) {
    if (this.#running) return this.#running;
    this.#running = this.#tick(options).finally(() => { this.#running = null; });
    return this.#running;
  }

  async #tick({ force = false } = {}) {
    const startedAt = this.now();
    const before = await this.store.read();
    const due = force || !before.nextRunAt || new Date(before.nextRunAt) <= startedAt;
    let discovered = 0;
    let sourceErrors = [];

    if (due) {
      const discovery = await this.discover(this.config);
      sourceErrors = discovery.errors;
      discovered = await this.#saveCandidates(discovery.candidates, startedAt);
      await this.store.mutate((state) => {
        state.lastRunAt = startedAt.toISOString();
        state.nextRunAt = new Date(startedAt.getTime() + this.config.limits.checkEveryMinutes * 60_000).toISOString();
      });
    }

    const notifiedBacklog = await this.#notifyReady();
    const analysis = await this.#analyzePending();
    const completedAt = this.now();
    const result = {
      due,
      discovered,
      analyzed: analysis.analyzed,
      rejected: analysis.rejected,
      deferredByDailyLimit: analysis.deferred,
      notified: notifiedBacklog + analysis.notified,
      sourceErrors,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString()
    };
    await this.store.mutate((state) => {
      state.recentRuns.unshift(result);
      state.recentRuns = state.recentRuns.slice(0, 25);
    });
    return result;
  }

  async status() {
    const state = await this.store.read();
    const mentions = Object.values(state.mentions);
    const discoveryMode = this.config.discoveryMode ?? "rss";
    return {
      ok: true,
      monitoredName: this.config.profile.name,
      lastRunAt: state.lastRunAt,
      nextRunAt: state.nextRunAt,
      counts: {
        total: mentions.length,
        relevant: mentions.filter((mention) => mention.relevant).length,
        pending: mentions.filter((mention) => mention.status === "pending").length,
        failed: mentions.filter((mention) => mention.status === "failed").length
      },
      overall: aggregateMentions(mentions),
      maritimeLlmConfigured: Boolean(this.config.llm.token),
      discovery: {
        mode: discoveryMode,
        provider: discoveryMode === "full_search" ? this.config.fullSearchProvider : "rss",
        sources: discoveryMode === "full_search" ? (this.config.fullSearchUrls?.length ?? 0) : (this.config.rssUrls?.length ?? 0)
      },
      limits: this.config.limits,
      recentRuns: state.recentRuns.slice(0, 5)
    };
  }

  async mentions(limit = 50) {
    const state = await this.store.read();
    return Object.values(state.mentions)
      .filter((mention) => mention.relevant)
      .sort((a, b) => String(b.discoveredAt).localeCompare(String(a.discoveredAt)))
      .slice(0, limit)
      .map(publicMention);
  }

  async #saveCandidates(candidates, now) {
    return this.store.mutate((state) => {
      const fingerprints = new Set(Object.values(state.mentions).map((mention) => mention.fingerprint));
      let added = 0;
      for (const candidate of candidates) {
        if (state.mentions[candidate.id] || fingerprints.has(candidate.fingerprint)) continue;
        state.mentions[candidate.id] = {
          ...candidate,
          discoveredAt: now.toISOString(),
          status: "pending",
          relevant: null,
          attempts: 0,
          nextAttemptAt: now.toISOString(),
          analysis: null,
          stats: null,
          notifiedAt: null
        };
        fingerprints.add(candidate.fingerprint);
        added += 1;
      }
      return added;
    });
  }

  async #analyzePending() {
    const snapshot = await this.store.read();
    const now = this.now();
    const day = now.toISOString().slice(0, 10);
    const alreadyUsed = Number(snapshot.usageByDay[day] ?? 0);
    const allowance = Math.max(0, this.config.limits.maxAnalysesPerDay - alreadyUsed);
    const pending = Object.values(snapshot.mentions)
      .filter((mention) => mention.status === "pending" && new Date(mention.nextAttemptAt ?? 0) <= now)
      .sort((a, b) => String(a.discoveredAt).localeCompare(String(b.discoveredAt)));
    const selected = pending.slice(0, Math.min(allowance, this.config.limits.maxNewPerRun));
    let analyzed = 0;
    let rejected = 0;
    let notified = 0;

    for (const item of selected) {
      await this.store.mutate((state) => {
        state.usageByDay[day] = Number(state.usageByDay[day] ?? 0) + 1;
        pruneUsage(state.usageByDay, day);
        state.mentions[item.id].attempts += 1;
      });
      try {
        const result = await this.analyzer.analyze(item, this.config.profile);
        if (!result.relevant || result.identityConfidence < 60) {
          await this.store.mutate((state) => {
            Object.assign(state.mentions[item.id], {
              status: "rejected",
              relevant: false,
              analysis: result,
              analyzedAt: this.now().toISOString()
            });
          });
          rejected += 1;
          continue;
        }

        await this.store.mutate((state) => {
          const current = state.mentions[item.id];
          current.relevant = true;
          current.analysis = result;
          current.analyzedAt = this.now().toISOString();
          const previous = Object.values(state.mentions).filter((mention) => (
            mention.id !== item.id && mention.relevant && mention.analysis
          ));
          current.stats = calculateChange(previous, current);
          current.status = "analyzed";
        });
        analyzed += 1;
        notified += await this.#notifyOne(item.id);
      } catch (error) {
        await this.store.mutate((state) => {
          const current = state.mentions[item.id];
          current.lastError = error.message;
          if (current.attempts >= 2) {
            current.status = "failed";
          } else {
            current.status = "pending";
            current.nextAttemptAt = new Date(this.now().getTime() + 6 * 60 * 60_000).toISOString();
          }
        });
      }
    }

    return {
      analyzed,
      rejected,
      notified,
      deferred: Math.max(0, pending.length - selected.length)
    };
  }

  async #notifyReady() {
    const state = await this.store.read();
    let count = 0;
    for (const mention of Object.values(state.mentions)) {
      if (mention.status === "analyzed" && !mention.notifiedAt) count += await this.#notifyOne(mention.id);
    }
    return count;
  }

  async #notifyOne(id) {
    const state = await this.store.read();
    const mention = state.mentions[id];
    if (!mention || mention.notifiedAt || mention.status !== "analyzed") return 0;
    try {
      await this.notifier.send(formatAlert(mention), mention);
      await this.store.mutate((next) => {
        next.mentions[id].notifiedAt = this.now().toISOString();
        next.mentions[id].status = "notified";
        delete next.mentions[id].notificationError;
      });
      return 1;
    } catch (error) {
      await this.store.mutate((next) => {
        next.mentions[id].notificationError = error.message;
      });
      return 0;
    }
  }
}

function pruneUsage(usageByDay, currentDay) {
  for (const day of Object.keys(usageByDay)) {
    if (day < currentDay && Object.keys(usageByDay).length > 14) delete usageByDay[day];
  }
}
