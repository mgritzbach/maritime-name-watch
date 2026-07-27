# Maritime Name Watch

A small, self-hosted name-monitoring bot for [Maritime](https://maritime.sh/). It checks full-web search results or RSS/Atom feeds on your chosen daily schedule, analyzes only unseen results with the included Maritime LLM, and reports:

- what the new appearance says;
- the new mention's positive/negative sentiment;
- the lifetime positive/negative rate; and
- how the new mention changed that rate in percentage points.

It has zero npm dependencies and never calls OpenAI, Anthropic, OpenRouter, or another model provider directly. The model endpoint is hardcoded to Maritime's proxy.

## Use it entirely from Codex

Install this repository as a Codex plugin:

```text
https://github.com/mgritzbach/maritime-name-watch
```

Give Codex the link and ask it to install and use the plugin. In the new task, setup starts with one seven-field prompt—no defaults and no preflight until every field is present:

```text
Full name | aliases/usernames | 2+ context terms (company, city, profession, website) | exclusion terms | checks per day | maximum analyses per day | destination email
```

Write `none` for aliases or exclusions when applicable. Checks per day must be `1, 2, 3, 4, 6, 8, 12, or 24`; maximum analyses per day is 1–24. Codex saves only non-secret profile data locally, performs a read-only Maritime preflight, and asks for explicit prepaid-credit confirmation before deployment.

The plugin provides Codex tools to:

- save and update your matching preferences;
- check Maritime authentication without leaving Codex;
- create a limited Maritime automation key for future browserless operation;
- deploy with hard compute and model-call limits;
- configure Telegram or webhook credentials directly in Maritime's encrypted environment;
- run an immediate check, inspect sentiment history, view status, and pause the agent.

No deletion tool is included. Notification credentials and Maritime keys are never stored in the local preference profile.

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

The onboarding profile also requires a destination email so the intended recipient is explicit. That address is not treated as proof of working email delivery: Maritime documents outbound Gmail through a separately connected OpenClaw Google integration, but it does not document a native outbound-email API for custom repository agents. The plugin reports this limitation instead of silently falling back to logs or claiming the email is configured.

### 5. Add the matching cron trigger

In the Maritime dashboard, open the agent's **Triggers** section and add a cron matching the chosen checks per day. The Codex plugin does this automatically and supports evenly spaced schedules from once daily through hourly. The trigger wakes the sleeping agent only when a check is due.

For 24 checks per day, the equivalent CLI command is:

```text
maritime triggers create maritime-name-watch --type cron --cron "17 * * * *"
```

The `:17` offset avoids the busiest top-of-hour minute. Duplicate wakeups are safe. Use the authenticated `/v1/tick` endpoint only for a manual test or an external scheduler.

## Configuration

Copy [`.env.example`](.env.example) for all options.

| Variable | Default | Purpose |
| --- | --- | --- |
| `WATCH_NAME` | required | Exact name to monitor |
| `WATCH_ALIASES` | empty | Comma-separated alternate names |
| `WATCH_CONTEXT` | empty | Employer, city, occupation, username, or other identity clues |
| `EXCLUDE_TERMS` | empty | Comma-separated terms that always reject a result |
| `REQUIRE_CONTEXT` | `false` | Reject results with no matching context before model analysis |
| `CHECKS_PER_DAY` | `24` | Checks per day: 1, 2, 3, 4, 6, 8, 12, or 24 |
| `DISCOVERY_MODE` | `full_search` | `full_search` for keyless web search or `rss` for RSS/Atom only |
| `MAX_NEW_PER_RUN` | `10` | Candidates analyzed in one run; maximum 25 |
| `MAX_ANALYSES_PER_DAY` | `8` | Hard daily model-call limit; maximum 24 |
| `MARITIME_LLM_MODEL` | `gpt-4o-mini` | Model requested from Maritime |
| `RSS_URL_1`…`RSS_URL_5` | empty | RSS-mode feeds; Google News RSS is the RSS-mode fallback |
| `STATE_PATH` | `/data/state.json` in Docker | Persistent mention history |

`full_search` is the default. It sends the exact watched name and aliases to DuckDuckGo's keyless HTML search endpoint, then applies local exclusions, optional context filtering, deduplication, and Maritime LLM identity validation. Search-result pages may omit or reorder results over time.

In `rss` mode, configured RSS/Atom feeds are used. If none are supplied, the app generates a Google News RSS query for the exact name, up to three context terms, and the previous day. Neither mode guarantees whole-internet coverage.

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

The monitoring service never creates accounts, purchases credits, or enables billing. The optional Codex plugin can deploy only after explicit prepaid-only confirmation and a hard compute cap.

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
