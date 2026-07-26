export function notifierFromConfig(config, fetchImpl = fetch) {
  const destinations = [new ConsoleNotifier()];
  const { telegramBotToken, telegramChatId, webhookUrl, webhookToken } = config.notifications;
  if (telegramBotToken && telegramChatId) {
    destinations.push(new TelegramNotifier({ token: telegramBotToken, chatId: telegramChatId, fetchImpl }));
  }
  if (webhookUrl) {
    destinations.push(new WebhookNotifier({ url: webhookUrl, token: webhookToken, fetchImpl }));
  }
  return new MultiNotifier(destinations);
}

export class MultiNotifier {
  constructor(destinations) {
    this.destinations = destinations;
  }

  async send(message, mention) {
    const results = await Promise.allSettled(
      this.destinations.map((destination) => destination.send(message, mention))
    );
    const externalResults = results.slice(1);
    if (externalResults.length && externalResults.every((result) => result.status === "rejected")) {
      throw externalResults[0].reason;
    }
    return results;
  }
}

export class ConsoleNotifier {
  async send(message) {
    process.stdout.write(`[name-watch]\n${message}\n`);
    return { ok: true };
  }
}

export class TelegramNotifier {
  constructor({ token, chatId, fetchImpl = fetch }) {
    Object.assign(this, { token, chatId, fetchImpl });
  }

  async send(message) {
    const response = await this.fetchImpl(`https://api.telegram.org/bot${this.token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: this.chatId, text: message, disable_web_page_preview: false })
    });
    if (!response.ok) throw new Error(`Telegram notification failed (${response.status})`);
    return response.json().catch(() => ({ ok: true }));
  }
}

export class WebhookNotifier {
  constructor({ url, token, fetchImpl = fetch }) {
    Object.assign(this, { url, token, fetchImpl });
  }

  async send(message, mention) {
    const response = await this.fetchImpl(this.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {})
      },
      body: JSON.stringify({ text: message, mention: publicMention(mention) })
    });
    if (!response.ok) throw new Error(`Webhook notification failed (${response.status})`);
    return response.json().catch(() => ({ ok: true }));
  }
}

export function formatAlert(mention) {
  const stats = mention.stats;
  const sentiment = stats.current
    ? `${stats.current.positive}% positive / ${stats.current.negative}% negative`
    : "neutral or uncertain";
  const overall = stats.after.count
    ? `${stats.after.positive}% positive / ${stats.after.negative}% negative`
    : "no polarized mentions yet";
  const change = stats.delta
    ? `positive ${signed(stats.delta.positive)} points, negative ${signed(stats.delta.negative)} points`
    : "baseline established";
  return [
    `New mention: ${mention.analysis.summary || mention.title}`,
    `Source: ${mention.sourceName}${mention.publishedAt ? ` — ${new Date(mention.publishedAt).toLocaleDateString("en-US")}` : ""}`,
    `Sentiment: ${sentiment}`,
    `Overall: ${overall}`,
    `Change: ${change}`,
    `Confidence: identity ${mention.analysis.identityConfidence}%, sentiment ${mention.analysis.sentimentConfidence}%`,
    mention.url
  ].join("\n");
}

export function publicMention(mention) {
  return {
    id: mention.id,
    title: mention.title,
    url: mention.url,
    sourceName: mention.sourceName,
    publishedAt: mention.publishedAt,
    discoveredAt: mention.discoveredAt,
    analysis: mention.analysis,
    stats: mention.stats,
    notifiedAt: mention.notifiedAt
  };
}

function signed(value) {
  return `${value >= 0 ? "+" : ""}${value}`;
}
