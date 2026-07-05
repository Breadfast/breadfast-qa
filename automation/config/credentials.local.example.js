'use strict';

/**
 * TEMPLATE — copy this file to `credentials.local.js` and fill in YOUR OWN credentials.
 *
 *   cp automation/config/credentials.local.example.js automation/config/credentials.local.js
 *
 * `credentials.local.js` is gitignored — never commit real secrets. Prefer environment
 * variables on CI/shared machines; this file is the local-dev convenience fallback.
 */
module.exports = {
  // Jira (Atlassian Cloud) — for REST calls the MCP can't do (e.g. attachments).
  jiraEmail:    'you@breadfast.com',
  jiraApiToken: 'ATATT...your-jira-api-token',   // id.atlassian.com > Security > API tokens

  // BrowserStack — UI login used to drive the Test Management CSV import via Playwright.
  browserstackEmail:    'you@breadfast.com',
  browserstackPassword: 'your-browserstack-password',

  // Optional: BrowserStack Test Management REST token (if you use the API path).
  // bsTmUsername: 'you@breadfast.com',
  // bsTmApiToken: 'your-tm-api-token',
};
