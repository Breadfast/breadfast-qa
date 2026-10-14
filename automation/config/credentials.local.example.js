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

  // BrowserStack App/Automate hub credentials (bs_helper.js, browserstack-node-sdk).
  // BrowserStack > Account > Settings > Authentication & Security.
  browserstackUsername:  'your-browserstack-username',
  browserstackAccessKey: 'your-browserstack-access-key',

  // Optional: BrowserStack Test Management REST token (if you use the API path).
  // bsTmUsername: 'you@breadfast.com',
  // bsTmApiToken: 'your-tm-api-token',

  // Optional: Figma personal access token — METADATA only (design export goes through the
  // browser-native PNG channel). Figma > Settings > Security > Personal access tokens.
  // figmaApiToken: 'figd_...your-figma-token',

  // Optional: card-panel admin password (else read from the Java framework's
  // cardServiceConfigs_testing.properties). Ask the card squad.
  // cardPanelAdminPassword: '...',

  // Live card-service DB (cards_hades_testing) over the VPN: SSH tunnel host + MySQL account.
  // cardDbSshHost: 'ssh-host', cardDbSshUser: 'your-ssh-user', cardDbSshPassword: '...',
  // cardDbHost: 'db-host', cardDbUser: 'your-db-user', cardDbPassword: '...',

  // Card-service test cron trigger: Authorization JWT + x-auth-token (ask the card squad).
  // cardCronAuthorization: '...', cardCronToken: '...',
};
