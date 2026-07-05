'use strict';

const path = require('path');

class ConfigReader {
  constructor() {
    const env = process.env.ENV || 'testing';
    const configPath = path.resolve(
      __dirname,
      `../config/environments/cardServiceConfigs_${env}.js`
    );
    try {
      this._cfg = require(configPath);
    } catch (e) {
      throw new Error(`ConfigReader: cannot load config for env="${env}" at ${configPath}\n${e.message}`);
    }
  }

  getAdminUserName()               { return this._cfg.adminUserName; }
  getAdminPassword()               { return this._cfg.adminPassword; }
  getCardServicesAdminPanelBaseURL() { return this._cfg.cardServicesAdminPanelBaseURL; }
  getCardBackendBaseURL()          { return this._cfg.cardBackendBaseURL; }
  getBfPropertiesPath()            { return this._cfg.bfPropertiesPath; }
  getTestMobileNumber()            { return this._cfg.testMobileNumber; }
}

module.exports = new ConfigReader();
