#!/usr/bin/env node
import { createInterface } from "node:readline";
import {
  NameWatchCodexService,
  AUTH_CONFIRMATION,
  DEPLOY_CONFIRMATION
} from "../src/codex-service.mjs";

const service = new NameWatchCodexService();
const lines = createInterface({ input: process.stdin });

lines.on("line", async (line) => {
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    return;
  }
  if (request.id === undefined) return;
  try {
    let result;
    if (request.method === "initialize") {
      result = {
        protocolVersion: request.params?.protocolVersion ?? "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "maritime-name-watch", version: "0.3.0" }
      };
    } else if (request.method === "tools/list") {
      result = { tools: toolDefinitions() };
    } else if (request.method === "tools/call") {
      result = await callTool(request.params?.name, request.params?.arguments ?? {});
    } else {
      throw new Error(`Unsupported method: ${request.method}`);
    }
    respond({ jsonrpc: "2.0", id: request.id, result });
  } catch (error) {
    respond({
      jsonrpc: "2.0",
      id: request.id,
      result: { content: [{ type: "text", text: error.message }], isError: true }
    });
  }
});

async function callTool(name, args) {
  const methods = {
    name_watch_save_preferences: "savePreferences",
    name_watch_get_preferences: "getPreferences",
    name_watch_preflight: "preflight",
    name_watch_enable_durable_auth: "enableDurableAuth",
    name_watch_deploy: "deploy",
    name_watch_apply_preferences: "applyPreferences",
    name_watch_configure_notifications: "configureNotifications",
    name_watch_status: "status",
    name_watch_mentions: "mentions",
    name_watch_trigger_now: "triggerNow",
    name_watch_pause: "pause"
  };
  const method = methods[name];
  if (!method) throw new Error(`Unknown tool: ${name}`);
  const value = await service[method](args);
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

function toolDefinitions() {
  const agentName = { type: "string", pattern: "^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$" };
  const stringArray = { type: "array", items: { type: "string" } };
  return [
    {
      name: "name_watch_save_preferences",
      description: "Save the complete seven-field non-secret onboarding profile locally. Do not call until every required field was explicitly supplied. This does not mutate Maritime or configure email delivery.",
      inputSchema: {
        type: "object",
        required: ["name", "aliases", "contextTerms", "excludeTerms", "checksPerDay", "maxAnalysesPerDay", "destinationEmail"],
        properties: {
          name: { type: "string" },
          agentName,
          aliases: stringArray,
          contextTerms: { type: "array", minItems: 2, items: { type: "string" } },
          excludeTerms: stringArray,
          requireContext: { type: "boolean" },
          discoveryMode: { enum: ["full_search", "rss"] },
          checksPerDay: { enum: [1, 2, 3, 4, 6, 8, 12, 24] },
          maxAnalysesPerDay: { type: "integer", minimum: 1, maximum: 24 },
          destinationEmail: { type: "string", format: "email" },
          maxNewPerRun: { type: "integer", minimum: 1, maximum: 25 },
          rssUrls: { type: "array", maxItems: 5, items: { type: "string", pattern: "^https://" } }
        }
      }
    },
    {
      name: "name_watch_get_preferences",
      description: "Read the locally saved non-secret Name Watch preferences.",
      inputSchema: { type: "object", properties: {} }
    },
    {
      name: "name_watch_preflight",
      description: "Read-only check of profile completeness, Maritime CLI authentication, existing agents, and required financial safeguards.",
      inputSchema: { type: "object", properties: { agentName } }
    },
    {
      name: "name_watch_enable_durable_auth",
      description: `Create a limited Maritime CLI automation key for browserless future operation. This mutates Maritime authentication and requires the exact confirmation "${AUTH_CONFIRMATION}". The raw key is never returned.`,
      inputSchema: {
        type: "object",
        required: ["confirmation"],
        properties: {
          confirmation: { const: AUTH_CONFIRMATION }
        }
      }
    },    {
      name: "name_watch_deploy",
      description: `Create or update the capped Maritime agent. This mutates Maritime and requires exact user confirmation "${DEPLOY_CONFIRMATION}", prepaid-only confirmation, no-overage/auto-recharge confirmation, and a hard compute cap.`,
      inputSchema: {
        type: "object",
        required: ["confirmation", "confirmPrepaidCreditsOnly", "confirmNoOveragesOrAutoRecharge", "maxComputeMinutes"],
        properties: {
          agentName,
          confirmation: { const: DEPLOY_CONFIRMATION },
          confirmPrepaidCreditsOnly: { const: true },
          confirmNoOveragesOrAutoRecharge: { const: true },
          maxComputeMinutes: { type: "integer", minimum: 15, maximum: 120 },
          updateExisting: { type: "boolean" }
        }
      }
    },
    {
      name: "name_watch_apply_preferences",
      description: "Apply the saved profile to an existing Maritime agent, optionally restarting it. Call only after the user asks to apply changes.",
      inputSchema: {
        type: "object",
        properties: {
          agentName,
          restart: { type: "boolean" }
        }
      }
    },
    {
      name: "name_watch_configure_notifications",
      description: "Configure logs, Telegram, or an HTTPS webhook on an existing agent. Secrets go directly to Maritime and are not saved locally.",
      inputSchema: {
        type: "object",
        required: ["channel"],
        properties: {
          agentName,
          channel: { enum: ["logs", "telegram", "webhook"] },
          telegramBotToken: { type: "string" },
          telegramChatId: { type: "string" },
          webhookUrl: { type: "string", pattern: "^https://" },
          webhookToken: { type: "string" }
        }
      }
    },
    {
      name: "name_watch_status",
      description: "Read Maritime agent status, monitoring totals, sentiment aggregate, trigger state, and last deployment status.",
      inputSchema: { type: "object", properties: { agentName } }
    },
    {
      name: "name_watch_mentions",
      description: "Read recent relevant name mentions and their sentiment history from the deployed agent.",
      inputSchema: {
        type: "object",
        properties: {
          agentName,
          limit: { type: "integer", minimum: 1, maximum: 100 }
        }
      }
    },
    {
      name: "name_watch_trigger_now",
      description: "Run a deduplicated Name Watch discovery and analysis cycle now on the existing Maritime agent.",
      inputSchema: { type: "object", properties: { agentName } }
    },
    {
      name: "name_watch_pause",
      description: "Put the existing Maritime Name Watch agent to sleep. This does not delete it.",
      inputSchema: { type: "object", properties: { agentName } }
    }
  ];
}

function respond(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}
