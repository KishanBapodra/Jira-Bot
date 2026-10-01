import test from "node:test";
import assert from "node:assert/strict";
import { adfToText, branchName, buildPrompt, normalizeIssue } from "../src/text.mjs";

test("converts Jira ADF descriptions to readable text", () => {
  const doc = {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "First line" }] },
      { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "item" }] }] }] },
    ],
  };
  assert.equal(adfToText(doc).trim(), "First line\nitem");
});

test("normalizes an issue and creates a safe deterministic branch", () => {
  const issue = normalizeIssue({
    id: "10001",
    key: "APP-42",
    fields: { summary: "Fix résumé / login?!", created: "2026-01-02T03:04:05.000Z" },
  }, "https://example.atlassian.net/");
  assert.equal(issue.url, "https://example.atlassian.net/browse/APP-42");
  assert.equal(branchName(issue), "codex/app-42-fix-resume-login");
  assert.match(buildPrompt(issue), /Do not commit, push, create a pull request/);
});

test("rejects malformed issue keys", () => {
  assert.throws(() => normalizeIssue({ key: "../oops", fields: {} }, "https://example.test"), /Invalid Jira issue key/);
});
