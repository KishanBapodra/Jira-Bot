import { access, readFile } from "node:fs/promises";
import path from "node:path";

export const LOCAL_DIR = ".jira-codex";

export function localPaths(appRoot = process.cwd()) {
  const root = path.join(appRoot, LOCAL_DIR);
  return {
    root,
    config: path.join(root, "config.json"),
    secrets: path.join(root, "secrets.json"),
    state: path.join(root, "state.json"),
    worktrees: path.join(root, "worktrees"),
    logs: path.join(root, "logs"),
  };
}

export async function loadConfig(appRoot = process.cwd()) {
  const paths = localPaths(appRoot);
  const [configText, secretsText] = await Promise.all([
    readFile(paths.config, "utf8"),
    readFile(paths.secrets, "utf8"),
  ]).catch((error) => {
    if (error.code === "ENOENT") {
      throw new Error("Not configured. Run `npm run setup` first.");
    }
    throw error;
  });

  const config = JSON.parse(configText);
  const secrets = JSON.parse(secretsText);
  validateConfig(config, secrets);
  return { ...config, ...secrets, appRoot, paths };
}

export function validateConfig(config, secrets) {
  const required = [
    ["jira.siteUrl", config.jira?.siteUrl],
    ["jira.email", config.jira?.email],
    ["jira.projectKey", config.jira?.projectKey],
    ["repository.path", config.repository?.path],
    ["repository.baseBranch", config.repository?.baseBranch],
    ["commands.codex", config.commands?.codex],
    ["commands.git", config.commands?.git],
    ["commands.gh", config.commands?.gh],
    ["jiraApiToken", secrets.jiraApiToken],
  ];

  const missing = required.filter(([, value]) => !value).map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(`Invalid local configuration; missing: ${missing.join(", ")}`);
  }
  if (!Number.isInteger(config.pollIntervalSeconds) || config.pollIntervalSeconds < 10) {
    throw new Error("Invalid local configuration; pollIntervalSeconds must be an integer of at least 10.");
  }
  if (!Number.isInteger(config.codexTimeoutMinutes) || config.codexTimeoutMinutes < 1) {
    throw new Error("Invalid local configuration; codexTimeoutMinutes must be a positive integer.");
  }
  if (!Number.isInteger(config.maxAttempts) || config.maxAttempts < 1) {
    throw new Error("Invalid local configuration; maxAttempts must be a positive integer.");
  }
}

export async function isConfigured(appRoot = process.cwd()) {
  try {
    await access(localPaths(appRoot).config);
    await access(localPaths(appRoot).secrets);
    return true;
  } catch {
    return false;
  }
}
