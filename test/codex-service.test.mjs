import test from "node:test";
import assert from "node:assert/strict";
import {
  AUTH_CONFIRMATION,
  DEPLOY_CONFIRMATION,
  MemoryProfileStore,
  NameWatchCodexService,
  REPOSITORY_URL
} from "../src/codex-service.mjs";

class FakeMaritime {
  constructor() {
    this.calls = [];
    this.created = false;
    this.authMethod = "jwt";
  }

  async run(args, options = {}) {
    this.calls.push({ args, input: options.input ?? "" });
    const command = args.join(" ");
    if (command === "whoami --json") {
      return {
        authenticated: true,
        expired: false,
        method: this.authMethod,
        name: "Test User",
        email: "test@example.com",
        expiresAt: this.authMethod === "jwt" ? "2026-08-25T00:00:00Z" : null
      };
    }
    if (args[0] === "keys" && args[1] === "create") {
      return { raw_key: "mk_secret_value_not_for_output", key_prefix: "mk_secret" };
    }
    if (args[0] === "login") {
      this.authMethod = "api_key";
      return { ok: true };
    }
    if (command === "list --json") {
      return this.created ? [{
        id: "agent-1",
        name: "maritime-name-watch",
        status: "active",
        framework: "custom",
        publicUrl: "https://example.test/agent",
        computeMinutesLimit: 60
      }] : [];
    }
    if (args[0] === "create") {
      this.created = true;
      return { id: "agent-1", status: "deploying" };
    }
    if (args[0] === "env" && args[1] === "list") {
      return [{ key: "OPENAI_API_KEY", value: "••••" }];
    }
    if (args[0] === "triggers" && args[1] === "list") return [];
    if (args[0] === "triggers" && args[1] === "create") return { id: "trigger-1" };
    if (args[0] === "env" && args[1] === "import") return { ok: true };
    if (args[0] === "restart") return { ok: true };
    throw new Error(`Unexpected fake Maritime command: ${command}`);
  }
}

async function configuredService() {
  const maritime = new FakeMaritime();
  const profileStore = new MemoryProfileStore();
  const service = new NameWatchCodexService({
    maritime,
    profileStore,
    now: () => new Date("2026-07-26T20:00:00Z"),
    sleep: async () => {}
  });
  await service.savePreferences({
    name: "Jane Doe",
    aliases: ["J. Doe"],
    contextTerms: ["Acme", "Seattle"],
    excludeTerms: ["football"],
    checksPerDay: 24,
    maxAnalysesPerDay: 8,
    destinationEmail: "alerts@example.com",
    maxNewPerRun: 10
  });
  return { service, maritime, profileStore };
}

test("saves only non-secret profile data and runs a read-only preflight", async () => {
  const { service, maritime, profileStore } = await configuredService();
  const profile = await profileStore.read();
  assert.equal(profile.name, "Jane Doe");
  assert.equal(profile.checksPerDay, 24);
  assert.equal(profile.destinationEmail, "alerts@example.com");
  const preferences = await service.getPreferences();
  assert.equal(preferences.emailDelivery.configured, false);
  assert.equal(JSON.stringify(profile).includes("token"), false);
  const result = await service.preflight({});
  assert.equal(result.ready, true);
  assert.equal(result.existingAgent, null);
  assert.equal(result.requiredDeploymentConfirmation, DEPLOY_CONFIRMATION);
  assert.deepEqual(maritime.calls.map((call) => call.args.slice(0, 2)), [
    ["whoami", "--json"],
    ["list", "--json"]
  ]);
});

test("first setup refuses defaults, weak context, and invalid destination email", async () => {
  const service = new NameWatchCodexService({
    profileStore: new MemoryProfileStore(),
    maritime: new FakeMaritime()
  });
  await assert.rejects(() => service.savePreferences({
    name: "Jane Doe",
    aliases: [],
    contextTerms: ["Acme", "Seattle"],
    excludeTerms: [],
    maxAnalysesPerDay: 8,
    destinationEmail: "alerts@example.com"
  }), /checksPerDay is required/);
  await assert.rejects(() => service.savePreferences({
    name: "Jane Doe",
    aliases: [],
    contextTerms: ["Acme"],
    excludeTerms: [],
    checksPerDay: 24,
    maxAnalysesPerDay: 8,
    destinationEmail: "not-an-email"
  }), /at least two identity clues/);
  await assert.rejects(() => service.savePreferences({
    name: "Jane Doe",
    aliases: [],
    contextTerms: ["Acme", "Seattle"],
    excludeTerms: [],
    checksPerDay: 24,
    maxAnalysesPerDay: 8,
    destinationEmail: "not-an-email"
  }), /valid email address/);
});
test("deployment refuses missing financial confirmation", async () => {
  const { service, maritime } = await configuredService();
  await assert.rejects(() => service.deploy({
    confirmation: "yes",
    confirmPrepaidCreditsOnly: true,
    confirmNoOveragesOrAutoRecharge: true,
    maxComputeMinutes: 60
  }), /exact confirmation/);
  assert.equal(maritime.calls.length, 0);
});

test("confirmed deployment pins repository, limits, Maritime LLM, and hourly trigger", async () => {
  const { service, maritime } = await configuredService();
  const result = await service.deploy({
    confirmation: DEPLOY_CONFIRMATION,
    confirmPrepaidCreditsOnly: true,
    confirmNoOveragesOrAutoRecharge: true,
    maxComputeMinutes: 60
  });
  assert.equal(result.deployed, true);
  assert.equal(result.maritimeOnly, true);
  const create = maritime.calls.find((call) => call.args[0] === "create");
  assert.ok(create);
  assert.ok(create.args.includes(REPOSITORY_URL));
  assert.ok(create.args.includes("--max-compute"));
  assert.ok(create.args.some((arg) => arg.startsWith("MONITOR_TOKEN=")));
  assert.equal(create.args.some((arg) => /ANTHROPIC|OPENROUTER/.test(arg)), false);
  assert.ok(maritime.calls.some((call) => (
    call.args[0] === "triggers" && call.args[1] === "create" && call.args.includes("17 * * * *")
  )));
});

test("durable auth never returns the raw Maritime key", async () => {
  const { service, maritime } = await configuredService();
  const result = await service.enableDurableAuth({ confirmation: AUTH_CONFIRMATION });
  assert.equal(result.enabled, true);
  assert.equal(result.rawKeyReturned, false);
  assert.equal(JSON.stringify(result).includes("mk_secret_value_not_for_output"), false);
  const login = maritime.calls.find((call) => call.args[0] === "login");
  assert.equal(login.args[2], "mk_secret_value_not_for_output");
});

test("notification credentials are sent to Maritime but not added to the profile", async () => {
  const { service, maritime, profileStore } = await configuredService();
  maritime.created = true;
  await service.configureNotifications({
    channel: "telegram",
    telegramBotToken: "telegram-secret",
    telegramChatId: "12345"
  });
  const imported = maritime.calls.find((call) => call.args[0] === "env" && call.args[1] === "import");
  assert.match(imported.input, /TELEGRAM_BOT_TOKEN=telegram-secret/);
  assert.equal(JSON.stringify(await profileStore.read()).includes("telegram-secret"), false);
});
