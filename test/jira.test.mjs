import test from "node:test";
import assert from "node:assert/strict";
import { JiraClient } from "../src/jira.mjs";

test("searches with the enhanced JQL endpoint and filters the overlap", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({
      issues: [
        { id: "1", key: "APP-1", fields: { summary: "old", created: "2026-01-01T00:00:00.000Z" } },
        { id: "2", key: "APP-2", fields: { summary: "new", created: "2026-01-02T00:00:00.000Z" } },
      ],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const jira = new JiraClient({
    siteUrl: "https://example.atlassian.net",
    email: "person@example.com",
    apiToken: "token",
    projectKey: "app",
    fetchImpl,
  });

  const issues = await jira.findIssuesCreatedSince("2026-01-01T12:00:00.000Z");
  assert.deepEqual(issues.map((issue) => issue.key), ["APP-2"]);
  assert.equal(calls[0].url, "https://example.atlassian.net/rest/api/3/search/jql");
  assert.match(JSON.parse(calls[0].options.body).jql, /project = "APP"/);
  assert.match(calls[0].options.headers.Authorization, /^Basic /);
});

test("surfaces Jira API errors without exposing credentials", async () => {
  const jira = new JiraClient({
    siteUrl: "https://example.atlassian.net",
    email: "person@example.com",
    apiToken: "super-secret",
    projectKey: "APP",
    fetchImpl: async () => new Response(JSON.stringify({ errorMessages: ["No access"] }), { status: 403 }),
  });
  await assert.rejects(jira.verify(), (error) => {
    assert.match(error.message, /Jira API 403: No access/);
    assert.doesNotMatch(error.message, /super-secret/);
    return true;
  });
});
