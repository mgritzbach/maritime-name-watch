import { randomBytes } from "node:crypto";
import { MemoryProfileStore, ProfileStore } from "./profile-store.mjs";
import { MaritimeCli } from "./maritime-cli.mjs";

export const REPOSITORY_URL = "https://github.com/mgritzbach/maritime-name-watch";
export const DEPLOY_CONFIRMATION = "USE ONLY MY PREPAID MARITIME CREDITS";
export const AUTH_CONFIRMATION = "CREATE A LIMITED MARITIME AUTOMATION KEY";

export class NameWatchCodexService {
  constructor({
    profileStore = new ProfileStore(),
    maritime = new MaritimeCli(),
    now = () => new Date(),
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  } = {}) {
    Object.assign(this, { profileStore, maritime, now, sleep });
  }

  async savePreferences(input) {
    const existing = await this.profileStore.read();
    const profile = normalizeProfile(input, existing, this.now());
    await this.profileStore.write(profile);
    return {
      saved: true,
      profile: publicProfile(profile),
      privacy: "Stored locally in the Codex profile directory. No credentials are stored."
    };
  }

  async getPreferences() {
    const profile = await this.profileStore.read();
    return profile
      ? { configured: true, profile: publicProfile(profile) }
      : { configured: false, next: "Provide a full name and identity context." };
  }

  async preflight({ agentName } = {}) {
    const profile = requireProfile(await this.profileStore.read());
    const target = validateAgentName(agentName || profile.agentName);
    const identity = await this.maritime.run(["whoami", "--json"]);
    if (!identity?.authenticated || identity?.expired) throw new Error("Maritime CLI is not authenticated or its login has expired");
    const agents = await this.maritime.run(["list", "--json"]);
    const existing = Array.isArray(agents) ? agents.find((agent) => agent.name === target) : null;
    return {
      ready: true,
      authenticatedAs: {
        name: identity.name ?? null,
        email: identity.email ?? null,
        method: identity.method ?? null,
        expiresAt: identity.expiresAt ?? null
      },
      profile: publicProfile(profile),
      targetAgent: target,
      existingAgent: existing ? safeAgent(existing) : null,
      repository: REPOSITORY_URL,
      requiredDeploymentConfirmation: DEPLOY_CONFIRMATION,
      financialGuard: {
        prepaidCreditsOnly: true,
        overagesMustBeDisabled: true,
        autoRechargeMustBeDisabled: true,
        maximumComputeMinutesAllowedByPlugin: 120
      },
      mutatesMaritime: false
    };
  }

  async enableDurableAuth({ confirmation } = {}) {
    if (confirmation !== AUTH_CONFIRMATION) {
      throw new Error(`Durable authentication requires the exact confirmation: ${AUTH_CONFIRMATION}`);
    }
    const identity = await this.maritime.run(["whoami", "--json"]);
    if (!identity?.authenticated || identity?.expired) {
      throw new Error("An active Maritime login is required before creating a limited automation key");
    }
    const created = await this.maritime.run([
      "keys",
      "create",
      "--name",
      "codex-maritime-name-watch",
      "--scopes",
      "provision,deploy,secrets",
      "--json"
    ]);
    let rawKey = created?.raw_key ?? created?.rawKey ?? created?.key;
    if (!rawKey) throw new Error("Maritime did not return the newly created automation key");
    const prefix = created?.key_prefix ?? created?.keyPrefix ?? String(rawKey).slice(0, 10);
    try {
      await this.maritime.run(["login", "--token", rawKey, "--json"]);
    } finally {
      rawKey = null;
    }
    const verified = await this.maritime.run(["whoami", "--json"]);
    if (!verified?.authenticated || verified?.expired) {
      throw new Error("The Maritime CLI did not retain the limited automation key");
    }
    return {
      enabled: true,
      keyPrefix: prefix,
      scopes: ["provision", "deploy", "secrets"],
      storedBy: "Maritime CLI",
      rawKeyReturned: false,
      expiresAt: verified.expiresAt ?? null
    };
  }
  async deploy(input) {
    assertDeploymentConfirmation(input);
    const profile = requireProfile(await this.profileStore.read());
    const agentName = validateAgentName(input.agentName || profile.agentName);
    const maxComputeMinutes = integer(input.maxComputeMinutes, "maxComputeMinutes", 15, 120);
    await this.preflight({ agentName });
    const agents = await this.maritime.run(["list", "--json"]);
    const existing = Array.isArray(agents) ? agents.find((agent) => agent.name === agentName) : null;
    const monitorToken = randomBytes(24).toString("hex");
    const envPairs = environmentPairs(profile, monitorToken);

    if (!existing) {
      await this.maritime.run([
        "create",
        agentName,
        "--json",
        "--repo",
        REPOSITORY_URL,
        "--branch",
        "main",
        "--public",
        "--port",
        "8787",
        "--idle",
        "300",
        "--max-compute",
        String(maxComputeMinutes),
        "-e",
        ...envPairs
      ]);
    } else {
      if (!input.updateExisting) {
        throw new Error(`Agent ${agentName} already exists. Set updateExisting true only after the user confirms updating it.`);
      }
      await this.#importEnvironment(agentName, envPairs);
      await this.maritime.run([
        "deploy",
        agentName,
        "--source",
        "github",
        "--repo",
        REPOSITORY_URL,
        "--branch",
        "main",
        "--wait",
        "--json"
      ]);
    }

    const finalAgent = await this.#waitForAgent(agentName);
    const env = await this.maritime.run(["env", "list", agentName, "--json"]);
    const envKeys = new Set(Array.isArray(env) ? env.map((entry) => entry.key) : []);
    if (!envKeys.has("OPENAI_API_KEY") && !envKeys.has("MARITIME_LLM_TOKEN")) {
      throw new Error("The agent was created, but Maritime did not inject its LLM proxy token. No external provider fallback is allowed.");
    }
    await this.#ensureCron(agentName);
    return {
      deployed: true,
      agent: safeAgent(finalAgent),
      repository: REPOSITORY_URL,
      limits: {
        computeMinutes: maxComputeMinutes,
        analysesPerDay: profile.maxAnalysesPerDay,
        newPerRun: profile.maxNewPerRun,
        cadenceMinutes: profile.cadenceMinutes
      },
      maritimeOnly: true,
      monitorTokenStoredOnlyInMaritime: true,
      next: "Call name_watch_trigger_now, then name_watch_status and name_watch_mentions."
    };
  }

