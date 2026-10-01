const MAX_DESCRIPTION_CHARS = 20_000;

export function adfToText(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(adfToText).filter(Boolean).join("");
  if (typeof value !== "object") return String(value);

  if (value.type === "text") return value.text ?? "";
  if (value.type === "hardBreak") return "\n";
  const content = adfToText(value.content ?? []);
  if (["paragraph", "heading", "listItem", "blockquote", "codeBlock"].includes(value.type)) {
    return `${content}\n`;
  }
  if (["bulletList", "orderedList", "doc"].includes(value.type)) {
    return content;
  }
  return content;
}

export function normalizeIssue(issue, siteUrl) {
  const fields = issue.fields ?? {};
  const key = String(issue.key ?? "").trim();
  if (!/^[A-Z][A-Z0-9_]+-\d+$/i.test(key)) {
    throw new Error(`Invalid Jira issue key: ${key || "<missing>"}`);
  }

  return {
    id: String(issue.id ?? key),
    key: key.toUpperCase(),
    summary: String(fields.summary ?? "Untitled Jira issue").trim(),
    description: adfToText(fields.description).trim().slice(0, MAX_DESCRIPTION_CHARS),
    issueType: String(fields.issuetype?.name ?? "Task"),
    priority: String(fields.priority?.name ?? "Unspecified"),
    labels: Array.isArray(fields.labels) ? fields.labels.map(String) : [],
    created: fields.created ? new Date(fields.created).toISOString() : new Date().toISOString(),
    url: `${siteUrl.replace(/\/$/, "")}/browse/${encodeURIComponent(key)}`,
  };
}

export function branchName(issue) {
  const slug = issue.summary
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase()
    .slice(0, 42)
    .replace(/-$/, "");
  return `codex/${issue.key.toLowerCase()}${slug ? `-${slug}` : ""}`;
}

export function buildPrompt(issue) {
  return `You are implementing a Jira issue in an isolated git worktree.

Jira issue: ${issue.key}
Type: ${issue.issueType}
Priority: ${issue.priority}
Summary: ${issue.summary}
URL: ${issue.url}

Description:
${issue.description || "No description was provided."}

Requirements:
- Inspect the repository and follow its AGENTS.md and existing conventions.
- Implement only the scope supported by the issue. Make reasonable, conservative assumptions when details are missing.
- Add or update tests for changed behavior and run the relevant checks.
- Do not commit, push, create a pull request, or modify files outside this worktree; the runner handles delivery.
- Do not expose credentials or include secrets in files or output.
- If the issue cannot be implemented safely from the available information, make no code changes and explain the blocker in your final response.

Finish with a concise summary of changes and tests run.`;
}

export function commitSubject(issue) {
  const summary = issue.summary.replace(/[\r\n]+/g, " ").trim();
  return `${issue.key}: ${summary}`.slice(0, 100);
}
