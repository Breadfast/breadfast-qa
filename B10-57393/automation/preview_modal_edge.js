/**
 * B10-57393 — App preview modal: EDGE / remaining-HLS probes.
 * Reuses the login + upload + measurement helpers from preview_modal_probe.js.
 *
 * Covers the HLS the happy-path probe doesn't:
 *   HLS 17  empty optional sections            → --empty
 *   HLS 16  long / max-length content          → --long
 *   HLS 13  close via ✕ restores cleanly       → --xclose
 *   HLS 14  preview reflects values at OPEN    → --reopen
 *   HLS 18  save-failure handling              → --savefail   (API forced to 500 via route interception)
 *   "See more" truncation expander             → included in --long and --empty
 *
 * Usage: node preview_modal_edge.js --empty|--long|--xclose|--reopen|--savefail
 */
'use strict';
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const H = require('./preview_modal_probe.js');

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const OUT = H.OUT;

/** Fill ONLY what the form marks mandatory; `opts.skip` omits named optional groups. */
async function fillMandatory(page, opts = {}) {
  const skip = new Set(opts.skip || []);
  const long = !!opts.long;
  // The form does NOT silently truncate — it raises "Maximum length should be N characters."
  // and blocks Preview & save (verified live 2026-07-27). So a max-length RENDER test must
  // sit exactly AT each cap, not above it.
  const CAP = { title: 20, subheader: 30, desc: 80, usage: 200, cashback: 45, duration: 40 };
  const fit = (s, n) => s.slice(0, n);
  const T = long
    ? {
        titleEn: fit('Mega Cashback Bonanza Deal', CAP.title),
        titleAr: fit('عرض الكاش باك الضخم جدا جدا', CAP.title),
        subEn: fit('Coffee, Bakery, Pastry & Desserts', CAP.subheader),
        subAr: fit('قهوة ومخبوزات وحلويات ومعجنات فاخرة', CAP.subheader),
        descEn: fit('Enjoy an unlimited 25% cashback on every single order placed at any branch nationwide', CAP.desc),
        descAr: fit('استمتع باسترجاع ٢٥٪ من قيمة كل طلب تقوم به من أي فرع في جميع أنحاء الجمهورية الآن', CAP.desc),
        usageEn: fit('Valid once per calendar day at any participating Breadfast Coffee branch nationwide. Cashback is credited to your Breadfast Pay wallet and is capped at EGP 100 per calendar month. Excludes gift cards.', CAP.usage),
        usageAr: fit('صالح مرة واحدة في اليوم في أي فرع مشارك من فروع بريدفاست كوفي في جميع أنحاء الجمهورية. يضاف الكاش باك إلى محفظة بريدفاست باي بحد أقصى ١٠٠ جنيه شهرياً. لا يشمل بطاقات الهدايا.', CAP.usage),
        branchesEn: '- Promenade Mall\n- Rehab\n- Madinaty\n- Mivida\n- Cairo Festival City\n- Point 90\n- Mall of Egypt\n- Arkan Plaza\n- Zamalek\n- Maadi Degla\n- Heliopolis Korba\n- New Cairo Village',
        cbEn: fit('Cashback may take up to 14 working days to appear in full', CAP.cashback),
        durEn: fit('This limited offer expires on December 31st 2026', CAP.duration),
      }
    : {
        titleEn: '10% Coffee Cashback', titleAr: '١٠٪ كاش باك قهوة',
        subEn: 'Coffee & Bakery', subAr: 'قهوة ومخبوزات',
        descEn: 'Get 10% cashback on all Breadfast Coffee orders.',
        usageEn: 'Valid once per day at any Breadfast Coffee branch.',
        branchesEn: '- Promenade Mall\n- Rehab', cbEn: 'Cashback may take up to 14 days to reflect.',
        durEn: 'This offer expires on Dec 31st, 2026.',
      };

  await page.locator("button:has-text('Add perk')").first().click();
  await page.waitForURL('**/#/perks/create', { timeout: 15000 });
  await page.waitForTimeout(1200);

  await page.locator('mat-select[formcontrolname="type"]').click();
  await page.locator('mat-option', { hasText: 'Merchant cashback' }).first().click();
  await page.waitForTimeout(1200);

  await page.locator('input[data-placeholder="Select one or more branches"]').click();
  await page.locator('.cdk-overlay-pane [role="menuitem"]').filter({ hasText: 'Breadfast Coffee' }).first().click();
  await page.waitForTimeout(600);
  await page.locator('.cdk-overlay-pane [role="menuitem"]').filter({ hasText: /^\s*select all/i }).locator('label').first().click();
  await page.waitForTimeout(400);
  await H.dismissOverlays(page);

  await page.locator('mat-select[formcontrolname="section_id"]').click();
  await page.locator('mat-option', { hasText: 'Breadfast - بريدفاست' }).first().click();
  await page.waitForTimeout(800);

  const bf = (n) => page.locator(`app-bf-input[controlname="${n}"] input`);
  await bf('title_en').fill(T.titleEn);
  await bf('title_ar').fill(T.titleAr);
  await bf('subheader_en').fill(T.subEn);
  await bf('subheader_ar').fill(T.subAr);

  await page.locator('mat-radio-button', { hasText: 'Percentage' }).locator('label').click();
  await page.waitForTimeout(700);
  await page.locator('input[formcontrolname="cashback_value"]').fill(long ? '25' : '10');
  await page.locator('input[formcontrolname="cash_back_limit"]').fill('100');

  const ta = (n) => page.locator(`textarea[formcontrolname="${n}"]`);
  await ta('description_en').fill(T.descEn);                       // mandatory
  await ta('usage_description_en').fill(T.usageEn);                // mandatory
  if (!skip.has('branches')) await ta('branches_description_en').fill(T.branchesEn);
  if (!skip.has('cashback')) await ta('cashback_processing_description_en').fill(T.cbEn);
  if (!skip.has('duration')) await ta('short_duration_description_en').fill(T.durEn);
  if (!skip.has('arabic')) {
    await ta('description_ar').fill(T.descAr || 'استرجع ١٠٪ من قيمة مشترياتك.');
    await ta('usage_description_ar').fill(T.usageAr || 'صالح مرة واحدة يومياً.');
  }

  await page.locator('mat-select[formcontrolname="funding_types"]').click();
  await page.locator('mat-option', { hasText: 'Merchant funded' }).first().click();
  await page.waitForTimeout(500);

  await H.uploadSlot(page, H.COVER);
  await H.uploadSlot(page, H.COVER);
  await H.uploadSlot(page, H.LOGO);
  await H.uploadSlot(page, H.LOGO);

  // capture what the form actually accepted (maxlength truncation matters for --long)
  const accepted = await page.evaluate(() => {
    const v = (s) => document.querySelector(s)?.value ?? null;
    return {
      title_en: v('app-bf-input[controlname="title_en"] input'),
      subheader_en: v('app-bf-input[controlname="subheader_en"] input'),
      description_en: v('textarea[formcontrolname="description_en"]'),
      usage_en: v('textarea[formcontrolname="usage_description_en"]'),
      branches_en: v('textarea[formcontrolname="branches_description_en"]'),
      cashback_en: v('textarea[formcontrolname="cashback_processing_description_en"]'),
      duration_en: v('textarea[formcontrolname="short_duration_description_en"]'),
      errors: [...new Set([...document.querySelectorAll('mat-error')].map(e => e.innerText.trim()).filter(Boolean))],
    };
  });
  return { intended: T, accepted };
}