  async applyPreferences({ agentName, restart = true } = {}) {
    const profile = requireProfile(await this.profileStore.read());
    const target = validateAgentName(agentName || profile.agentName);
    await this.#requireExistingAgent(target);
    await this.#importEnvironment(target, environmentPairs(profile));
    if (restart) await this.maritime.run(["restart", target, "--json"]);
    return {
      applied: true,
      agentName: target,
      restarted: restart,
      profile: publicProfile(profile)
    };
  }

  async configureNotifications(input) {
    const profile = requireProfile(await this.profileStore.read());
    const target = validateAgentName(input.agentName || profile.agentName);
    await this.#requireExistingAgent(target);
    const channel = String(input.channel ?? "").toLowerCase();
    let pairs;
    if (channel === "telegram") {
      if (!input.telegramBotToken || !input.telegramChatId) {
        throw new Error("Telegram requires telegramBotToken and telegramChatId");
      }
      pairs = [
        `TELEGRAM_BOT_TOKEN=${singleLine(input.telegramBotToken, "telegramBotToken")}`,
        `TELEGRAM_CHAT_ID=${singleLine(input.telegramChatId, "telegramChatId")}`
      ];
    } else if (channel === "webhook") {
      const url = new URL(input.webhookUrl);
      if (url.protocol !== "https:") throw new Error("webhookUrl must use https");
      pairs = [
        `NOTIFY_WEBHOOK_URL=${url.toString()}`,
        ...(input.webhookToken ? [`NOTIFY_WEBHOOK_TOKEN=${singleLine(input.webhookToken, "webhookToken")}`] : [])
      ];
    } else if (channel === "logs") {
      pairs = [];
    } else {
      throw new Error("channel must be logs, telegram, or webhook");
    }
    if (pairs.length) await this.#importEnvironment(target, pairs);
    await this.maritime.run(["restart", target, "--json"]);
    return {
      configured: true,
      agentName: target,
      channel,
      credentialsStoredOnlyInMaritime: true
    };
  }

  async status({ agentName } = {}) {
    const profile = requireProfile(await this.profileStore.read());
    const target = validateAgentName(agentName || profile.agentName);
    const info = await this.maritime.run(["info", target, "--json"]);
    const triggers = await this.maritime.run(["triggers", "list", target, "--json"]);
    let monitor = null;
    if (info?.agent?.status === "active") {
      monitor = await this.#remoteApi(target, "/v1/status");
    }
    return {
      agent: safeAgent(info?.agent ?? info),
      monitor,
      triggers: Array.isArray(triggers) ? triggers : [],
      lastDeploy: safeDeploy(info?.lastDeploy)
    };
  }

