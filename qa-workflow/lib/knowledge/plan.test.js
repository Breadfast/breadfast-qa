'use strict';

// The knowledge plan is the isolation boundary: these tests pin what each kind of team may read.
// Fixture teams live in a temp QA_TEAMS_DIR; the registry is the real one (card-core) or a fixture.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { knowledgePlan, formatPlan, KnowledgePlanError } = require('./plan');

const REPO = path.join(__dirname, '..', '..', '..');
const REAL_REGISTRY = require(path.join(REPO, 'qa-workflow/registry/knowledge.json'));

function teamsDir(profiles) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-teams-'));
  for (const p of profiles) fs.writeFileSync(path.join(dir, `${p.id}.json`), JSON.stringify(p));
  return dir;
}
const profile = (id, domains, surfaces) => ({ id, name: id, domains, surfaces, jira: {}, browserstack: {} });

/** A small registry where every domain has its own file, so leakage would be visible. */
function fixtureRegistry() {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'plan-reg-')), 'knowledge.json');
  fs.writeFileSync(file, JSON.stringify({
    core: ['core/method.md'],
    surfacePacks: { mobile: ['packs/mobile.md'], web: ['packs/web.md'], backend: ['packs/backend.md'] },
    domains: {
      card: { owner: 'card-core', files: ['card/rules.md', { path: 'card/mobile-flows.md', surfaces: ['mobile'] }, { path: 'card/card-panel.md', surfaces: ['web'] }], screens: 'card/screens' },
      payment: { owner: 'card-core', files: ['payment/rules.md', { path: 'payment/mobile-flows.md', surfaces: ['mobile'] }] },
      orders: { owner: 'orders', files: ['orders/rules.md'] },
    },
  }));
  return file;
}
const paths = (plan, layer) => plan.files.filter((f) => !layer || f.layer === layer).map((f) => f.path);

test('Card (real registry): card-core loads its three domains and every core file', () => {
  const plan = knowledgePlan({ teamId: 'card-core' });
  assert.deepEqual(plan.domains, ['card', 'payment', 'marketing']);
  assert.deepEqual(plan.excludedDomains, []);
  for (const p of [...REAL_REGISTRY.core, ...REAL_REGISTRY.catalogs]) assert.ok(paths(plan).includes(p), `core/catalog file missing: ${p}`);
  for (const id of ['card', 'payment', 'marketing']) {
    for (const f of REAL_REGISTRY.domains[id].files) {
      const p = typeof f === 'string' ? f : f.path;
      assert.ok(paths(plan).includes(p), `card-core lost ${id} file ${p}`);
    }
  }
});

test('a payment-only team gets payment files and none of card\'s', () => {
  const reg = fixtureRegistry();
  const dir = teamsDir([profile('payment', ['payment'], ['mobile'])]);
  const plan = knowledgePlan({ teamId: 'payment', teamsDir: dir, registryFile: reg });
  assert.deepEqual(paths(plan, 'domain'), ['payment/rules.md', 'payment/mobile-flows.md']);
  assert.ok(!paths(plan).some((p) => p.startsWith('card/')));
  assert.deepEqual(plan.excludedDomains, ['card', 'orders']);
});

test('a backend-only team gets core + the backend pack + its own domain, nothing mobile', () => {
  const reg = fixtureRegistry();
  const dir = teamsDir([profile('orders', ['orders'], ['backend'])]);
  const plan = knowledgePlan({ teamId: 'orders', teamsDir: dir, registryFile: reg });
  assert.deepEqual(paths(plan), ['core/method.md', 'packs/backend.md', 'orders/rules.md']);
});

test('a team with domains [] gets core + its surface packs only', () => {
  const reg = fixtureRegistry();
  const dir = teamsDir([profile('newteam', [], ['web'])]);
  const plan = knowledgePlan({ teamId: 'newteam', teamsDir: dir, registryFile: reg });
  assert.deepEqual(paths(plan), ['core/method.md', 'packs/web.md']);
  assert.equal(plan.teamContext.exists, false);
});