/**
 * Discount/coupon perk — the ONLY perk type that has a `coupon_code`, and therefore the
 * only way to exercise the **Coupon code** section that both Figma baselines depict
 * (EN chip "BCRTEApr", AR "كود الكوبون" with the chip mirrored to the left).
 * This type has no subheader and no percentage/value; its merchant trigger placeholder is
 * "Select merchant branch" (not "Select one or more branches").
 */
async function fillCouponPerk(page) {
  await page.locator("button:has-text('Add perk')").first().click();
  await page.waitForURL('**/#/perks/create', { timeout: 15000 });
  await page.waitForTimeout(1200);

  await page.locator('mat-select[formcontrolname="type"]').click();
  await page.locator('mat-option', { hasText: 'Discount/coupon' }).first().click();
  await page.waitForTimeout(1500);

  // tolerate either placeholder wording across perk types
  await page.locator('input[readonly][data-placeholder*="Select"][data-placeholder*="branch"]').first().click();
  await page.locator('.cdk-overlay-pane [role="menuitem"]').filter({ hasText: 'Breadfast Coffee' }).first().click();
  await page.waitForTimeout(600);
  await page.locator('.cdk-overlay-pane [role="menuitem"]').filter({ hasText: /^\s*select all/i }).locator('label').first().click();
  await page.waitForTimeout(400);
  await H.dismissOverlays(page);

  await page.locator('mat-select[formcontrolname="section_id"]').click();
  await page.locator('mat-option', { hasText: 'Breadfast - بريدفاست' }).first().click();
  await page.waitForTimeout(800);

  await page.locator('app-bf-input[controlname="title_en"] input').fill('20% Off Coffee');
  await page.locator('app-bf-input[controlname="title_ar"] input').fill('٢٠٪ خصم قهوة');
  // subheader_en/_ar are required here too, but only render AFTER the section is chosen
  for (const [ctl, val] of [['subheader_en', 'Coffee & Bakery'], ['subheader_ar', 'قهوة ومخبوزات']]) {
    const f = page.locator(`app-bf-input[controlname="${ctl}"] input`);
    if (await f.count()) await f.fill(val);
  }
  await page.locator('app-bf-input[controlname="coupon_code"] input').fill('BFCOFFEE20');
  await page.waitForTimeout(900);
  // "Coupon type *" (Online | Physical) is REQUIRED and only renders once a coupon code
  // has been entered — missing it silently blocks Preview & save (verified 2026-07-27).
  const online = page.locator('mat-radio-button', { hasText: /^\s*Online\s*$/ }).locator('label').first();
  if (await online.count()) { await online.click(); await page.waitForTimeout(500); }

  const ta = (n) => page.locator(`textarea[formcontrolname="${n}"]`);
  await ta('description_en').fill('Get 20% off any coffee order at Breadfast Coffee branches.');
  await ta('description_ar').fill('احصل على خصم ٢٠٪ على أي طلب قهوة من فروع بريدفاست كوفي.');
  await ta('usage_description_en').fill('Use the coupon once per day at checkout in the Breadfast app.');
  await ta('usage_description_ar').fill('استخدم الكوبون مرة واحدة يومياً عند الدفع في تطبيق بريدفاست.');
  await ta('branches_description_en').fill('- Cairo Festival City\n- Point 90\n- City Stars');
  await ta('branches_description_ar').fill('- كايرو فيستيفال سيتي\n- بوينت ٩٠\n- سيتي ستارز');
  await ta('cashback_processing_description_en').fill('Discount applies instantly at checkout.');
  await ta('cashback_processing_description_ar').fill('يطبق الخصم فوراً عند الدفع.');
  await ta('short_duration_description_en').fill('Valid till Dec 31st, 2026.');
  await ta('short_duration_description_ar').fill('صالح حتى ٣١/١٢/٢٠٢٦');

  await page.locator('mat-select[formcontrolname="funding_types"]').click();
  await page.locator('mat-option', { hasText: 'Merchant funded' }).first().click();
  await page.waitForTimeout(500);

  await H.uploadSlot(page, H.COVER);
  await H.uploadSlot(page, H.COVER);
  await H.uploadSlot(page, H.LOGO);
  await H.uploadSlot(page, H.LOGO);

  return page.evaluate(() => ({
    coupon: document.querySelector('app-bf-input[controlname="coupon_code"] input')?.value,
    errors: [...new Set([...document.querySelectorAll('mat-error')].map(e => e.innerText.trim()).filter(Boolean))],
    previews: document.querySelectorAll('main img[alt="Image Preview"]').length,
    // name the still-invalid controls so a blocked Preview & save is diagnosable
    invalidControls: [...document.querySelectorAll('main .ng-invalid[formcontrolname], main app-bf-input:has(.ng-invalid)')]
      .map(e => e.getAttribute('formcontrolname') || e.getAttribute('controlname')).filter(Boolean),
  }));
}

