import { normalizeIssue } from "./text.mjs";

export class JiraClient {
  constructor({ siteUrl, email, apiToken, projectKey, fetchImpl = fetch }) {
    this.siteUrl = siteUrl.replace(/\/$/, "");
    this.projectKey = projectKey.toUpperCase();
    this.fetch = fetchImpl;
    this.authorization = `Basic ${Buffer.from(`${email}:${apiToken}`).toString("base64")}`;
  }

  async request(path, options = {}) {
    const response = await this.fetch(`${this.siteUrl}${path}`, {
      ...options,
      headers: {
        Accept: "application/json",
        Authorization: this.authorization,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
    });
    const text = await response.text();
    const body = text ? safeJson(text) : null;
    if (!response.ok) {
      const detail = body?.errorMessages?.join("; ") || body?.message || text || response.statusText;
      throw new Error(`Jira API ${response.status}: ${detail}`);
    }
    return body;
  }

  async verify() {
    const [user, project] = await Promise.all([
      this.request("/rest/api/3/myself"),
      this.request(`/rest/api/3/project/${encodeURIComponent(this.projectKey)}`),
    ]);
    return { user, project };
  }

  async findIssuesCreatedSince(isoTime) {
    // Jira interprets JQL dates in the user's timezone. A 24-hour overlap plus
    // exact client-side ISO filtering prevents timezone edges from losing work.
    const overlap = new Date(new Date(isoTime).getTime() - 24 * 60 * 60 * 1000);
    const jqlDate = formatJqlDate(overlap);
    const jql = `project = "${this.projectKey.replaceAll('"', '\\"')}" AND created >= "${jqlDate}" ORDER BY created ASC`;
    const issues = [];
    let nextPageToken;

    do {
      const page = await this.request("/rest/api/3/search/jql", {
        method: "POST",
        body: JSON.stringify({
          jql,
          fields: ["summary", "description", "issuetype", "priority", "labels", "created"],
          maxResults: 100,
          ...(nextPageToken ? { nextPageToken } : {}),
        }),
      });
      issues.push(...(page.issues ?? []));
      nextPageToken = page.nextPageToken;
    } while (nextPageToken);

    return issues
      .map((issue) => normalizeIssue(issue, this.siteUrl))
      .filter((issue) => new Date(issue.created) >= new Date(isoTime))
      .sort((a, b) => a.created.localeCompare(b.created) || a.key.localeCompare(b.key));
  }

  async addComment(issueKey, message) {
    const body = {
      body: {
        type: "doc",
        version: 1,
        content: [{
          type: "paragraph",
          content: [{ type: "text", text: message.slice(0, 30_000) }],
        }],
      },
    };
    return this.request(`/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }
}

function safeJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function formatJqlDate(date) {
  return date.toISOString().slice(0, 16).replace("T", " ");
}
