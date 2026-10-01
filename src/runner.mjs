import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { run } from "./commands.mjs";
import { branchName, buildPrompt, commitSubject } from "./text.mjs";

export class CodexPrRunner {
  constructor(config, logger = console) {
    this.config = config;
    this.logger = logger;
  }

  async run(issue) {
    const { repository, commands, paths } = this.config;
    const branch = branchName(issue);
    const priorPr = await this.findPullRequest(branch);
    if (priorPr) return { ...priorPr, branch, reused: true };

    // A prior attempt may have pushed successfully and then lost the response
    // while creating the PR. Recover that completed branch before rerunning Codex.
    if (await this.remoteBranchExists(branch)) {
      try {
        const url = await this.createPullRequest(issue, branch, repository.path);
        return { url, branch, reused: true };
      } catch (error) {
        this.logger.warn?.(`[${issue.key}] Existing remote branch could not be opened as a PR; continuing it: ${error.message}`);
      }
    }

    await mkdir(paths.worktrees, { recursive: true });
    const worktree = path.join(paths.worktrees, issue.key.toLowerCase());
    await this.prepareWorktree(worktree, branch);

    try {
      await this.runCodex(worktree, issue);
      const status = await run(commands.git, ["status", "--porcelain"], { cwd: worktree });
      if (!status.stdout.trim()) {
        throw new Error("Codex completed without making code changes. Review the issue description and runner logs.");
      }

      await run(commands.git, ["add", "--all"], { cwd: worktree });
      await run(commands.git, ["commit", "-m", commitSubject(issue)], { cwd: worktree });
      await run(commands.git, ["push", "--set-upstream", "origin", branch], { cwd: worktree });
      const url = await this.createPullRequest(issue, branch, worktree);
      return { url, branch, reused: false };
    } finally {
      await this.cleanupWorktree(worktree);
    }
  }

  async findPullRequest(branch) {
    const result = await run(this.config.commands.gh, [
      "pr", "list", "--state", "all", "--head", branch, "--limit", "1", "--json", "url,state",
    ], { cwd: this.config.repository.path });
    const prs = JSON.parse(result.stdout || "[]");
    return prs[0] ? { url: prs[0].url, state: prs[0].state } : null;
  }

  async remoteBranchExists(branch) {
    const result = await run(this.config.commands.git, ["ls-remote", "--exit-code", "--heads", "origin", branch], {
      cwd: this.config.repository.path,
      allowFailure: true,
    });
    return result.code === 0;
  }

  async createPullRequest(issue, branch, cwd) {
    const prBody = [
      `Implements [${issue.key}](${issue.url}).`,
      "",
      "This pull request was created by the local Jira → Codex bridge.",
      "",
      "Please review the implementation and CI results before merging.",
    ].join("\n");
    const created = await run(this.config.commands.gh, [
      "pr", "create",
      "--base", this.config.repository.baseBranch,
      "--head", branch,
      "--title", commitSubject(issue),
      "--body", prBody,
    ], { cwd });
    const url = created.stdout.trim().split(/\s+/).find((part) => /^https?:\/\//.test(part));
    if (!url) throw new Error(`GitHub CLI did not return a pull request URL: ${created.stdout.trim()}`);
    return url;
  }

  async prepareWorktree(worktree, branch) {
    const { repository, commands } = this.config;
    await this.cleanupWorktree(worktree);
    await run(commands.git, ["fetch", "--prune", "origin"], { cwd: repository.path });

    const remote = await run(commands.git, ["ls-remote", "--exit-code", "--heads", "origin", branch], {
      cwd: repository.path,
      allowFailure: true,
    });
    if (remote.code === 0) {
      await run(commands.git, ["worktree", "add", "--force", "-B", branch, worktree, `origin/${branch}`], {
        cwd: repository.path,
      });
    } else {
      await run(commands.git, ["worktree", "add", "--force", "-B", branch, worktree, `origin/${repository.baseBranch}`], {
        cwd: repository.path,
      });
    }
  }

  async runCodex(worktree, issue) {
    const log = (chunk) => this.logger.info?.(`[codex:${issue.key}] ${chunk.trimEnd()}`);
    await run(this.config.commands.codex, [
      "exec",
      "--ephemeral",
      "--ignore-user-config",
      "--sandbox", "workspace-write",
      "--cd", worktree,
      "-",
    ], {
      cwd: worktree,
      input: buildPrompt(issue),
      timeoutMs: this.config.codexTimeoutMinutes * 60_000,
      onStderr: log,
    });
  }

  async cleanupWorktree(worktree) {
    const { repository, commands, paths } = this.config;
    const resolved = path.resolve(worktree);
    const root = `${path.resolve(paths.worktrees)}${path.sep}`;
    if (!resolved.startsWith(root)) throw new Error(`Refusing to clean unexpected path: ${resolved}`);

    await run(commands.git, ["worktree", "remove", "--force", resolved], {
      cwd: repository.path,
      allowFailure: true,
    });
    await rm(resolved, { recursive: true, force: true });
    await run(commands.git, ["worktree", "prune"], { cwd: repository.path, allowFailure: true });
  }
}
