#!/usr/bin/env node
import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { run } from "../src/commands.mjs";
import { JiraClient } from "../src/jira.mjs";
import { localPaths } from "../src/config.mjs";

const appRoot = process.cwd();
const paths = localPaths(appRoot);
const rl = createInterface({ input: stdin, output: stdout });

console.log("Jira → local Codex → GitHub PR setup\n");
console.log("This one-time setup watches one Jira project and targets this git repository.");

try {
  const repositoryPath = (await run("git", ["rev-parse", "--show-toplevel"], { cwd: appRoot })).stdout.trim();
  const commands = {
    node: process.execPath,
    git: await commandPath("git"),
    gh: await commandPath("gh"),
    codex: await commandPath("codex"),
  };
  const defaultBranch = await discoverDefaultBranch(repositoryPath, commands.git);

  const ghStatus = await run(commands.gh, ["auth", "status", "--hostname", "github.com"], { allowFailure: true });
  if (ghStatus.code !== 0) {
    throw new Error("GitHub CLI is not authenticated. Run `gh auth login`, then run setup again.");
  }

  const codexStatus = await run(commands.codex, ["login", "status"], { allowFailure: true });
  if (codexStatus.code !== 0) {
    throw new Error("Codex CLI is not authenticated. Run `codex login`, then run setup again.");
  }

  const siteInput = await rl.question("Jira site URL (https://example.atlassian.net): ");
  const siteUrl = normalizeSiteUrl(siteInput);
  const email = (await rl.question("Atlassian account email: ")).trim();
  const projectKey = (await rl.question("Jira project key: ")).trim().toUpperCase();
  rl.close();
  const jiraApiToken = process.env.JIRA_API_TOKEN || await hiddenQuestion("Jira API token (input hidden): ");

  if (!email || !projectKey || !jiraApiToken) throw new Error("Jira site, email, project key, and API token are required.");
  if (!/^[A-Z][A-Z0-9_]*$/.test(projectKey)) throw new Error(`Invalid Jira project key: ${projectKey}`);

  process.stdout.write("Verifying Jira access... ");
  const jira = new JiraClient({ siteUrl, email, apiToken: jiraApiToken, projectKey });
  const verified = await jira.verify();
  console.log(`connected as ${verified.user.displayName ?? email}; project ${verified.project.key}.`);

  const startedAt = new Date().toISOString();
  const config = {
    version: 1,
    startedAt,
    jira: { siteUrl, email, projectKey },
    repository: { path: repositoryPath, baseBranch: defaultBranch },
    commands,
    pollIntervalSeconds: 30,
    codexTimeoutMinutes: 90,
    maxAttempts: 3,
  };

  await mkdir(paths.root, { recursive: true, mode: 0o700 });
  await writeFile(paths.config, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  await writeFile(paths.secrets, `${JSON.stringify({ jiraApiToken }, null, 2)}\n`, { mode: 0o600 });
  await chmod(paths.root, 0o700);

  console.log("\nSetup complete. Existing Jira issues were intentionally ignored.");
  console.log("Run `npm run doctor`, then `npm run install-service` to keep the watcher running.");
} finally {
  rl.close();
}

async function commandPath(command) {
  const result = await run("which", [command], { allowFailure: true });
  if (result.code !== 0 || !result.stdout.trim()) {
    throw new Error(`Required command not found: ${command}`);
  }
  return result.stdout.trim().split("\n")[0];
}

async function discoverDefaultBranch(repositoryPath, git) {
  const symbolic = await run(git, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], {
    cwd: repositoryPath,
    allowFailure: true,
  });
  if (symbolic.code === 0) return symbolic.stdout.trim().replace(/^origin\//, "");

  const remote = await run(git, ["remote", "show", "origin"], { cwd: repositoryPath, allowFailure: true });
  const match = remote.stdout.match(/HEAD branch:\s*(\S+)/);
  if (match) return match[1];

  const current = await run(git, ["branch", "--show-current"], { cwd: repositoryPath });
  if (!current.stdout.trim()) throw new Error("Could not determine the repository's base branch.");
  return current.stdout.trim();
}

function normalizeSiteUrl(value) {
  const parsed = new URL(value.trim());
  if (parsed.protocol !== "https:") throw new Error("Jira site URL must use HTTPS.");
  return parsed.origin;
}

async function hiddenQuestion(prompt) {
  if (!stdin.isTTY || !stdin.setRawMode) {
    const secretRl = createInterface({ input: stdin, output: stdout });
    try {
      return (await secretRl.question(prompt)).trim();
    } finally {
      secretRl.close();
    }
  }
  stdout.write(prompt);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  let value = "";
  return new Promise((resolve, reject) => {
    const onData = (character) => {
      if (character === "\u0003") {
        cleanup();
        reject(new Error("Setup cancelled."));
      } else if (character === "\r" || character === "\n") {
        cleanup();
        stdout.write("\n");
        resolve(value.trim());
      } else if (character === "\u007f") {
        value = value.slice(0, -1);
      } else {
        value += character;
      }
    };
    const cleanup = () => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
    };
    stdin.on("data", onData);
  });
}
