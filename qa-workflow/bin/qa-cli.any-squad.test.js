'use strict';

// ANY squad can run the QA process (operator requirement, 2026-11-24: "all squads can work on the
// qa-process — card, payment, growth, shopping, …"). Four squads the repo has never seen bootstrap in a
// temp COPY of the repo, exactly as a real squad would, and must end up isolated from Card AND from each
// other, with Card unchanged.

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.join(__dirname, '..', '..');
const COPY = [
  'CLAUDE.md', 'AGENTS.md', 'README.md', 'docs/ai', 'qa-workflow', '.claude/skills', 'teams',
  'automation/config/team.js', 'automation/config/credentials.js', 'automation/config/framework.js',
  'automation/config/credentials.local.example.js', 'scripts/doctor.mjs', 'scripts/knowledge-isolation.mjs',
  'scripts/knowledge-isolation.allow.json',
];

function repoCopy() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'any-squad-'));
  for (const rel of COPY) fs.cpSync(path.join(REPO, rel), path.join(root, rel), { recursive: true });
  return root;
}

const ROOT = repoCopy();
const CLI = path.join(ROOT, 'qa-workflow/bin/qa-cli.js');
const env = (teamId, extra = {}) => {
  const e = { ...process.env, QA_TEAM: teamId || '', HOME: ROOT, USERPROFILE: ROOT, ...extra };
  for (const k of ['QA_TEAMS_DIR', 'QA_KNOWLEDGE_REGISTRY', 'QA_REPO_GRANTS']) delete e[k];
  return e;
};
const run = (teamId, args, input) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: env(teamId), input: input || '', cwd: ROOT });
const ok = (teamId, args, input) => {
  const r = run(teamId, args, input);
  assert.equal(r.status, 0, `${args.join(' ')} failed:\n${r.stderr}${r.stdout}`);
  return r.stdout;
};
const doctor = (teamId) => JSON.parse(spawnSync(process.execPath, [path.join(ROOT, 'scripts/doctor.mjs'), '--json'],
  { encoding: 'utf8', env: env(teamId), cwd: ROOT }).stdout);
const teamContextRow = (d) => [...d.blocking, ...(d.ask || []), ...d.warnings].find((r) => r.name === 'Team context') || (d.ok.includes('Team context') ? 'ok' : null);

