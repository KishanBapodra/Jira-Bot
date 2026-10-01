#!/usr/bin/env node
import { loadConfig } from "../src/config.mjs";
import { StateStore } from "../src/state.mjs";

const issueKey = String(process.argv[2] ?? "").trim().toUpperCase();
if (!/^[A-Z][A-Z0-9_]+-\d+$/.test(issueKey)) {
  console.error("Usage: npm run retry -- PROJECT-123");
  process.exit(2);
}

const config = await loadConfig();
const store = new StateStore(config.paths.state);
await store.load(config.startedAt);
if (!store.getIssue(issueKey)) {
  console.error(`${issueKey} has not been seen by this runner.`);
  process.exit(1);
}
await store.updateIssue(issueKey, { status: "failed", attempts: 0, nextRetryAt: new Date().toISOString(), error: null });
console.log(`${issueKey} will be retried on the next poll.`);
