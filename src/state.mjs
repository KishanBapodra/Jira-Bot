import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export class StateStore {
  constructor(file) {
    this.file = file;
    this.state = null;
  }

  async load(startedAt = new Date().toISOString()) {
    try {
      this.state = JSON.parse(await readFile(this.file, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      this.state = { version: 1, startedAt, issues: {} };
      await this.save();
    }
    return this.state;
  }

  getIssue(key) {
    return this.state.issues[key];
  }

  async updateIssue(key, patch) {
    const previous = this.state.issues[key] ?? {};
    this.state.issues[key] = {
      ...previous,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    await this.save();
    return this.state.issues[key];
  }

  async save() {
    await mkdir(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(this.state, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, this.file);
  }
}