const SQUADS = [
  { id: 'growth', name: 'Growth', surfaces: 'mobile,backend', marker: 'promo_engine_rules', fact: '- First-order cashback offers and referral perks. [confirmed: jira:B10-61234; 2026-11-24]' },
  { id: 'shopping', name: 'Shopping', surfaces: 'mobile,web', marker: 'basket_svc_internal', fact: '- Cart, checkout and order history in the customer app. [tester: shopping lead; 2026-11-24]' },
  { id: 'logistics', name: 'Logistics', surfaces: 'web,backend', marker: 'dispatch_wave_table', fact: '- Picking, packing and dispatch for dark stores. [tester: logistics lead; 2026-11-24]' },
  { id: 'data-platform', name: 'Data Platform', surfaces: 'backend', marker: 'dp_ingest_topic', fact: '- Event ingestion and reporting APIs. [tester: data lead; 2026-11-24]' },
];
const SECTIONS = ['Product', 'Surfaces & locale support', 'Environments', 'Architecture', 'Tech stack', 'Repositories', 'Documentation', 'Test data strategy'];
const contextFor = (s) => `# ${s.name} — team context\n\nverifiedAt: 2026-11-24 · verifiedBy: ${s.name} lead\n\n`
  + SECTIONS.map((h) => `## ${h}\n${h === 'Product' ? s.fact : `- Internal store: \`${s.marker}\`. [inferred: seen in repo layout; 2026-11-24]`}\n`).join('\n')
  + '\n## Integrations & dependencies\n- Checkout can be paid with Breadfast Pay or the BCard. [tester: lead; 2026-11-24]\n'
  + '\n## Open questions / unknowns\n- Which repositories may QA read?\n';

for (const s of SQUADS) {
  test(`squad "${s.id}" bootstraps end-to-end and only ever sees its own knowledge`, () => {
    // 1. Team profile — org-wide values pre-filled, squad values from flags.
    const created = JSON.parse(ok(null, ['team-init', s.id, '--name', s.name, '--surfaces', s.surfaces,
      '--web-squad', `${s.name} Web`, '--web-components', `${s.name} Dashboard`, '--mobile-squad', `${s.name} App`,
      '--mobile-components', `${s.name} App`, '--bs-project', 'PR-77', '--bs-numeric-project', '777', '--bs-folder', '7']));
    assert.deepEqual(created.todo, []);
    const profile = JSON.parse(fs.readFileSync(path.join(ROOT, 'teams', `${s.id}.json`), 'utf8'));
    assert.equal(profile.jira.projectKey, 'B10');
    assert.equal(profile.jira.bugIssueTypeId, '10084');

    // 2. Not onboarded → the doctor asks for onboarding first (it never blocks).
    const before = teamContextRow(doctor(s.id));
    assert.equal(before && before.fix && before.fix.type, 'team-context');

    // 3. Onboarding creates the squad's own domain.
    const dom = JSON.parse(ok(s.id, ['domain-init', s.id, '--owner', s.id, '--description', `${s.name} product`, '--markers', s.marker]));
    assert.equal(dom.registered.owner, s.id);
    assert.equal(dom.addedToTeam, true);
    assert.ok(fs.existsSync(path.join(ROOT, 'qa-workflow/domains', s.id, 'SKILL.md')));

    // 4. Onboarding output: generic vocabulary, its own B10 tickets and named dependencies are all fine.
    fs.mkdirSync(path.join(ROOT, 'teams', s.id), { recursive: true });
    fs.writeFileSync(path.join(ROOT, 'teams', s.id, 'context.md'), contextFor(s));
    fs.writeFileSync(path.join(ROOT, 'teams', s.id, 'repos.json'), '[]');
    assert.match(ok(s.id, ['knowledge-lint', path.join('teams', s.id)]), /OK/);
    assert.equal(teamContextRow(doctor(s.id)), 'ok');

    // 5. The plan: core + its own domain + its context; never Card's, never another new squad's.
    const plan = JSON.parse(ok(s.id, ['knowledge', '--json']));
    assert.deepEqual(plan.domains, [s.id]);
    const files = plan.files.map((f) => f.path);
    assert.ok(files.includes(`qa-workflow/domains/${s.id}/business-rules.md`));
    assert.ok(files.includes(`teams/${s.id}/context.md`));
    assert.ok(!files.some((f) => /qa-workflow\/domains\/(card|payment|marketing)\//.test(f)));
    for (const other of SQUADS.filter((o) => o.id !== s.id)) {
      assert.ok(!files.some((f) => f.includes(`/domains/${other.id}/`) || f.includes(`teams/${other.id}/`)), `${s.id} sees ${other.id}`);
    }

    // 6. A story records the squad's domain by default and cannot record Card's without an approval.
    const story = fs.mkdtempSync(path.join(os.tmpdir(), `${s.id}-story-`));
    ok(s.id, ['init', story, 'B10-70001', '--surfaces', s.surfaces.split(',')[0]]);
    ok(s.id, ['fingerprint-jira', story], JSON.stringify({ updated: '2026-11-24T00:00:00Z', summary: 's', description: 'd', ac: 'a', comments: [] }));
    fs.mkdirSync(path.join(story, 'r')); fs.writeFileSync(path.join(story, 'r/req.md'), 'x');
    const rec = JSON.parse(ok(s.id, ['record', story, 'requirements', '--path', 'r/req.md', '--generator', 'story-analysis@1.0']));
    assert.deepEqual(rec.domains, [s.id]);
    const refused = run(s.id, ['record', story, 'impact', '--path', 'r/req.md', '--generator', 'impact-analysis@1.0', '--domains', 'card']);
    assert.notEqual(refused.status, 0);
    assert.equal(JSON.parse(ok(s.id, ['complete-check', story, '--expect', 'requirements'])).ok, true);
  });
}

test('after all squads onboard: Card is unchanged, squads are isolated from each other, core stays product-free', () => {
  // Card's plan gains nothing from the new squads.
  const card = JSON.parse(ok('card-core', ['knowledge', '--json']));
  assert.deepEqual(card.domains, ['card', 'payment', 'marketing']);
  for (const s of SQUADS) assert.ok(!card.files.some((f) => f.path.includes(`/domains/${s.id}/`)), `card-core sees ${s.id}`);

  // Isolation holds across the whole copy.
  const iso = spawnSync(process.execPath, [path.join(ROOT, 'scripts/knowledge-isolation.mjs')], { encoding: 'utf8', cwd: ROOT });
  assert.equal(iso.status, 0, iso.stdout);

  // A squad's internal identifier pasted into another squad's context, or into core, is caught.
  const [a, b] = SQUADS;
  fs.appendFileSync(path.join(ROOT, 'teams', b.id, 'context.md').replace('context.md', 'context.md'), '');
  const ctx = fs.readFileSync(path.join(ROOT, 'teams', b.id, 'context.md'), 'utf8')
    .replace(b.fact, `${b.fact}\n- Reuses \`${a.marker}\`. [tester: x; 2026-11-24]`);
  fs.writeFileSync(path.join(ROOT, 'teams', b.id, 'context.md'), ctx);
  assert.match(run(b.id, ['knowledge-lint', path.join('teams', b.id)]).stderr, new RegExp(`foreign-domain: mentions domain "${a.id}"`));
  fs.appendFileSync(path.join(ROOT, 'CLAUDE.md'), `\nSee ${a.marker} for details.\n`);
  const leak = spawnSync(process.execPath, [path.join(ROOT, 'scripts/knowledge-isolation.mjs')], { encoding: 'utf8', cwd: ROOT });
  assert.equal(leak.status, 1);
  assert.match(leak.stdout, new RegExp(`domain:${a.id}`));
});

test('team-init and domain-init refuse unsafe input', () => {
  assert.match(run(null, ['team-init', 'Bad Squad']).stderr, /lowercase/);
  assert.match(run(null, ['team-init', 'card-core']).stderr, /already exists/);
  assert.match(run(null, ['team-init', 'x1', '--surfaces', 'tv']).stderr, /unknown surface/);
  assert.match(run(null, ['domain-init', 'card', '--owner', 'card-core']).stderr, /already registered/);
  assert.match(run(null, ['domain-init', 'nope', '--owner', 'no-such-team']).stderr, /Unknown QA team/);
  assert.match(run(null, ['domain-init', 'bad-re', '--owner', 'card-core', '--markers', '(unclosed']).stderr, /not a valid regex/);
});
