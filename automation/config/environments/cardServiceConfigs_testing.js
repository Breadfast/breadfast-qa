'use strict';

/**
 * Card Service — testing environment configuration.
 * Mirrors: resources/environments/cardServiceConfigs_testing.properties
 */
module.exports = {
  adminUserName:                'agent',
  adminPassword:                'Admin@123456789',
  cardServicesAdminPanelBaseURL: 'https://card-panel-testing.breadfast.tech',

  // Card backend that runs the cashback cron (B10-55185)
  cardBackendBaseURL:           'https://card-backend-testing.breadfast.tech',

  // DB + SSH settings are read from the Java framework's config_testing.properties
  // (single source of truth; no secrets duplicated here). Override path if needed.
  bfPropertiesPath:             'D:\\projects\\resources\\environments\\config_testing.properties',

  // Test mobile whose purchases we seed/adjust for cashback scenarios.
  testMobileNumber:             '+201155558882',
};
