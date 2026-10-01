import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import { CodexPrRunner } from "../src/runner.mjs";

const execute = promisify(execFile);

test("runs Codex in a worktree, pushes a branch, and creates a PR", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "jira-codex-runner-"));
  const bare = path.join(root, "origin.git");
  const repository = path.join(root, "repository");
  const bin = path.join(root, "bin");
  const local = path.join(repository, ".jira-codex");
  await mkdir(bin, { recursive: true });
  await git(["init", "--bare", bare]);
  await git(["init", "-b", "main", repository]);
  await git(["config", "user.name", "Test Runner"], repository);
  await git(["config", "user.email", "runner@example.test"], repository);
  await writeFile(path.join(repository, "README.md"), "# Fixture\n");
  await git(["add", "README.md"], repository);
  await git(["commit", "-m", "initial"], repository);
  await git(["remote", "add", "origin", bare], repository);
  await git(["push", "-u", "origin", "main"], repository);

  const codex = path.join(bin, "codex");
  const gh = path.join(bin, "gh");
  await writeFile(codex, "#!/bin/sh\ncat >/dev/null\nprintf 'implemented\\n' > result.txt\n");
  await writeFile(gh, "#!/bin/sh\nif [ \"$1 $2\" = \"pr list\" ]; then printf '[]'; else printf 'https://github.test/example/repo/pull/1\\n'; fi\n");
  await chmod(codex, 0o755);
  await chmod(gh, 0o755);

  const config = {
    repository: { path: repository, baseBranch: "main" },
    commands: { git: "git", gh, codex },
    paths: { worktrees: path.join(local, "worktrees") },
    codexTimeoutMinutes: 1,
  };
  const issue = {
    key: "APP-42",
    summary: "Add generated result",
    description: "Create the requested result.",
    issueType: "Task",
    priority: "Medium",
    url: "https://example.atlassian.net/browse/APP-42",
  };

  const result = await new CodexPrRunner(config, { info() {}, warn() {} }).run(issue);
  assert.equal(result.url, "https://github.test/example/repo/pull/1");
  assert.equal(result.branch, "codex/app-42-add-generated-result");
  const remoteFile = await git(["show", `${result.branch}:result.txt`], bare);
  assert.equal(remoteFile.stdout, "implemented\n");
});

async function git(args, cwd) {
  return execute("git", args, { cwd, encoding: "utf8" });
}
