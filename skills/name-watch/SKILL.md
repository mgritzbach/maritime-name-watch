---
name: name-watch
description: Configure, deploy, operate, and inspect Maritime Name Watch entirely from Codex when the user wants to monitor a personal name, change identity-matching or notification preferences, run a check, or review sentiment history.
---

# Maritime Name Watch

Use this skill whenever the user supplies the repository link, asks to set up the monitor, or asks to operate their Maritime name monitor.

## First-run intake

On first setup, ask for all seven required fields in one message using exactly this order:

`Full name | aliases/usernames | 2+ context terms (company, city, profession, website) | exclusion terms | checks per day | maximum analyses per day | destination email`

Tell the user to write `none` for aliases or exclusions when applicable. Supported checks-per-day values are `1, 2, 3, 4, 6, 8, 12, or 24`; maximum analyses per day is an integer from 1 to 24.

Do not infer, default, save, preflight, or deploy until all seven fields are explicit and unambiguous. A repository link or a setup request starts this intake. If a reply has fewer than seven fields, ask only for the missing fields. Never interpret `all`, `NA`, or a leftover value as an email address or schedule.

Call `name_watch_save_preferences` only after the intake is complete. Pass `none` as an empty array for aliases or exclusions. Do not put notification credentials into the profile.

The destination email is saved as the requested notification target. Maritime currently documents outbound Gmail only through a separately connected OpenClaw Google integration; this custom repository has no documented Maritime-native outbound-email API. Do not claim email delivery is configured merely because the address was saved.

## Deployment workflow

1. Call `name_watch_preflight` before any Maritime mutation.
2. If preflight shows an expiring browser login and the user wants durable browserless operation, explain that Codex can create a limited Maritime automation key. Call `name_watch_enable_durable_auth` only after its exact confirmation phrase is supplied. Never display the returned key.
3. Explain the exact deployment impact and hard limits. Never create, deploy, restart, or add triggers merely because the user supplied profile data.
4. Before `name_watch_deploy`, obtain the user's explicit confirmation that:
   - only existing prepaid or promotional Maritime credits may be used;
   - overages and auto-recharge are disabled;
   - the requested compute-minute cap is acceptable.
5. Pass the tool's exact confirmation phrase and cap. If the tool reports that it cannot verify a safe Maritime-only configuration, stop.
6. After deployment, configure Telegram or a webhook only if the user explicitly chooses that documented alternative and provides its credentials in the same conversation. Call `name_watch_configure_notifications`; never repeat credentials back.
7. Call `name_watch_trigger_now`, then `name_watch_status` and `name_watch_mentions` to verify the first run.

## Operating requests

- "Check now" → `name_watch_trigger_now`.
- "Show status" → `name_watch_status`.
- "Show mentions" → `name_watch_mentions`.
- "Change my matching or schedule preferences" → read the existing preferences, ask for changed values, resubmit the complete seven-field profile, then call `name_watch_apply_preferences` only after the user asks to apply them.
- "Pause it" → `name_watch_pause`.
- Do not delete an agent. No deletion tool is exposed.

## Privacy and provider rules

- The local profile contains identity matching data and the destination email but no API keys, notification tokens, or payment credentials.
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