async function openModal(page) {
  await page.locator('form button[type=submit]:has-text("Preview & save")').click();
  const dlg = page.locator('mat-dialog-container');
  try {
    await dlg.waitFor({ state: 'visible', timeout: 15000 });
  } catch (e) {
    // The click marks every control touched, so name exactly what blocked the preview
    // instead of failing with an opaque "dialog never appeared".
    const blockers = await page.evaluate(() => {
      const fields = [];
      document.querySelectorAll('main mat-form-field').forEach(ff => {
        const err = ff.querySelector('mat-error'); if (!err) return;
        const ctl = ff.querySelector('input,textarea,mat-select');
        fields.push({
          ctl: ctl?.getAttribute('formcontrolname') || ctl?.closest('app-bf-input')?.getAttribute('controlname') || ctl?.id,
          err: err.innerText.trim(), value: (ctl && 'value' in ctl) ? String(ctl.value).slice(0, 40) : null,
        });
      });
      const loose = [...document.querySelectorAll('main mat-error')].filter(e => !e.closest('mat-form-field'))
        .map(e => (e.parentElement?.innerText || '').replace(/\s+/g, ' ').slice(0, 70));
      return { fields, loose };
    });
    throw new Error('Preview & save blocked. Blockers: ' + JSON.stringify(blockers));
  }
  await page.waitForTimeout(2000);
  return dlg;
}

