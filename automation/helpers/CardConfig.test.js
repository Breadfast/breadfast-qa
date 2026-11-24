'use strict';

/**
 * CardConfig must never carry a credential literal (the card DB + SSH passwords were committed as
 * `|| '<literal>'` fallbacks until 2026-11-24). These tests run CardConfig from an ISOLATED temp copy —
 * no real credentials.local.js, fake property files — so they prove the behaviour on a fresh clone.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.join(__dirname, '..', '..');
const FILES = [
  'automation/helpers/CardConfig.js',
  'automation/helpers/PropertiesReader.js',
  'automation/config/credentials.js',
  'automation/config/framework.js',
];

/** A temp tree holding just the modules CardConfig needs, plus fake property files. */
function sandbox(localCredentials) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cardconfig-'));
  for (const f of FILES) {
    fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
    fs.copyFileSync(path.join(REPO, f), path.join(root, f));
  }
  const props = path.join(root, 'props');
  fs.mkdirSync(props);
  fs.writeFileSync(path.join(props, 'config_testing.properties'), 'baseURL=https://example.invalid\n');
  fs.writeFileSync(path.join(props, 'cardServiceConfigs_testing.properties'), 'defaultCardPasscode=000000\n');
  if (localCredentials) {
    fs.writeFileSync(path.join(root, 'automation/config/credentials.local.js'),
      `module.exports = ${JSON.stringify(localCredentials)};\n`);
  }
  return { root, props };
}

/** Run a snippet against the sandboxed CardConfig with a clean env; returns stdout. */
function run(box, snippet, env = {}) {
  const clean = Object.fromEntries(Object.entries(process.env)
    .filter(([k]) => !/^(BF_CARD_|CARD_DB_|QA_FRAMEWORK_PATH|BF_JAVA)/.test(k)));
  return execFileSync(process.execPath, ['-e', `
    const cfg = require(${JSON.stringify(path.join(box.root, 'automation/helpers/CardConfig.js'))});
    ${snippet}`], {
    encoding: 'utf8',
    env: {
      ...clean,
      HOME: box.root, // keeps framework.js from finding a real checkout under ~/projects
      BF_PROPERTIES_PATH: path.join(box.props, 'config_testing.properties'),
      BF_CARD_PROPERTIES_PATH: path.join(box.props, 'cardServiceConfigs_testing.properties'),
      ...env,
    },
  }).trim();
}

const FAKE = {
  cardDbHost: 'db.example.invalid', cardDbUser: 'u', cardDbPassword: 'fake-db-pass',
  cardDbSshHost: 'ssh.example.invalid', cardDbSshUser: 's', cardDbSshPassword: 'fake-ssh-pass',
};

test('requiring CardConfig never throws, even with no card DB configured', () => {
  const box = sandbox(null);
  assert.strictEqual(run(box, 'console.log(cfg.passcode)'), '000000');
});

test('using the card DB with nothing configured throws a named "Missing credential" error', () => {
  const box = sandbox(null);
  const out = run(box, `try { cfg.cardDb; console.log('NO-THROW'); } catch (e) { console.log(e.message.split('\\n')[0]); }`);
  assert.match(out, /^Missing credential: card DB host\.?$/);
});

test('local credentials.local.js keys resolve the card DB', () => {
  const box = sandbox(FAKE);
  const out = JSON.parse(run(box, 'console.log(JSON.stringify(cfg.cardDb))'));
  assert.strictEqual(out.db.password, 'fake-db-pass');
  assert.strictEqual(out.ssh.password, 'fake-ssh-pass');
  assert.strictEqual(out.db.database, 'cards_hades_testing');
});

test('the older BF_CARD_* env names still work, and CARD_DB_* wins over them', () => {
  const box = sandbox(FAKE);
  const legacy = JSON.parse(run(box, 'console.log(JSON.stringify(cfg.cardDb))', { BF_CARD_DB_PASS: 'fake-bf-env' }));
  assert.strictEqual(legacy.db.password, 'fake-bf-env');
  const both = JSON.parse(run(box, 'console.log(JSON.stringify(cfg.cardDb))',
    { BF_CARD_DB_PASS: 'fake-bf-env', CARD_DB_PASSWORD: 'fake-card-env' }));
  assert.strictEqual(both.db.password, 'fake-card-env');
});

test('CardConfig.js and credentials.js carry no `|| "<literal>"` fallback for any card DB value', () => {
  const cardConfig = fs.readFileSync(path.join(REPO, 'automation/helpers/CardConfig.js'), 'utf8');
  assert.ok(!/BF_CARD_[A-Z_]+\s*\|\|\s*['"]/.test(cardConfig), 'CardConfig.js has a literal fallback after a BF_CARD_* lookup');
  assert.ok(/get cardDb\(\)/.test(cardConfig), 'cardDb must be a lazy getter');
  const creds = fs.readFileSync(path.join(REPO, 'automation/config/credentials.js'), 'utf8');
  const block = creds.slice(creds.indexOf('cardDb: {'), creds.indexOf('cardCron: {'));
  assert.ok(!/(Password|Host|User)'\)\s*\|\|\s*['"]/.test(block), 'credentials.js cardDb has a literal fallback');
});
