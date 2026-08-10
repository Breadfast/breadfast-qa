/**
 * Verify the video finding: does the Perk DETAILS page render "Perk subheader EN/AR"?
 *
 * The recording never scrolls the details page, so the absence seen there is not yet proof.
 * This probe:
 *   1. logs in, opens the Card perks list, opens DC_25 by row click (SPA nav — a bare
 *      goto to a different hash does not re-bootstrap this Angular hash-router app),
 *   2. scrolls the WHOLE details page to the end and dumps every label + control,
 *   3. records whether subheader_en / subheader_ar exist anywhere in the DOM,
 *   4. clicks Edit and repeats — a value reachable in edit mode is a display bug;
 *      unreachable in both is data loss,
 *   5. captures the perk API response so we know what was actually SAVED.
 */
'use strict';
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = 'https://card-panel-testing.breadfast.tech';
const USER = 'agent';
const PASS = 'Admin@123456789';
const PERK = process.argv[2] || 'DC_25';
const OUT = __dirname;

const apiHits = [];

async function dump(page, tag) {
  // Scroll to the very end so nothing below the fold is missed.
  await page.evaluate(async () => {
    for (let y = 0; y < 12; y++) { window.scrollBy(0, 900); await new Promise(r => setTimeout(r, 120)); }
  });
  await page.waitForTimeout(500);

  const info = await page.evaluate(() => {
    const txt = (e) => (e.textContent || '').replace(/\s+/g, ' ').trim();
    return {
      url: location.href,
      sectionHeads: [...document.querySelectorAll('h1,h2,h3,h4,.card-head,.section-title')].map(txt).filter(Boolean),
      fieldLabels: [...document.querySelectorAll('label, .label, app-bf-input .title, .field-label')].map(txt).filter(Boolean),
      controlNames: [...document.querySelectorAll('[controlname],[formcontrolname]')]
        .map(e => e.getAttribute('controlname') || e.getAttribute('formcontrolname')),
      // every input/textarea with its nearest visible label-ish text and value
      inputs: [...document.querySelectorAll('input,textarea')].map(i => ({
        ctl: (i.closest('[controlname],[formcontrolname]') || {}).getAttribute
          ? (i.closest('[controlname],[formcontrolname]').getAttribute('controlname')
            || i.closest('[controlname],[formcontrolname]').getAttribute('formcontrolname')) : null,
        value: i.value, disabled: i.disabled, readOnly: i.readOnly,
      })),
      bodyMentionsSubheader: /subheader/i.test(document.body.innerHTML),
      bodyTextMentionsSubheader: /perk subheader/i.test(document.body.innerText),
      pageHeight: document.documentElement.scrollHeight,
    };
  });
  info.subheaderControls = info.controlNames.filter(c => c && /subheader/i.test(c));
  await page.screenshot({ path: path.join(OUT, `details-${tag}-full.png`), fullPage: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, `details-${tag}-viewport.png`) });
  return info;
}

(async () => {
  const browser = await chromium.launch({ headless: false, args: ['--start-maximized'] });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await ctx.newPage();

  page.on('response', async (r) => {
    const u = r.url();
    if (/perk/i.test(u) && r.request().method() === 'GET') {
      try { apiHits.push({ url: u, status: r.status(), body: (await r.text()).slice(0, 4000) }); } catch {}
    }
  });

  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  if (page.url().includes('/login') || (await page.locator('button:has-text("Login")').count())) {
    await page.getByRole('textbox', { name: /username/i }).fill(USER);
    await page.getByRole('textbox', { name: /password/i }).fill(PASS);
    await page.getByRole('button', { name: 'Login' }).click();
    await page.waitForURL('**/#/dashboard', { timeout: 30000 });
    await page.waitForTimeout(2000);
  }
  await page.locator('a:has-text("Card Perks")').first().click();
  await page.waitForURL('**/#/perks', { timeout: 25000 });
  await page.locator('button:has-text("Add perk")').first().waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(1500);

  // Open the perk row by its Perk ID cell.
  const row = page.locator(`tr:has-text("${PERK}")`).first();
  await row.waitFor({ state: 'visible', timeout: 20000 });
  await row.locator('td').nth(2).click();
  await page.waitForURL(`**/#/perks/${PERK}`, { timeout: 25000 });
  await page.waitForTimeout(3000);

  const view = await dump(page, 'view');

  // Now edit mode.
  let edit = null;
  const editBtn = page.locator('button:has-text("Edit")').first();
  if (await editBtn.count()) {
    await editBtn.click();
    await page.waitForTimeout(3000);
    edit = await dump(page, 'edit');
  }

  const report = { perk: PERK, at: new Date().toISOString(), view, edit, apiHits };
  fs.writeFileSync(path.join(OUT, 'probe-report.json'), JSON.stringify(report, null, 2));

  console.log('=== VIEW MODE ===');
  console.log('url:', view.url);
  console.log('section heads:', view.sectionHeads.join(' | '));
  console.log('subheader controls:', JSON.stringify(view.subheaderControls));
  console.log('body HTML mentions "subheader":', view.bodyMentionsSubheader);
  console.log('visible text has "Perk subheader":', view.bodyTextMentionsSubheader);
  console.log('control names:', view.controlNames.join(','));
  console.log('page height:', view.pageHeight);
  if (edit) {
    console.log('\n=== EDIT MODE ===');
    console.log('subheader controls:', JSON.stringify(edit.subheaderControls));
    console.log('body HTML mentions "subheader":', edit.bodyMentionsSubheader);
    console.log('visible text has "Perk subheader":', edit.bodyTextMentionsSubheader);
    console.log('control names:', edit.controlNames.join(','));
  }
  console.log('\n=== API ===');
  for (const h of apiHits) console.log(h.status, h.url, '\n  ', h.body.slice(0, 1500), '\n');

  await browser.close();
})().catch(e => { console.error('PROBE FAILED:', e.message); process.exit(1); });