/** Which detail sections rendered, and did they overflow/scroll correctly? */
const readSections = (page) => page.evaluate(() => {
  const dlg = document.querySelector('mat-dialog-container');
  const frames = [...dlg.querySelectorAll('.screen-scroll')];
  const detail = frames[1];
  return {
    sections: [...detail.querySelectorAll('.card .card-head')].map(h => (h.innerText || '').replace(/\s+/g, ' ').trim().split(' ').slice(1).join(' ')),
    detailScroll: { scrollHeight: detail.scrollHeight, clientHeight: detail.clientHeight, scrollable: detail.scrollHeight > detail.clientHeight + 2 },
    tileScroll: { scrollHeight: frames[0].scrollHeight, clientHeight: frames[0].clientHeight },
    // does any content visually overflow its card (broken layout)?
    overflowingCards: [...detail.querySelectorAll('.card')].filter(c => c.scrollWidth > c.clientWidth + 2).length,
    fullText: (detail.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 900),
    hasSeeMore: /see more/i.test(detail.innerText || ''),
  };
});

/** The "See more" truncation expander (the only interactive affordance in the preview). */
async function probeSeeMore(page) {
  const detail = page.locator('mat-dialog-container .screen-scroll').nth(1);
  const link = detail.locator('text=/see more/i').first();
  if (!(await link.count())) return { present: false };
  const before = await detail.evaluate(el => ({ sh: el.scrollHeight, len: (el.innerText || '').length }));
  await link.click().catch(() => {});
  await page.waitForTimeout(900);
  const after = await detail.evaluate(el => ({ sh: el.scrollHeight, len: (el.innerText || '').length, txt: (el.innerText || '').replace(/\s+/g, ' ').slice(0, 400) }));
  return { present: true, before, after, expanded: after.sh > before.sh || after.len > before.len };
}