  async mentions({ agentName, limit = 20 } = {}) {
    const profile = requireProfile(await this.profileStore.read());
    const target = validateAgentName(agentName || profile.agentName);
    const safeLimit = integer(limit, "limit", 1, 100);
    return this.#remoteApi(target, `/v1/mentions?limit=${safeLimit}`);
  }

  async triggerNow({ agentName } = {}) {
    const profile = requireProfile(await this.profileStore.read());
    const target = validateAgentName(agentName || profile.agentName);
    const result = await this.#remoteApi(target, "/v1/tick?force=true", "POST");
    return { triggered: true, agentName: target, result };
  }

  async pause({ agentName } = {}) {
    const profile = requireProfile(await this.profileStore.read());
    const target = validateAgentName(agentName || profile.agentName);
    await this.#requireExistingAgent(target);
    const result = await this.maritime.run(["sleep", target, "--json"]);
    return { paused: true, agentName: target, maritime: result };
  }

  async #importEnvironment(agentName, pairs) {
    if (!pairs.length) return;
    const input = `${pairs.join("\n")}\n`;
    await this.maritime.run(["env", "import", agentName, "-", "--reload", "--json"], { input });
  }

  async #requireExistingAgent(agentName) {
    const agents = await this.maritime.run(["list", "--json"]);
    const existing = Array.isArray(agents) ? agents.find((agent) => agent.name === agentName) : null;
    if (!existing) throw new Error(`Maritime agent ${agentName} does not exist`);
    return existing;
  }

  async #ensureCron(agentName) {
    const triggers = await this.maritime.run(["triggers", "list", agentName, "--json"]);
    const hasHourly = Array.isArray(triggers) && triggers.some((trigger) => (
      trigger.type === "cron" && (trigger.cron === "17 * * * *" || trigger.schedule === "17 * * * *")
    ));
    if (!hasHourly) {
      await this.maritime.run([
        "triggers",
        "create",
        agentName,
        "--type",
        "cron",
        "--cron",
        "17 * * * *",
        "--json"
      ]);
    }
  }

  async #waitForAgent(agentName) {
    for (let attempt = 0; attempt < 48; attempt += 1) {
      const agents = await this.maritime.run(["list", "--json"]);
      const agent = Array.isArray(agents) ? agents.find((entry) => entry.name === agentName) : null;
      if (!agent) throw new Error(`Maritime agent ${agentName} disappeared during deployment`);
      if (agent.status === "active" || agent.status === "sleeping") return agent;
      if (agent.status === "error" || agent.status === "failed") {
        const info = await this.maritime.run(["info", agentName, "--json"]);
        throw new Error(`Maritime deployment failed: ${safeDeploy(info?.lastDeploy)?.error ?? "unknown error"}`);
      }
      await this.sleep(5_000);
    }
    throw new Error("Maritime deployment did not finish within four minutes");
  }

  async #remoteApi(agentName, path, method = "GET") {
    const script = [
      "(async()=>{",
      "const base='http://127.0.0.1:'+(process.env.PORT||8787);",
      `const response=await fetch(base+${JSON.stringify(path)},{method:${JSON.stringify(method)},headers:{authorization:'Bearer '+process.env.MONITOR_TOKEN}});`,
      "const text=await response.text();",
      "if(!response.ok){console.error(text);process.exit(1)}",
      "process.stdout.write(text)",
      "})().catch(error=>{console.error(error.message);process.exit(1)})"
    ].join("");
    const result = await this.maritime.run(["exec", agentName, "node", "-e", script, "--json"]);
    return unwrapExecJson(result);
  }
}

export { MemoryProfileStore };

function normalizeProfile(input, existing, now) {
  const name = singleLine(input.name ?? existing?.name, "name");
  const profile = {
    version: 1,
    agentName: validateAgentName(input.agentName ?? existing?.agentName ?? "maritime-name-watch"),
    name,
    aliases: stringList(input.aliases ?? existing?.aliases ?? []),
    contextTerms: stringList(input.contextTerms ?? existing?.contextTerms ?? []),
    excludeTerms: stringList(input.excludeTerms ?? existing?.excludeTerms ?? []),
    requireContext: boolean(input.requireContext, existing?.requireContext ?? false),
    cadenceMinutes: integer(input.cadenceMinutes ?? existing?.cadenceMinutes ?? 60, "cadenceMinutes", 30, 1_440),
    maxAnalysesPerDay: integer(input.maxAnalysesPerDay ?? existing?.maxAnalysesPerDay ?? 8, "maxAnalysesPerDay", 1, 24),
    maxNewPerRun: integer(input.maxNewPerRun ?? existing?.maxNewPerRun ?? 10, "maxNewPerRun", 1, 25),
    rssUrls: httpsUrls(input.rssUrls ?? existing?.rssUrls ?? []),
    createdAt: existing?.createdAt ?? now.toISOString(),
    updatedAt: now.toISOString()
  };
  return profile;
}

