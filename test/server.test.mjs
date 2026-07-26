import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createHttpServer } from "../src/server.mjs";

test("HTTP API exposes health and protects monitor data", async (context) => {
  const monitor = {
    async tick() { return { ok: true }; },
    async status() { return { monitoredName: "Jane Doe" }; },
    async mentions() { return []; }
  };
  const server = createHttpServer({ monitor, token: "1234567890abcdef" });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}`;

  assert.equal((await fetch(`${url}/healthz`)).status, 200);
  assert.equal((await fetch(`${url}/v1/status`)).status, 401);
  const authorized = await fetch(`${url}/v1/status`, {
    headers: { authorization: "Bearer 1234567890abcdef" }
  });
  assert.equal(authorized.status, 200);
  assert.equal((await authorized.json()).monitoredName, "Jane Doe");
  assert.equal((await fetch(`${url}/v1/tick`, {
    method: "POST",
    headers: { "x-monitor-token": "1234567890abcdef" }
  })).status, 200);
});
