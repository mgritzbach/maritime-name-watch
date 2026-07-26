---
name: name-watch
description: Configure, deploy, operate, and inspect Maritime Name Watch entirely from Codex when the user wants to monitor a personal name, change identity-matching or alert preferences, run a check, or review sentiment history.
---

# Maritime Name Watch

Use this skill whenever the user asks to set up or operate their Maritime name monitor.

## Core workflow

1. Collect only missing identity fields:
   - full name;
   - aliases or usernames, if any;
   - two or more context terms where possible, such as employer, city, profession, or website;
   - exclusion terms for known false matches;
   - desired cadence, daily analysis ceiling, and alert channel.
2. Call `name_watch_save_preferences`. Do not put notification credentials into the profile.
3. Call `name_watch_preflight` before any Maritime mutation.
4. If preflight shows an expiring browser login and the user wants durable browserless operation, explain that Codex can create a limited Maritime automation key. Call `name_watch_enable_durable_auth` only after its exact confirmation phrase is supplied. Never display the returned key.
5. Explain the exact deployment impact and hard limits. Never create, deploy, restart, or add triggers merely because the user supplied profile data.
6. Before `name_watch_deploy`, obtain the user's explicit confirmation that:
   - only existing prepaid or promotional Maritime credits may be used;
   - overages and auto-recharge are disabled;
   - the requested compute-minute cap is acceptable.
7. Pass the tool's exact confirmation phrase and cap. If the tool reports that it cannot verify a safe Maritime-only configuration, stop.
8. After deployment, configure Telegram or a webhook only if the user provides those credentials in the same conversation. Call `name_watch_configure_notifications`; never repeat credentials back.
9. Call `name_watch_trigger_now`, then `name_watch_status` and `name_watch_mentions` to verify the first run.

## Operating requests

- "Check now" → `name_watch_trigger_now`.
- "Show status" → `name_watch_status`.
- "Show mentions" → `name_watch_mentions`.
- "Change my matching/cadence preferences" → save preferences, then call `name_watch_apply_preferences` only after the user asks to apply them.
- "Pause it" → `name_watch_pause`.
- Do not delete an agent. No deletion tool is exposed.

## Privacy and provider rules

- The local profile contains identity matching data but no API keys, notification tokens, or payment credentials.
- Notification credentials go directly to Maritime's encrypted environment store and are not persisted by the plugin.
- A durable Maritime automation key, when explicitly requested, is stored by the Maritime CLI and never returned by the plugin.
- The deployed application accepts only Maritime's LLM proxy. Never request or configure OpenAI, Anthropic, OpenRouter, or another model-provider key.
- Do not promise whole-internet coverage. The default source is Google News RSS; additional RSS/Atom feeds can be configured.
- Treat a common name without context terms as a likely false-positive risk and tell the user.
- Summaries and sentiment are probabilistic. Report identity and sentiment confidence.

## Financial safety

- Read-only preflight and status calls are always allowed.
- Deployment requires the exact confirmation enforced by `name_watch_deploy`.
- Never navigate to billing, checkout, subscription, upgrade, or payment pages.
- Never create or modify payment methods, auto-recharge, overages, or paid upgrades.
- If prepaid-only operation cannot be established, stop and report the blocker.
