import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";

test("Codex MCP server advertises the complete Name Watch workflow", async (context) => {
  const child = spawn(process.execPath, [resolve("scripts/codex-mcp-server.mjs")], {
    cwd: resolve("."),
    stdio: ["pipe", "pipe", "pipe"]
  });
  context.after(() => child.kill());
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stdin.write(`${JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-06-18" }
  })}\n`);
  child.stdin.write(`${JSON.stringify({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
    params: {}
  })}\n`);

  for (let attempt = 0; attempt < 50 && output.trim().split("\n").length < 2; attempt += 1) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
  const messages = output.trim().split("\n").filter(Boolean).map(JSON.parse);
  assert.equal(messages[0].result.serverInfo.name, "maritime-name-watch");
  const tools = messages[1].result.tools;
  const names = tools.map((tool) => tool.name);
  const intake = tools.find((tool) => tool.name === "name_watch_save_preferences");
  assert.deepEqual(intake.inputSchema.required, [
    "name",
    "aliases",
    "contextTerms",
    "excludeTerms",
    "checksPerDay",
    "maxAnalysesPerDay",
    "destinationEmail"
  ]);
  assert.equal(intake.inputSchema.properties.contextTerms.minItems, 2);
  assert.deepEqual(intake.inputSchema.properties.discoveryMode.enum, ["full_search", "rss"]);
  for (const expected of [
    "name_watch_save_preferences",
    "name_watch_preflight",
    "name_watch_enable_durable_auth",
    "name_watch_deploy",
    "name_watch_trigger_now",
    "name_watch_mentions",
    "name_watch_pause"
  ]) {
    assert.ok(names.includes(expected), `missing ${expected}`);
  }
  child.stdin.end();
  await once(child, "close");
});