(async () => {
  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });

  const mode = has('--empty') ? 'empty' : has('--long') ? 'long' : has('--xclose') ? 'xclose'
    : has('--reopen') ? 'reopen' : has('--savefail') ? 'savefail' : has('--coupon') ? 'coupon' : 'empty';
  const R = { ticket: 'B10-57393', mode, startedAt: new Date().toISOString(), steps: {} };

  try {
    await H.login(page);

    if (mode === 'empty') {
      // HLS 17 — optional sections left blank: do they vanish, or render as empty shells?
      R.steps.fill = await fillMandatory(page, { skip: ['branches', 'cashback', 'duration'] });
      await openModal(page);
      await H.shot(page, '20_edge_empty_optionals_EN.png');
      R.steps.sections = await readSections(page);
      R.steps.arabic = await H.probeLanguage(page, 'Arabic');
      await H.shot(page, '21_edge_empty_optionals_AR.png');
    }

    if (mode === 'coupon') {
      // Coverage gap closer: the Coupon-code section is in BOTH Figma baselines but is only
      // reachable on a Discount/coupon perk. Verifies HLS 11 (every entered field renders).
      R.steps.fill = await fillCouponPerk(page);
      await openModal(page);
      await H.shot(page, '30_edge_coupon_EN.png');
      R.steps.sectionsEN = await readSections(page);
      R.steps.couponChipEN = await page.evaluate(() => {
        const d = [...document.querySelectorAll('mat-dialog-container .screen-scroll')][1];
        const card = [...d.querySelectorAll('.card')].find(c => /coupon/i.test(c.innerText || ''));
        return card ? { text: card.innerText.replace(/\s+/g, ' ').trim(), hasCode: /BFCOFFEE20/.test(card.innerText) } : null;
      });
      R.steps.arabic = await H.probeLanguage(page, 'Arabic');
      await H.shot(page, '31_edge_coupon_AR.png');
      R.steps.couponChipAR = await page.evaluate(() => {
        const d = [...document.querySelectorAll('mat-dialog-container .screen-scroll')][1];
        const card = [...d.querySelectorAll('.card')].find(c => /BFCOFFEE20|كوبون/i.test(c.innerText || ''));
        return card ? { text: card.innerText.replace(/\s+/g, ' ').trim(), hasCode: /BFCOFFEE20/.test(card.innerText),
                        direction: getComputedStyle(card).direction } : null;
      });
      R.steps.sectionsAR = await readSections(page);
    }

    if (mode === 'long') {
      // HLS 16 — max-length content: scroll + layout must survive
      R.steps.fill = await fillMandatory(page, { long: true });
      await openModal(page);
      await H.shot(page, '22_edge_long_content_EN.png');
      R.steps.sections = await readSections(page);
      R.steps.frames = await H.measureFrames(page);
      R.steps.seeMore = await probeSeeMore(page);
      await H.shot(page, '23_edge_long_after_seemore.png');
      const detail = page.locator('mat-dialog-container .screen-scroll').nth(1);
      await detail.evaluate(el => { el.scrollTop = el.scrollHeight; });
      await page.waitForTimeout(700);
      R.steps.scrolledToBottom = await detail.evaluate(el => ({ top: Math.round(el.scrollTop), sh: el.scrollHeight, ch: el.clientHeight,
                                                                reachedEnd: Math.abs(el.scrollTop + el.clientHeight - el.scrollHeight) < 3 }));
      await H.shot(page, '24_edge_long_scrolled_bottom.png');
      R.steps.arabic = await H.probeLanguage(page, 'Arabic');
      await H.shot(page, '25_edge_long_AR.png');
    }

    if (mode === 'xclose') {
      // HLS 13 — close via the ✕ icon
      R.steps.fill = await fillMandatory(page, {});
      const dlg = await openModal(page);
      const titleBefore = await page.evaluate(() => document.querySelector('app-bf-input[controlname="title_en"] input')?.value);
      const closeBtn = dlg.locator('button:has(mat-icon), mat-icon:has-text("close")').first();
      await closeBtn.click();
      await page.waitForTimeout(2000);
      R.steps.xclose = {
        modalClosed: !(await dlg.isVisible().catch(() => false)),
        titleBefore,
        titleAfter: await page.evaluate(() => document.querySelector('app-bf-input[controlname="title_en"] input')?.value),
        stuckBackdrop: await page.evaluate(() => document.querySelectorAll('.cdk-overlay-backdrop').length),
        bodyScrollLocked: await page.evaluate(() => getComputedStyle(document.body).overflow === 'hidden'),
        pageInteractive: await page.locator('form button[type=submit]:has-text("Preview & save")').isEnabled().catch(() => false),
        url: page.url(),
      };
      await H.shot(page, '26_edge_after_x_close.png');
    }

    if (mode === 'reopen') {
      // HLS 14 — the preview must reflect the form values AT THE MOMENT it opens
      R.steps.fill = await fillMandatory(page, {});
      const dlg = await openModal(page);
      R.steps.firstOpenText = await dlg.evaluate(el => (el.querySelectorAll('.screen-scroll')[1].innerText || '').replace(/\s+/g, ' ').slice(0, 160));
      await dlg.locator('button', { hasText: /^\s*Cancel\s*$/ }).first().click();
      await page.waitForTimeout(1500);
      // edit the title, then reopen
      const NEW = 'Edited Title 77';
      await page.locator('app-bf-input[controlname="title_en"] input').fill(NEW);
      await page.waitForTimeout(500);
      const dlg2 = await openModal(page);
      const secondText = await dlg2.evaluate(el => (el.querySelectorAll('.screen-scroll')[1].innerText || '').replace(/\s+/g, ' ').slice(0, 160));
      R.steps.reopen = { newTitle: NEW, secondOpenText: secondText, reflectsEdit: secondText.includes(NEW) };
      await H.shot(page, '27_edge_reopen_reflects_edit.png');
    }

    if (mode === 'savefail') {
      // HLS 18 — force the create call to fail; the modal must stay open, keep the data, and say why
      R.steps.fill = await fillMandatory(page, {});
      await page.route('**/api/v1/web/card/perks**', async (route) => {
        if (['POST', 'PUT'].includes(route.request().method())) {
          await route.fulfill({ status: 500, contentType: 'application/json',
            body: JSON.stringify({ message: 'Injected failure for HLS-18 negative test' }) });
        } else await route.continue();
      });
      const dlg = await openModal(page);
      await dlg.locator('button', { hasText: /^\s*Save\s*$/ }).first().click();

      // Bug-reporting gate check 8: a toast that auto-dismisses will "prove" nothing was shown if
      // you sample once. POLL for any error surface across the whole window instead, and record the
      // spinner state over time so "stuck spinner" is a measurement, not an impression.
      const observed = [];
      let sawError = null;
      for (let tick = 0; tick < 24; tick++) {          // 24 x 500ms = 12s
        const snap = await page.evaluate(() => {
          const texts = [...document.querySelectorAll(
            '.toast, .mat-snack-bar-container, snack-bar-container, simple-snack-bar, .error, mat-error, [class*="alert"]')]
            .map(t => (t.innerText || '').trim()).filter(Boolean);
          const saveBtn = [...document.querySelectorAll('mat-dialog-container button')]
            .find(b => /save/i.test(b.innerText) || b.querySelector('mat-spinner, mat-progress-spinner'));
          return {
            errors: texts,
            spinner: !!saveBtn && !!saveBtn.querySelector('mat-spinner, mat-progress-spinner, [class*="spin"]'),
            saveLabel: saveBtn ? (saveBtn.innerText || '').trim() : null,
            modalOpen: !!document.querySelector('mat-dialog-container'),
          };
        });
        observed.push({ atMs: tick * 500, ...snap });
        if (snap.errors.length && !sawError) sawError = { atMs: tick * 500, errors: snap.errors };
        await page.waitForTimeout(500);
      }
      R.steps.savefail = {
        modalStillOpen: await dlg.isVisible().catch(() => false),
        previewStillRendered: await page.locator('mat-dialog-container .screen-scroll').count(),
        errorSurfacedDuring12sPoll: sawError,                        // null = never appeared
        spinnerTicks: observed.filter(o => o.spinner).length,
        totalTicks: observed.length,
        spinnerStillSpinningAtEnd: observed[observed.length - 1].spinner,
        saveLabelAtEnd: observed[observed.length - 1].saveLabel,
        titlePreserved: await page.evaluate(() => document.querySelector('app-bf-input[controlname="title_en"] input')?.value),
        url: page.url(),
      };
      await H.shot(page, '28_edge_save_failure.png');
      await page.unroute('**/api/v1/web/card/perks**');
      // did anything get created despite the injected 500?
      await page.locator('a:has-text("Card Perks")').first().click().catch(() => {});
      await page.waitForTimeout(3000);
      R.steps.perksAfterFailedSave = await H.existingPerks(page);
      await H.shot(page, '29_edge_perks_after_failed_save.png');
    }

    R.consoleErrors = consoleErrors;
    R.ok = true;
  } catch (e) {
    R.ok = false;
    R.error = { message: e.message, stack: (e.stack || '').split('\n').slice(0, 5).join('\n') };
    R.consoleErrors = consoleErrors;
    await H.shot(page, `98_edge_${mode}_failure.png`).catch(() => {});
  }

  const file = path.join(OUT, `preview_edge_${mode}.json`);
  fs.writeFileSync(file, JSON.stringify(R, null, 2));
  console.log(JSON.stringify(R, null, 2));
  console.log(`\n→ ${file}`);
  await browser.close();
})();
