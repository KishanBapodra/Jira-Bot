import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { StateStore } from "../src/state.mjs";

test("persists issue state atomically", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "jira-codex-state-"));
  const file = path.join(directory, "state.json");
  const store = new StateStore(file);
  await store.load("2026-01-01T00:00:00.000Z");
  await store.updateIssue("APP-1", { status: "running", attempts: 1 });

  const saved = JSON.parse(await readFile(file, "utf8"));
  assert.equal(saved.startedAt, "2026-01-01T00:00:00.000Z");
  assert.equal(saved.issues["APP-1"].status, "running");
  assert.equal(saved.issues["APP-1"].attempts, 1);
});
