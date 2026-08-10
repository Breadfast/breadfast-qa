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

module.exports = {
  adminUserName:                'agent',
  adminPassword:                'Admin@123456789',
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
