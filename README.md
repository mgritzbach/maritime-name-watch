# Maritime Name Watch

A small, self-hosted name-monitoring bot for [Maritime](https://maritime.sh/). It checks RSS/news search results once an hour, analyzes only unseen results with the included Maritime LLM, and reports:

- what the new appearance says;
- the new mention's positive/negative sentiment;
- the lifetime positive/negative rate; and
- how the new mention changed that rate in percentage points.

It has zero npm dependencies and never calls OpenAI, Anthropic, OpenRouter, or another model provider directly. The model endpoint is hardcoded to Maritime's proxy.

## What it looks like

```text
New mention: Example News reports that Jane Doe launched a community project.
Source: Example News — 7/26/2026
Sentiment: 82% positive / 18% negative
Overall: 71% positive / 29% negative
Change: positive +3.2 points, negative -3.2 points
Confidence: identity 94%, sentiment 88%
https://example.com/story
```

## The simple setup

### 1. Fork this repository

Fork or copy the repository into your own GitHub account. Maritime deploys the `Dockerfile` directly.

### 2. Create a Maritime agent from the GitHub repository

In Maritime:

1. Create a custom agent from your GitHub repository.
2. Expose port `8787` with a public URL.
3. Choose **Use Maritime LLM**. Do not paste an OpenAI, Anthropic, or OpenRouter key.
4. Keep auto-sleep enabled.
5. Set a hard compute limit and an API budget no greater than the prepaid/promotional credits you intend to use. Keep auto-recharge and overages disabled. The app also enforces a maximum of 24 analyses per day.

Maritime documents [GitHub deployments and resource caps](https://maritime.sh/docs/cli) and [environment variables](https://maritime.sh/docs/configuration). Its templates document that **Use Maritime LLM** injects a per-agent proxy token and routes requests through Maritime's LLM proxy.

### 3. Add three environment variables

```text
WATCH_NAME=Jane Doe
WATCH_CONTEXT=Acme,Seattle,marine biologist
MONITOR_TOKEN=use-a-long-random-secret-here
```

`WATCH_CONTEXT` is a comma-separated list of facts that distinguish the person from other people with the same name.

Maritime supplies the LLM proxy token when **Use Maritime LLM** is selected. The app accepts that injected token, but sends it only to:

```text
https://api.maritime.sh/api/llm/v1
```

### 4. Choose where alerts go

For Telegram, add:

```text
TELEGRAM_BOT_TOKEN=your-telegram-bot-token
TELEGRAM_CHAT_ID=your-chat-id
```

Or connect any service that accepts a JSON webhook:

```text
NOTIFY_WEBHOOK_URL=https://your-service.example/name-watch
NOTIFY_WEBHOOK_TOKEN=optional-bearer-token
```

Without either option, alerts appear in Maritime logs and remain available from the authenticated mentions endpoint.

### 5. Add an hourly cron trigger

Configure a Maritime cron trigger to call:

```text
POST https://YOUR-AGENT-URL/v1/tick
Authorization: Bearer YOUR_MONITOR_TOKEN
```

Run it hourly. Duplicate ticks are safe. The process also checks once a minute while awake, but the external trigger is what wakes a sleeping agent.

## Configuration

Copy [`.env.example`](.env.example) for all options.

| Variable | Default | Purpose |
| --- | --- | --- |
| `WATCH_NAME` | required | Exact name to monitor |
| `WATCH_ALIASES` | empty | Comma-separated alternate names |
| `WATCH_CONTEXT` | empty | Employer, city, occupation, username, or other identity clues |
| `EXCLUDE_TERMS` | empty | Comma-separated terms that always reject a result |
| `REQUIRE_CONTEXT` | `false` | Reject results with no matching context before model analysis |
| `CHECK_EVERY_MINUTES` | `60` | Discovery cadence; minimum 30 |
| `MAX_NEW_PER_RUN` | `10` | Candidates analyzed in one run; maximum 25 |
| `MAX_ANALYSES_PER_DAY` | `8` | Hard daily model-call limit; maximum 24 |
| `MARITIME_LLM_MODEL` | `gpt-4o-mini` | Model requested from Maritime |
| `RSS_URL_1`…`RSS_URL_5` | Google News search | Optional RSS or Atom feeds |
| `STATE_PATH` | `/data/state.json` in Docker | Persistent mention history |

If no RSS URL is supplied, the app generates a Google News RSS query for the exact name, up to three context terms, and the previous day. This is useful but cannot guarantee coverage of the whole internet. Add specialized RSS feeds for industry publications or other important sources.

## API

Public:

```text
GET /healthz
GET /
```

Authenticated with `Authorization: Bearer MONITOR_TOKEN` or `X-Monitor-Token`:

```text
POST /v1/tick
POST /v1/tick?force=true
GET  /v1/status
GET  /v1/mentions?limit=50
```

`force=true` bypasses the hourly due-time check, but it does not bypass deduplication or daily analysis limits.

## How sentiment is calculated

Maritime returns positive, negative, and neutral scores totaling 100. For the requested positive/negative display, the app removes the neutral portion and normalizes the remaining polarity:

```text
mention positive = positive / (positive + negative)
mention negative = negative / (positive + negative)
```

Mentions with less than 20 total positive-plus-negative points are treated as neutral and do not change the lifetime polarity rate. The overall rate is the equal-weighted mean of unique, relevant, non-neutral mentions. Change is reported in percentage points.

## Cost and token controls

- Discovery and deduplication use no model tokens.
- No new result means no model call.
- Each candidate is analyzed at most twice after transient failures.
- Article snippets are capped at 2,500 characters.
- Model output is capped at 300 tokens by code.
- Analyses are capped at 24 per UTC day by code; the default is 8.
- Only the Maritime LLM proxy is supported.
- When the daily cap is reached, new candidates remain queued.
- Maritime account budgets and auto-stop remain the authoritative protection when prepaid credits run out.

This project does not create accounts, purchase credits, enable billing, or deploy itself.

## Local development

Node.js 20 or newer is sufficient:

```sh
npm test
```

To run locally, set the variables in your shell and start the server. A live analysis requires a Maritime-injected proxy token; tests use fakes and make no network calls.

## Privacy and accuracy

- Use context terms for common names.
- The model is instructed to reject uncertain identity matches.
- Results below 60% identity confidence are not alerted.
- Summaries attribute statements to the source instead of presenting allegations as facts.
- The service stores titles, snippets, links, scores, and run metadata in its private data volume.
- RSS/search coverage is incomplete and source publication dates can be inaccurate.

## License

MIT
