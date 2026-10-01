#!/usr/bin/env node
import { access, constants } from "node:fs/promises";
import { loadConfig } from "../src/config.mjs";
import { run } from "../src/commands.mjs";
import { JiraClient } from "../src/jira.mjs";

const config = await loadConfig();
const checks = [];

await check("repository is writable", async () => access(config.repository.path, constants.R_OK | constants.W_OK));
await check("origin remote exists", async () => {
  const result = await run(config.commands.git, ["remote", "get-url", "origin"], { cwd: config.repository.path });
  if (!result.stdout.trim()) throw new Error("origin has no URL");
});
await check("base branch exists on origin", async () => {
  await run(config.commands.git, ["ls-remote", "--exit-code", "--heads", "origin", config.repository.baseBranch], {
    cwd: config.repository.path,
  });
});
await check("GitHub CLI authentication", async () => {
  await run(config.commands.gh, ["auth", "status", "--hostname", "github.com"]);
});
await check("Codex CLI authentication", async () => {
  await run(config.commands.codex, ["login", "status"]);
});
await check("Jira credentials and project access", async () => {
  const jira = new JiraClient({
    siteUrl: config.jira.siteUrl,
    email: config.jira.email,
    apiToken: config.jiraApiToken,
    projectKey: config.jira.projectKey,
  });
  await jira.verify();
});

for (const item of checks) console.log(`${item.ok ? "✓" : "✗"} ${item.name}${item.error ? ` — ${item.error}` : ""}`);
if (checks.some((item) => !item.ok)) process.exitCode = 1;

async function check(name, operation) {
  try {
    await operation();
    checks.push({ name, ok: true });
  } catch (error) {
    checks.push({ name, ok: false, error: error.message });
  }
}
