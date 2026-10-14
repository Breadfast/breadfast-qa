'use strict';

/**
 * Shared credential loader for the QA Companion (used across all stories).
 *
 * Resolution order for every value:
 *   1. Environment variable   (best for CI / shared machines)
 *   2. credentials.local.js   (gitignored — each person keeps their OWN copy)
 *   3. a helpful error        (tells you exactly what to set)
 *
 * This file contains NO secrets and is safe to commit.
 * A colleague who clones the repo runs:
 *   cp automation/config/credentials.local.example.js automation/config/credentials.local.js
 * then fills in their own Jira API token + BrowserStack login.
 */

let local = {};
try { local = require('./credentials.local'); } catch (_) { /* no local overrides — env vars only */ }

const pick = (envKey, localKey) =>
  (process.env[envKey] != null && process.env[envKey] !== '') ? process.env[envKey] : local[localKey];

const required = (val, label, hint) => {
  if (!val) throw new Error(`Missing credential: ${label}.\n  -> ${hint}`);
  return val;
};

module.exports = {
  jira: {
    baseUrl: pick('JIRA_BASE_URL', 'jiraBaseUrl') || 'https://breadfast.atlassian.net',
    cloudId: pick('JIRA_CLOUD_ID', 'cloudId') || 'breadfast.atlassian.net',
    email()    { return required(pick('JIRA_EMAIL', 'jiraEmail'), 'Jira email',
      'Set env JIRA_EMAIL or jiraEmail in credentials.local.js'); },
    apiToken() { return required(pick('JIRA_API_TOKEN', 'jiraApiToken'), 'Jira API token',
      'Create one at https://id.atlassian.com/manage-profile/security/api-tokens, then set env JIRA_API_TOKEN or jiraApiToken in credentials.local.js'); },
    /** Basic auth header for the Jira Cloud REST API (e.g. attachments the MCP cannot do). */
    authHeader() { return 'Basic ' + Buffer.from(`${this.email()}:${this.apiToken()}`).toString('base64'); },
  },

  browserstack: {
    // Test Management REST token (NOT the App Automate access key — that 401s on the TM API).
    tmUsername() { return pick('BS_TM_USERNAME', 'bsTmUsername') || pick('BROWSERSTACK_USERNAME', 'browserstackUsername'); },
    tmApiToken() { return pick('BS_TM_API_TOKEN', 'bsTmApiToken'); },
    // UI login — used to drive the Test Management CSV import via Playwright (TM REST import is SSO-gated).
    email()    { return required(pick('BROWSERSTACK_EMAIL', 'browserstackEmail'), 'BrowserStack login email',
      'Set env BROWSERSTACK_EMAIL or browserstackEmail in credentials.local.js'); },
    password() { return required(pick('BROWSERSTACK_PASSWORD', 'browserstackPassword'), 'BrowserStack login password',
      'Set env BROWSERSTACK_PASSWORD or browserstackPassword in credentials.local.js'); },
  },

  // Live card-service DB (cards_hades_testing): SSH tunnel through a VPN-routed host, then MySQL.
  // Not the bastion copy in config_testing.properties — that one is a stale snapshot.
  // Returns a DbHelper config: new DbHelper(credentials.cardDb.config()).
  cardDb: {
    config(database = 'cards_hades_testing') {
      const hint = (k, e) => `Set env ${e} or ${k} in credentials.local.js (ask the card squad for the live card-service DB access)`;
      return {
        db: {
          host: required(pick('CARD_DB_HOST', 'cardDbHost'), 'card DB host', hint('cardDbHost', 'CARD_DB_HOST')),
          port: Number(pick('CARD_DB_PORT', 'cardDbPort') || 3306),
          user: required(pick('CARD_DB_USER', 'cardDbUser'), 'card DB user', hint('cardDbUser', 'CARD_DB_USER')),
          password: required(pick('CARD_DB_PASSWORD', 'cardDbPassword'), 'card DB password', hint('cardDbPassword', 'CARD_DB_PASSWORD')),
          database,
        },
        ssh: {
          required: true,
          host: required(pick('CARD_DB_SSH_HOST', 'cardDbSshHost'), 'card DB SSH host', hint('cardDbSshHost', 'CARD_DB_SSH_HOST')),
          port: Number(pick('CARD_DB_SSH_PORT', 'cardDbSshPort') || 22),
          username: required(pick('CARD_DB_SSH_USER', 'cardDbSshUser'), 'card DB SSH user', hint('cardDbSshUser', 'CARD_DB_SSH_USER')),
          password: required(pick('CARD_DB_SSH_PASSWORD', 'cardDbSshPassword'), 'card DB SSH password', hint('cardDbSshPassword', 'CARD_DB_SSH_PASSWORD')),
          readyTimeout: 15000,
        },
      };
    },
  },

  // Card-service test cron trigger: GET <cardServicesBaseURL>/api/v1/web/test?cronJobType=<type>
  // (e.g. subscriptionBillingSweep). It runs the job for every eligible record on testing, not one user.
  cardCron: {
    headers() {
      const hint = k => `Set ${k} in credentials.local.js (ask the card squad for the test cron trigger)`;
      return {
        Authorization: required(pick('CARD_CRON_AUTHORIZATION', 'cardCronAuthorization'), 'card cron Authorization', hint('cardCronAuthorization')),
        'x-auth-token': required(pick('CARD_CRON_TOKEN', 'cardCronToken'), 'card cron x-auth-token', hint('cardCronToken')),
      };
    },
  },
};
