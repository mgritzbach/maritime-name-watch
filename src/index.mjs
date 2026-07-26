import { configFromEnv } from "./config.mjs";
import { discoverMentions } from "./discovery.mjs";
import { MaritimeAnalyzer } from "./analyzer.mjs";
import { NameMonitor } from "./monitor.mjs";
import { notifierFromConfig } from "./notifier.mjs";
import { createHttpServer } from "./server.mjs";
import { JsonFileStore } from "./store.mjs";

const config = configFromEnv();
const monitor = new NameMonitor({
  config,
  store: new JsonFileStore(config.statePath),
  discover: discoverMentions,
  analyzer: new MaritimeAnalyzer(config.llm),
  notifier: notifierFromConfig(config)
});
const server = createHttpServer({ monitor, token: config.monitorToken });

server.listen(config.port, "0.0.0.0", () => {
  process.stdout.write(`Maritime Name Watch listening on port ${config.port}\n`);
});

let timer;
if (config.autoRun) {
  const run = () => monitor.tick().catch((error) => process.stderr.write(`[tick-error] ${error.message}\n`));
  run();
  timer = setInterval(run, 60_000);
  timer.unref();
}

function shutdown() {
  if (timer) clearInterval(timer);
  server.close(() => process.exit(0));
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
