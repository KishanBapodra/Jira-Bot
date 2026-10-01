import { mkdir } from "node:fs/promises";
import { loadConfig } from "./config.mjs";
import { JiraClient } from "./jira.mjs";
import { CodexPrRunner } from "./runner.mjs";
import { StateStore } from "./state.mjs";

const config = await loadConfig();
await mkdir(config.paths.logs, { recursive: true });
const state = new StateStore(config.paths.state);
await state.load(config.startedAt);

const jira = new JiraClient({
  siteUrl: config.jira.siteUrl,
  email: config.jira.email,
  apiToken: config.jiraApiToken,
  projectKey: config.jira.projectKey,
});
const runner = new CodexPrRunner(config);
let stopping = false;

process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

console.log(`Watching Jira project ${config.jira.projectKey} for issues created after ${state.state.startedAt}`);
console.log(`Target repository: ${config.repository.path} (${config.repository.baseBranch})`);

while (!stopping) {
  try {
    await pollOnce();
  } catch (error) {
    console.error(`[poll] ${error.stack ?? error.message}`);
  }
  if (!stopping) await delay(config.pollIntervalSeconds * 1000);
}

async function pollOnce() {
  const issues = await jira.findIssuesCreatedSince(state.state.startedAt);
  for (const issue of issues) {
    if (stopping) return;
    const record = state.getIssue(issue.key);
    if (record?.status === "succeeded") continue;
    if ((record?.attempts ?? 0) >= config.maxAttempts) continue;
    if (record?.nextRetryAt && new Date(record.nextRetryAt) > new Date()) continue;

    const attempts = (record?.attempts ?? 0) + 1;
    await state.updateIssue(issue.key, { status: "running", attempts, issue, error: null });
    console.log(`[${issue.key}] Starting Codex run (attempt ${attempts}/${config.maxAttempts})`);

    try {
      const result = await runner.run(issue);
      await state.updateIssue(issue.key, { status: "succeeded", pullRequest: result, completedAt: new Date().toISOString() });
      console.log(`[${issue.key}] Pull request: ${result.url}`);
      await safeComment(issue.key, `Codex created a pull request for this issue: ${result.url}`);
    } catch (error) {
      const retryMinutes = Math.min(60, 5 * (2 ** (attempts - 1)));
      await state.updateIssue(issue.key, {
        status: "failed",
        error: error.stack ?? error.message,
        nextRetryAt: new Date(Date.now() + retryMinutes * 60_000).toISOString(),
      });
      console.error(`[${issue.key}] ${error.stack ?? error.message}`);
      if (attempts >= config.maxAttempts) {
        await safeComment(issue.key, `The local Codex runner failed after ${attempts} attempts. Run \`npm run retry -- ${issue.key}\` on the runner host after checking its logs.`);
      }
    }
  }
}

async function safeComment(issueKey, message) {
  try {
    await jira.addComment(issueKey, message);
  } catch (error) {
    console.error(`[${issueKey}] Could not add Jira comment: ${error.message}`);
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