test('story surfaces filter surface-tagged domain files (a card web-admin story drops mobile flows)', () => {
  const reg = fixtureRegistry();
  const dir = teamsDir([profile('card-core', ['card', 'payment'], ['web', 'mobile', 'backend'])]);
  const plan = knowledgePlan({ teamId: 'card-core', teamsDir: dir, registryFile: reg, storySurfaces: ['web'] });
  assert.ok(paths(plan).includes('card/card-panel.md'));
  assert.ok(!paths(plan).includes('card/mobile-flows.md'));
  assert.ok(!paths(plan).includes('payment/mobile-flows.md'));
  assert.ok(!paths(plan).includes('packs/mobile.md'));
});

test('a story surface outside the team is reported, not silently loaded', () => {
  const reg = fixtureRegistry();
  const dir = teamsDir([profile('orders', ['orders'], ['backend'])]);
  const plan = knowledgePlan({ teamId: 'orders', teamsDir: dir, registryFile: reg, storySurfaces: ['backend', 'mobile'] });
  assert.deepEqual(plan.surfacesOutsideTeam, ['mobile']);
  assert.ok(!paths(plan).includes('packs/mobile.md'));
});

test('an approved cross-domain read adds that domain, with the approver in the reason', () => {
  const reg = fixtureRegistry();
  const dir = teamsDir([profile('payment', ['payment'], ['web'])]);
  const plan = knowledgePlan({ teamId: 'payment', teamsDir: dir, registryFile: reg,
    crossDomains: { card: { approvedBy: 'Lead', reason: 'story touches the card panel' } } });
  const row = plan.files.find((f) => f.path === 'card/card-panel.md');
  assert.ok(row, 'card panel file should load');
  assert.match(row.reason, /cross-domain card \(approved by Lead/);
  assert.deepEqual(plan.crossDomains, ['card']);
});

test('team context is part of its own team\'s plan only', () => {
  const reg = fixtureRegistry();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-root-'));
  const dir = path.join(root, 'teams');
  fs.mkdirSync(path.join(dir, 'orders'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'orders.json'), JSON.stringify(profile('orders', ['orders'], ['backend'])));
  fs.writeFileSync(path.join(dir, 'payment.json'), JSON.stringify(profile('payment', ['payment'], ['web'])));
  fs.writeFileSync(path.join(dir, 'orders', 'context.md'), '# orders\n');
  const orders = knowledgePlan({ teamId: 'orders', teamsDir: dir, registryFile: reg, repoRoot: root });
  assert.deepEqual(paths(orders, 'team'), ['teams/orders/context.md']);
  const payment = knowledgePlan({ teamId: 'payment', teamsDir: dir, registryFile: reg, repoRoot: root });
  assert.deepEqual(paths(payment, 'team'), []);
});

test('invalid profiles fail closed', () => {
  const reg = fixtureRegistry();
  const dir = teamsDir([profile('a', ['nope'], ['web']), profile('b', ['TODO'], ['web']), profile('c', ['card'], ['tv'])]);
  assert.throws(() => knowledgePlan({ teamId: 'a', teamsDir: dir, registryFile: reg }), /unknown domain\(s\): nope/);
  assert.throws(() => knowledgePlan({ teamId: 'b', teamsDir: dir, registryFile: reg }), /not filled in yet/);
  assert.throws(() => knowledgePlan({ teamId: 'c', teamsDir: dir, registryFile: reg }), /unknown value\(s\): tv/);
  assert.throws(() => knowledgePlan({ teamId: 'a', teamsDir: dir, registryFile: reg, storySurfaces: ['x'] }), Error);
  assert.throws(() => knowledgePlan({ teamId: 'missing', teamsDir: dir, registryFile: reg }), /Unknown QA team/);
  assert.throws(() => knowledgePlan({ teamId: 'c', teamsDir: dir, registryFile: '/nonexistent.json' }), KnowledgePlanError);
});

test('formatPlan names what is NOT loaded and how to request it', () => {
  const reg = fixtureRegistry();
  const dir = teamsDir([profile('orders', ['orders'], ['backend'])]);
  const text = formatPlan(knowledgePlan({ teamId: 'orders', teamsDir: dir, registryFile: reg }));
  assert.match(text, /NOT loaded \(other teams' domains\): card, payment/);
  assert.match(text, /qa-cli\.js cross-domain/);
  assert.match(text, /team context: .* MISSING/);
});
