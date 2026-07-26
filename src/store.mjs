import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export function emptyState() {
  return {
    version: 1,
    lastRunAt: null,
    nextRunAt: null,
    mentions: {},
    usageByDay: {},
    recentRuns: []
  };
}

export class JsonFileStore {
  #queue = Promise.resolve();

  constructor(path) {
    this.path = path;
  }

  async read() {
    try {
      return normalizeState(JSON.parse(await readFile(this.path, "utf8")));
    } catch (error) {
      if (error.code === "ENOENT") return emptyState();
      throw error;
    }
  }

  mutate(mutator) {
    const operation = this.#queue.then(async () => {
      const state = await this.read();
      const result = await mutator(state);
      await mkdir(dirname(this.path), { recursive: true });
      const temporary = `${this.path}.${process.pid}.tmp`;
      await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
      await rename(temporary, this.path);
      return result;
    });
    this.#queue = operation.catch(() => {});
    return operation;
  }
}

export class MemoryStore {
  constructor(state = emptyState()) {
    this.state = structuredClone(state);
  }

  async read() {
    return structuredClone(this.state);
  }

  async mutate(mutator) {
    return mutator(this.state);
  }
}

function normalizeState(value) {
  const base = emptyState();
  return {
    ...base,
    ...value,
    mentions: value?.mentions && typeof value.mentions === "object" ? value.mentions : {},
    usageByDay: value?.usageByDay && typeof value.usageByDay === "object" ? value.usageByDay : {},
    recentRuns: Array.isArray(value?.recentRuns) ? value.recentRuns : []
  };
}
