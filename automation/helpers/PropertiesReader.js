'use strict';

/**
 * PropertiesReader — reads the Java framework's `config_testing.properties` so the
 * Playwright suite reuses ONE source of truth for DB + SSH settings instead of
 * duplicating credentials into this repo.
 *
 * Default path points at the sibling Java QA framework:
 *   D:\projects\resources\environments\config_testing.properties
 * Override with env var BF_PROPERTIES_PATH if your checkout lives elsewhere.
 *
 * Secrets (DB password, SSH key) therefore stay only in that local, git-ignored
 * file — nothing sensitive is written into the Playwright repo.
 */

const fs   = require('fs');
const path = require('path');

const DEFAULT_PATH =
  process.env.BF_PROPERTIES_PATH ||
  'D:\\projects\\resources\\environments\\config_testing.properties';

let _cache = null;

function load(propsPath = DEFAULT_PATH) {
  if (_cache && _cache.__path === propsPath) return _cache;

  if (!fs.existsSync(propsPath)) {
    throw new Error(
      `PropertiesReader: could not find properties file at "${propsPath}". ` +
      `Set BF_PROPERTIES_PATH to the absolute path of config_testing.properties.`
    );
  }

  const out = { __path: propsPath };
  for (const raw of fs.readFileSync(propsPath, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  _cache = out;
  return out;
}

/** DB + SSH connection settings for the card-services (hades) MySQL DB. */
function getCardDbConfig(propsPath) {
  const p = load(propsPath);
  return {
    db: {
      host:     p.mysqlHost,
      port:     parseInt(p.mysqlServerPort || '3306', 10),
      user:     p.mysqlUserName,
      password: p.mysqlUserPassword,
      // card data lives in the hades DB, not the default breadfast_testing DB
      database: p.mysqlCardServicesDatabaseName || p.mysqlDatabaseName,
    },
    ssh: {
      required:    String(p.sshConnectionRequired).toLowerCase() === 'true',
      host:        p.sshHost,
      // sshPort=0 in config means "use the default 22"
      port:        parseInt(p.sshPort || '0', 10) || 22,
      username:    p.sshUserName,
      keyPath:     p.sshKeyPath,
      keyProtected: String(p.isSshKeyProtected).toLowerCase() === 'true',
      passphrase:  p.sshPassphrase || undefined,
    },
  };
}

module.exports = { load, getCardDbConfig, DEFAULT_PATH };
