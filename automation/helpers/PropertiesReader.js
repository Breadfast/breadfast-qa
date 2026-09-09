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

// Cross-platform: derive from the registered Java framework dir when available
// (BF_JAVA_FRAMEWORK_DIR, set by the platform worker from the Framework Registry),
// else an explicit BF_PROPERTIES_PATH, else the legacy Windows default.
const DEFAULT_PATH =
  process.env.BF_PROPERTIES_PATH ||
  (process.env.BF_JAVA_FRAMEWORK_DIR
    ? path.join(process.env.BF_JAVA_FRAMEWORK_DIR, 'resources', 'environments', 'config_testing.properties')
    : 'D:\\projects\\resources\\environments\\config_testing.properties');

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
      // The card DB is on a DIFFERENT server from the breadfast one, reached through a DIFFERENT
      // jump host, with its own credentials — so each generic key has a `mysqlCardServices*`
      // override, following the convention `mysqlCardServicesDatabaseName` already set. Without
      // them, pointing the generic keys at the card DB breaks every caller that queries
      // breadfast_testing through the same config. (2026-09-08: the generic keys pointed at
      // 10.54.224.3, whose `cards_hades_testing` is an ~11-month-old snapshot with none of the
      // current fixtures and no closure column — so a DB read there answers about the wrong data.)
      host:     p.mysqlCardServicesHost || p.mysqlHost,
      port:     parseInt(p.mysqlCardServicesServerPort || p.mysqlServerPort || '3306', 10),
      user:     p.mysqlCardServicesUserName || p.mysqlUserName,
      password: p.mysqlCardServicesUserPassword || p.mysqlUserPassword,
      // card data lives in the hades DB, not the default breadfast_testing DB
      database: p.mysqlCardServicesDatabaseName || p.mysqlDatabaseName,
    },
    ssh: {
      required:    String(p.sshConnectionRequired).toLowerCase() === 'true',
      host:        p.sshCardServicesHost || p.sshHost,
      // sshPort=0 in config means "use the default 22"
      port:        parseInt(p.sshCardServicesPort || p.sshPort || '0', 10) || 22,
      username:    p.sshCardServicesUserName || p.sshUserName,
      // PASSWORD auth: DbHelper already prefers `ssh.password` over a key, but this reader never
      // surfaced the property, so a password-authenticated jump host could not be configured at all.
      password:    p.sshCardServicesPassword || p.sshPassword || undefined,
      keyPath:     p.sshCardServicesKeyPath || p.sshKeyPath,
      keyProtected: String(p.isSshKeyProtected).toLowerCase() === 'true',
      passphrase:  p.sshPassphrase || undefined,
    },
  };
}

module.exports = { load, getCardDbConfig, DEFAULT_PATH };
