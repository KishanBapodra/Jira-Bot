# Jira → local Codex → pull request

This repository is a configure-once bridge that watches a Jira Cloud project, runs Codex locally for each newly created issue, and opens a GitHub pull request.

```text
Jira Cloud ──outbound polling──► local background service
                                      │
                                      ├─ isolated git worktree
                                      ├─ codex exec (workspace-write sandbox)
                                      └─ git push + gh pr create
```

There is no public webhook, tunnel, hosted worker, or per-issue configuration. The service only makes outbound requests, so source code and Codex execution stay on the developer machine.

## Behavior

- The setup timestamp is the baseline; existing Jira issues are not processed.
- Every issue created later in the selected Jira project is picked up automatically.
- Runs are serialized and isolated in generated git worktrees.
- Branches are deterministic: `codex/<issue-key>-<summary>`.
- A Jira issue is retried up to three times with backoff.
- The runner checks for an existing PR before doing work, so restarts are idempotent.
- Codex edits and tests; the bridge owns committing, pushing, PR creation, and Jira comments.
- Nothing is merged automatically. Human review and repository branch protection remain the final gate.

## Prerequisites

- Node.js 22 or newer
- A git repository with an `origin` remote and a pushed default branch
- [Codex CLI](https://developers.openai.com/codex/cli/) installed and authenticated with `codex login`
- [GitHub CLI](https://cli.github.com/manual/) installed and authenticated with `gh auth login`
- Jira Cloud account email, project key, and an API token with permission to browse and comment on that project

## One-time setup

```bash
npm run setup
npm test
npm run doctor
npm run install-service
```

`setup` asks only for the Jira site, account email, API token, and project key. Repository path, base branch, and executable paths are detected. The token is written with owner-only permissions under `.jira-codex/`, which is ignored by git.

`install-service` installs and starts a per-user LaunchAgent on macOS or a systemd user service on Linux. From then on, creating a Jira issue is enough to start the flow.

For a foreground trial before installing the service:

```bash
npm start
```

## Writing good Jira issues

Codex receives the issue key, summary, description, type, priority, labels, and link. Put acceptance criteria, constraints, and expected behavior in the Jira description. Do not put secrets in Jira issues.

A useful issue has:

```text
Summary: Reject expired password-reset links

Context:
Reset links are currently accepted after their 30-minute lifetime.

Acceptance criteria:
- Expired tokens return HTTP 410.
- Valid tokens continue to work.
- Add tests for both cases.
```

## Operations

Check all integrations:

```bash
npm run doctor
```

Retry a failed issue after correcting the cause:

```bash
npm run retry -- APP-123
```

Local state, worktrees, and macOS service logs live in `.jira-codex/`. A successful run is recorded in `.jira-codex/state.json` and commented back to Jira with its PR URL.

## Why polling instead of a webhook?

Jira Cloud cannot deliver a webhook to `localhost`. A webhook-based local design needs a stable public tunnel, ingress authentication, and either an admin-created webhook or an OAuth app that renews dynamic webhooks. Jira's dynamic webhooks also expire and must be refreshed. Polling avoids that entire public ingress surface and gives a reproducible local install.

The bridge uses Jira's current enhanced JQL search endpoint (`POST /rest/api/3/search/jql`) with overlap and client-side timestamp filtering, so timezone boundaries do not drop issues.

Relevant documentation:

- [Jira Cloud issue search](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-search/)
- [Jira Cloud API-token authentication](https://developer.atlassian.com/cloud/jira/platform/basic-auth-for-rest-apis/)
- [Jira webhook lifecycle and restrictions](https://developer.atlassian.com/cloud/jira/platform/webhooks/)
- [GitHub CLI pull-request creation](https://cli.github.com/manual/gh_pr_create)
- [Codex automation with `codex exec`](https://developers.openai.com/blog/eval-skills)

## Security model

The Jira description is untrusted input. It is passed to Codex as task context, not executed as shell text. Subprocesses use argument arrays rather than a shell. Codex runs with the `workspace-write` sandbox in a generated worktree, while networked git and GitHub operations are performed by fixed runner code.

This is intended as a self-hosted team script. Atlassian recommends OAuth 2.0 (3LO) rather than collecting API tokens for a broadly distributed commercial integration. Turning this into a hosted multi-tenant product should replace local API-token auth with one centrally registered OAuth app, add tenant isolation, signed event ingestion, and a durable job queue.

## Deliberate non-features

- No automatic merge
- No arbitrary commands from Jira fields
- No user-selectable model or sandbox flags
- No public HTTP listener
- No concurrent edits to one repository
- No processing of the pre-existing Jira backlog

Those constraints keep the default safe and make installs behave the same across repositories.