function environmentPairs(profile, monitorToken) {
  return [
    `WATCH_NAME=${profile.name}`,
    `WATCH_ALIASES=${profile.aliases.join(",")}`,
    `WATCH_CONTEXT=${profile.contextTerms.join(",")}`,
    `EXCLUDE_TERMS=${profile.excludeTerms.join(",")}`,
    `REQUIRE_CONTEXT=${profile.requireContext}`,
    `CHECK_EVERY_MINUTES=${profile.cadenceMinutes}`,
    `MAX_ANALYSES_PER_DAY=${profile.maxAnalysesPerDay}`,
    `MAX_NEW_PER_RUN=${profile.maxNewPerRun}`,
    "PORT=8787",
    "STATE_PATH=/data/state.json",
    "AUTO_RUN=true",
    ...(monitorToken ? [`MONITOR_TOKEN=${monitorToken}`] : []),
    ...profile.rssUrls.slice(0, 5).map((url, index) => `RSS_URL_${index + 1}=${url}`)
  ];
}

function assertDeploymentConfirmation(input) {
  if (input.confirmation !== DEPLOY_CONFIRMATION) {
    throw new Error(`Deployment requires the exact confirmation: ${DEPLOY_CONFIRMATION}`);
  }
  if (input.confirmPrepaidCreditsOnly !== true || input.confirmNoOveragesOrAutoRecharge !== true) {
    throw new Error("Deployment requires explicit prepaid-only and no-overage/auto-recharge confirmation");
  }
}

function requireProfile(profile) {
  if (!profile) throw new Error("Name Watch preferences have not been configured");
  return profile;
}

function publicProfile(profile) {
  return structuredClone(profile);
}

function safeAgent(agent) {
  if (!agent || typeof agent !== "object") return null;
  return {
    id: agent.id ?? null,
    name: agent.name ?? null,
    status: agent.status ?? null,
    framework: agent.framework ?? null,
    tier: agent.tier ?? null,
    publicUrl: agent.publicUrl ?? null,
    totalComputeSeconds: agent.totalComputeSeconds ?? null,
    computeMinutesLimit: agent.computeMinutesLimit ?? null,
    invocationCount: agent.invocationCount ?? null
  };
}

function safeDeploy(deploy) {
  if (!deploy || typeof deploy !== "object") return null;
  return {
    status: deploy.status ?? null,
    startedAt: deploy.startedAt ?? null,
    completedAt: deploy.completedAt ?? null,
    error: String(deploy.errorMessage ?? deploy.errorTitle ?? "").slice(0, 500) || null
  };
}

function validateAgentName(value) {
  const name = singleLine(value, "agentName").toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(name)) {
    throw new Error("agentName must use lowercase letters, numbers, and internal hyphens");
  }
  return name;
}

function singleLine(value, field) {
  const text = String(value ?? "").trim();
  if (!text || /[\r\n=]/.test(text)) throw new Error(`${field} must be a non-empty single-line value without =`);
  return text;
}

function stringList(value) {
  const values = Array.isArray(value) ? value : String(value ?? "").split(",");
  return [...new Set(values.map((entry) => singleLine(entry, "list item")).filter(Boolean))];
}

function httpsUrls(value) {
  return stringListAllowEmpty(value).map((entry) => {
    const url = new URL(entry);
    if (url.protocol !== "https:") throw new Error("RSS URLs must use https");
    return url.toString();
  }).slice(0, 5);
}

function stringListAllowEmpty(value) {
  if (value == null || value === "") return [];
  const values = Array.isArray(value) ? value : String(value).split(",");
  return [...new Set(values.map((entry) => String(entry).trim()).filter(Boolean).map((entry) => singleLine(entry, "list item")))];
}

function integer(value, field, min, max) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new Error(`${field} must be an integer from ${min} to ${max}`);
  }
  return number;
}

function boolean(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === "boolean") return value;
  throw new Error("Boolean preferences must be true or false");
}

function unwrapExecJson(result) {
  if (result && typeof result === "object") {
    for (const key of ["stdout", "output", "result"]) {
      if (typeof result[key] === "string") {
        try { return JSON.parse(result[key]); } catch {}
      }
    }
  }
  if (typeof result === "string") {
    try { return JSON.parse(result); } catch {}
  }
  return result;
}
