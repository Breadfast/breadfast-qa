# automation/config — credentials & environment config

Shared config used across **all** stories.

## Files
| File | Committed? | Purpose |
|------|-----------|---------|
| `credentials.js` | ✅ yes (no secrets) | Loader. Resolves each value from **env var → `credentials.local.js` → helpful error**. |
| `credentials.local.example.js` | ✅ yes | Template. Copy it and fill in your own values. |
| `credentials.local.js` | ❌ **gitignored** | Your real secrets on this machine. Never commit/share. |
| `figma.js` | ✅ yes | Figma REST token (env `FIGMA_API_TOKEN` or fallback). |
| `environments/cardServiceConfigs_testing.js` | ✅ yes | Card Portal base URL + agent login. |

## Setup (new colleague)
```bash
cp automation/config/credentials.local.example.js automation/config/credentials.local.js
# then edit credentials.local.js with YOUR OWN:
#  - jiraEmail + jiraApiToken   (id.atlassian.com > Security > API tokens)
#  - browserstackEmail + browserstackPassword
```
Or set environment variables instead (preferred on CI / shared machines):
`JIRA_EMAIL`, `JIRA_API_TOKEN`, `BROWSERSTACK_EMAIL`, `BROWSERSTACK_PASSWORD`
(optional: `JIRA_BASE_URL`, `JIRA_CLOUD_ID`, `BS_TM_USERNAME`, `BS_TM_API_TOKEN`).
Env vars win over `credentials.local.js`.

## Usage
```js
const creds = require('./automation/config/credentials'); // adjust relative path

// Jira REST (e.g. attach evidence — the Atlassian MCP has no attachment tool):
await fetch(`${creds.jira.baseUrl}/rest/api/3/issue/${key}/attachments`, {
  method: 'POST',
  headers: { Authorization: creds.jira.authHeader(), 'X-Atlassian-Token': 'no-check' },
  body: form,
});

// BrowserStack UI login (Playwright-driven Test Management CSV import):
await page.fill('#email', creds.browserstack.email());
await page.fill('#password', creds.browserstack.password());
```
A missing credential throws a clear message telling you exactly which env var / local key to set.
