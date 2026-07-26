import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";

export function createHttpServer({ monitor, token }) {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://localhost");
      if (request.method === "GET" && url.pathname === "/healthz") {
        return json(response, 200, { ok: true });
      }
      if (request.method === "GET" && url.pathname === "/") {
        return json(response, 200, {
          name: "Maritime Name Watch",
          health: "/healthz",
          api: ["/v1/status", "/v1/mentions", "POST /v1/tick"]
        });
      }
      if (!authorized(request.headers.authorization, request.headers["x-monitor-token"], token)) {
        return json(response, 401, { error: "Unauthorized" });
      }
      if (request.method === "POST" && url.pathname === "/v1/tick") {
        return json(response, 200, await monitor.tick({ force: url.searchParams.get("force") === "true" }));
      }
      if (request.method === "GET" && url.pathname === "/v1/status") {
        return json(response, 200, await monitor.status());
      }
      if (request.method === "GET" && url.pathname === "/v1/mentions") {
        const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? 50)));
        return json(response, 200, { mentions: await monitor.mentions(limit) });
      }
      return json(response, 404, { error: "Not found" });
    } catch (error) {
      return json(response, 500, { error: error.message });
    }
  });
}

export function authorized(bearer, headerToken, expectedToken) {
  const actualToken = bearer?.startsWith("Bearer ") ? bearer.slice(7) : headerToken;
  if (!actualToken || !expectedToken) return false;
  const actual = Buffer.from(String(actualToken));
  const expected = Buffer.from(String(expectedToken));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function json(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}
