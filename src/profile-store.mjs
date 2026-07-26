import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export function defaultProfilePath(env = process.env) {
  const directory = env.MARITIME_NAME_WATCH_CONFIG_DIR
    ? resolve(env.MARITIME_NAME_WATCH_CONFIG_DIR)
    : join(homedir(), ".codex", "maritime-name-watch");
  return join(directory, "profile.json");
}

export class ProfileStore {
  constructor(path = defaultProfilePath()) {
    this.path = path;
  }

  async read() {
    try {
      return JSON.parse(await readFile(this.path, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }

  async write(profile) {
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(profile, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600
    });
    await rename(temporary, this.path);
    return profile;
  }
}

export class MemoryProfileStore {
  constructor(profile = null) {
    this.profile = profile ? structuredClone(profile) : null;
  }

  async read() {
    return this.profile ? structuredClone(this.profile) : null;
  }

  async write(profile) {
    this.profile = structuredClone(profile);
    return structuredClone(profile);
  }
}
