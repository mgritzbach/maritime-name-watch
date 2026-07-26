import { spawn } from "node:child_process";
import { join } from "node:path";

export class MaritimeCli {
  constructor({ command, prefixArgs, timeoutMs = 300_000 } = {}) {
    const windowsCli = process.env.MARITIME_CLI_JS
      ?? join(process.env.APPDATA ?? "", "npm", "node_modules", "maritime-cli", "dist", "index.js");
    this.command = command ?? (process.platform === "win32" ? process.execPath : "maritime");
    this.prefixArgs = prefixArgs ?? (process.platform === "win32" ? [windowsCli] : []);
    this.timeoutMs = timeoutMs;
  }

  run(args, { input = "", timeoutMs = this.timeoutMs } = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn(this.command, [...this.prefixArgs, ...args], {
        shell: false,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"]
      });
      let stdout = "";
      let stderr = "";
      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error(`Maritime command timed out after ${timeoutMs} ms`));
      }, timeoutMs);
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.on("error", (error) => {
        clearTimeout(timeout);
        reject(new Error(`Could not run Maritime CLI: ${error.message}`));
      });
      child.on("close", (code) => {
        clearTimeout(timeout);
        if (code !== 0) {
          const detail = parseMaybeJson(stderr) ?? parseMaybeJson(stdout);
          const message = detail?.error?.message ?? detail?.message ?? stderr.trim() ?? stdout.trim();
          reject(new Error(`Maritime CLI failed (${code}): ${String(message).slice(0, 600)}`));
          return;
        }
        resolve(parseMaybeJson(stdout) ?? stdout.trim());
      });
      child.stdin.end(input);
    });
  }
}

function parseMaybeJson(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
