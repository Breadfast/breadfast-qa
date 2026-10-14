'use strict';

/**
 * Card Service — testing environment configuration.
 * Mirrors: resources/environments/cardServiceConfigs_testing.properties
 */
const path = require('path');
const framework = require('../framework');

/**
 * Absolute path to the Java framework's `config_testing.properties` — the source of truth for
 * the DB + SSH secrets, which are deliberately NOT duplicated into this repo.
 *
 * Resolution order (never a bare drive letter — that broke on every machine but one):
 *   1. BF_PROPERTIES_PATH        — explicit full path to the file
 *   2. QA_FRAMEWORK_PATH         — via automation/config/framework.js (the standard resolver)
 *   3. framework.js local default
 * Returns null when the framework cannot be located, so the caller can ask for the location
 * (ask-never-block) instead of dying inside a file read on a path that never existed here.
 */
function resolveBfPropertiesPath() {
  if (process.env.BF_PROPERTIES_PATH) return path.resolve(process.env.BF_PROPERTIES_PATH);
  return framework.environmentsFile('config_testing.properties');
}

/**
 * The card-panel admin password. Never a literal here — this file is tracked by git, and the value
 * rotates (it did between 2026-09-15 and 2026-10-04, which is how a committed copy was found).
 *
 * Resolution order:
 *   1. CARD_PANEL_ADMIN_PASSWORD                 — env
 *   2. `cardPanelAdminPassword` in credentials.local.js (gitignored, per-machine)
 *   3. `adminPassword` in the Java framework's cardServiceConfigs_testing.properties (gitignored),
 *      the documented source of truth this file mirrors
 * Returns undefined when none is set, so the caller can ask for it (ask-never-block).
 */
function resolveAdminPassword() {
  if (process.env.CARD_PANEL_ADMIN_PASSWORD) return process.env.CARD_PANEL_ADMIN_PASSWORD;
  try {
    const local = require('../credentials.local');
    if (local && local.cardPanelAdminPassword) return local.cardPanelAdminPassword;
  } catch (_) { /* no local overrides */ }
  try {
    const file = framework.environmentsFile('cardServiceConfigs_testing.properties');
    const m = file && require('fs').readFileSync(file, 'utf8').match(/^adminPassword=(.*)$/m);
    if (m) return m[1].trim();
  } catch (_) { /* framework not reachable from here */ }
  return undefined;
}

module.exports = {
  adminUserName:                'agent',
  get adminPassword() { return resolveAdminPassword(); },
  cardServicesAdminPanelBaseURL: 'https://card-panel-testing.breadfast.tech',

  // Card backend that runs the cashback cron (B10-55185)
  cardBackendBaseURL:           'https://card-backend-testing.breadfast.tech',

  // DB + SSH settings are read from the Java framework's config_testing.properties
  // (single source of truth; no secrets duplicated here). Resolved, never hardcoded —
  // set QA_FRAMEWORK_PATH (or BF_PROPERTIES_PATH) if your framework is not at the default.
  bfPropertiesPath:             resolveBfPropertiesPath(),

  // Test mobile whose purchases we seed/adjust for cashback scenarios.
  testMobileNumber:             '+201155558882',
};
