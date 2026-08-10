/**
 * B10-57774 — Step-5 exploratory pass (Mode A) over the CURRENT card-panel build.
 *
 * Why it runs (per exploratory-testing SKILL.md Mode A triggers): AC2 requires the existing perks
 * screens to be unchanged, but nothing documents what "the existing perks list/management screens"
 * actually are; and AC3 promotes three entities that today are only reachable as dialogs inside the
 * perk form. Both are undocumented existing flows — exploring them changes the test cases.
 *
 * Produces observability only: no verdicts, no defects (nothing has been delivered yet to be wrong).
 *
 *   node B10-57774/automation/explore/explore-current-nav.js
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const cfg = require('../../../automation/config/environments/cardServiceConfigs_testing.js');

const BASE = cfg.cardServicesAdminPanelBaseURL;
const SHOTS = path.resolve(__dirname, '../../screenshots/exploratory');
const OUT = path.resolve(__dirname, 'explore-current-nav.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const findings = { base: BASE, sidebar: null, routes: {}, perkForm: null, notes: [] };

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  // headless on purpose: a headed window would steal focus from the concurrent Figma
  // Ctrl+Shift+C capture, whose copy only lands while its own window is frontmost.
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();

  // --- login ---------------------------------------------------------------
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await sleep(4000);
  await page.screenshot({ path: path.join(SHOTS, '00_login.png') });
  // the panel's login form: username + password inputs, then submit
  const user = page.locator('input[name="username"], input[formcontrolname="username"], input[type="text"]').first();
  await user.fill(cfg.adminUserName);
  await page.locator('input[type="password"]').first().fill(cfg.adminPassword);
  await page.locator('button[type="submit"], button:has-text("Login"), button:has-text("Sign in")').first().click();
  await sleep(9000);
  console.log('after login:', page.url());
  await page.screenshot({ path: path.join(SHOTS, '01_after_login.png'), fullPage: false });

  // --- the sidebar as it exists TODAY --------------------------------------
  const navText = await page.evaluate(() => {
    const items = [...document.querySelectorAll('nav a, aside a, .sidebar a, ul li a')];
    return items.map((a) => ({
      text: (a.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60),
      href: a.getAttribute('href'),
      cls: a.className && String(a.className).slice(0, 60),
    })).filter((x) => x.text);
  });
  findings.sidebar = navText;
  console.log(`\nsidebar links (${navText.length}):`);
  navText.forEach((n) => console.log('  ', JSON.stringify(n.text), '→', n.href));

  // does anything read "Card perks", and is it a link or a parent?
  const perksNav = navText.filter((n) => /perk/i.test(n.text));
  findings.notes.push(`nav items matching /perk/i: ${JSON.stringify(perksNav)}`);
  const merchNav = navText.filter((n) => /merchant/i.test(n.text));
  findings.notes.push(`nav items matching /merchant/i: ${JSON.stringify(merchNav)}`);

  await page.screenshot({ path: path.join(SHOTS, '02_sidebar.png') });

  // --- walk the routes AC2 must keep reachable ----------------------------
  const targets = [
    ['perks_list', '/#/perks'],
    ['perk_create', '/#/perks/create'],
    ['perks_merchants_guess', '/#/perks/merchants'],
    ['perks_categories_guess', '/#/perks/categories'],
    ['perks_mobile_sections_guess', '/#/perks/mobile-sections'],
  ];
  for (const [name, route] of targets) {
    await page.goto(BASE + route, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(6000);
    const info = await page.evaluate(() => ({
      url: location.href,
      h1: [...document.querySelectorAll('h1,h2,.page-title')].map((e) => e.textContent.trim()).slice(0, 4),
      rows: document.querySelectorAll('table tbody tr, .table tbody tr').length,
      hasTable: !!document.querySelector('table'),
      bodyLen: document.body.innerText.replace(/\s+/g, ' ').trim().length,
      firstText: document.body.innerText.replace(/\s+/g, ' ').trim().slice(0, 200),
    }));
    findings.routes[name] = { route, ...info };
    console.log(`\n${name} (${route}) → ${info.url}`);
    console.log('  h1:', info.h1, '| rows:', info.rows, '| len:', info.bodyLen);
    await page.screenshot({ path: path.join(SHOTS, `10_${name}.png`) });
  }

  // --- how are merchant / category / section managed TODAY? ---------------
  await page.goto(BASE + '/#/perks/create', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(8000);
  const form = await page.evaluate(() => ({
    labels: [...document.querySelectorAll('label, .form-label')].map((e) => e.textContent.trim().replace(/\s+/g, ' ')).filter(Boolean).slice(0, 40),
    selects: [...document.querySelectorAll('select')].map((s) => ({
      name: s.getAttribute('formcontrolname') || s.name, options: s.options.length,
    })),
    buttons: [...document.querySelectorAll('button')].map((b) => b.textContent.trim().replace(/\s+/g, ' ')).filter(Boolean).slice(0, 30),
    addButtons: [...document.querySelectorAll('button, a')].map((b) => b.textContent.trim()).filter((t) => /add|new|\+/i.test(t)).slice(0, 20),
  }));
  findings.perkForm = form;
  console.log('\nperk create form:');
  console.log('  labels:', form.labels.join(' | '));
  console.log('  selects:', JSON.stringify(form.selects));
  console.log('  buttons:', form.buttons.join(' | '));
  await page.screenshot({ path: path.join(SHOTS, '20_perk_create_form.png'), fullPage: true });

  fs.writeFileSync(OUT, JSON.stringify(findings, null, 2));
  console.log('\nwrote', OUT, '\nscreenshots →', SHOTS);
  await browser.close();
})().catch((e) => {
  console.error('FATAL', e.message);
  fs.writeFileSync(OUT, JSON.stringify({ ...findings, fatal: e.message }, null, 2));
  process.exit(1);
});
