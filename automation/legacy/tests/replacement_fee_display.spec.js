'use strict';

/**
 * B10-48764 — Display Replacement Fees on 'Report Card Lost or Stolen' Screen
 * Admin Portal (Web) — replacement-fee confirmation modal suite.
 *
 * Covers the two admin-portal flows where the replacement fee must be disclosed before
 * any card change is committed:
 *   A) Replace Breadfast Card modal (Active / Linked / Received card users)
 *   B) Reapply for Breadfast Card modal (previously-closed-card users)
 *
 * Preconditions (manual — env must be set up before running):
 *   • Feature flag 'display_replacement_fees' = ON in testing environment.
 *   • REPLACE_CARD_MOBILE env var → phone number of a customer with an Active card.
 *     Defaults to the shared test account; override with `REPLACE_CARD_MOBILE=+20XXXXXXXXXX npx playwright test`.
 *   • REAPPLY_CARD_MOBILE env var → phone number of a customer with a previously-Closed card.
 *     Defaults to REPLACE_CARD_MOBILE; most test data assertions also apply to the reapply modal.
 *   • Backend fee config (B10-55382) returns 150 EGP.
 *
 * Mobile tests (iOS/Android) are out of scope for this Playwright suite — those are
 * covered in the Java/Appium framework (D:\projects) or executed manually via BrowserStack.
 *
 * Test IDs map to the BrowserStack test case titles in B10-48764_browserstack_testcases.csv.
 */

const { test, expect } = require('@playwright/test');
const config           = require('../../helpers/ConfigReader');
const LoginPage        = require('../../pages/LoginPage');
const ReplaceCardPage  = require('../../pages/ReplaceCardPage');

// ── Test accounts ─────────────────────────────────────────────────────────────
// Override via env var when a dedicated provisioned user is available.
const REPLACE_MOBILE = process.env.REPLACE_CARD_MOBILE || '+201203365955';
const REAPPLY_MOBILE = process.env.REAPPLY_CARD_MOBILE || REPLACE_MOBILE;

// ── Expected modal copy (from Figma 2 / Card-Users-Dashboard node 4490-27014) ──
const REPLACE_TITLE   = /Are you sure you want to proceed with replacing the Breadfast Card/i;
const REPLACE_FEE     = /150\s*EGP|EGP\s*150/i;
const REPLACE_PERM    = /closed permanently/i;
const REPLACE_BALANCE = /transferred to the user.?s wallet|transferred to.*wallet/i;
const REPLACE_WARNING = /cannot be undone|cannot be re-?done/i;
const REPLACE_CTA     = /Replace card/i;

// ── Expected reapply modal copy (from Figma 1 / Enable-Card-Reapplication node 4901-2869) ─
const REAPPLY_TITLE   = /Are you sure you want to reapply for this card/i;
const REAPPLY_FEE     = /150\s*EGP|EGP\s*150/i;
const REAPPLY_PICKUP  = /pickup location|nearest.*branch|collect.*branch/i;
const REAPPLY_CTA     = /Reapply/i;

let replacePage;

test.beforeEach(async ({ page }) => {
  await new LoginPage(page).fillLoginFormAndSubmit(
    config.getAdminUserName(),
    config.getAdminPassword(),
  );
  replacePage = new ReplaceCardPage(page);
});

// ══════════════════════════════════════════════════════════════════════════════
//  A — Replace Breadfast Card modal (admin portal)
// ══════════════════════════════════════════════════════════════════════════════

test('[TC_RFEE_001] Replace modal opens when "Replace Breadfast card" is clicked (Active card, flag ON)',
  async ({ page }) => {
    await replacePage.openCustomerCardPanel(REPLACE_MOBILE);
    await replacePage.openReplaceModal();

    await expect(replacePage.replaceModal).toBeVisible();
    await expect(page.getByText(REPLACE_TITLE)).toBeVisible();
  });

test('[TC_RFEE_002] Replace modal states the card will be closed permanently',
  async ({ page }) => {
    await replacePage.openCustomerCardPanel(REPLACE_MOBILE);
    await replacePage.openReplaceModal();

    const text = await replacePage.getReplaceModalText();
    expect(text).toMatch(REPLACE_PERM);
  });

test('[TC_RFEE_003] Replace modal includes the irreversible-action warning (cannot be undone)',
  async ({ page }) => {
    await replacePage.openCustomerCardPanel(REPLACE_MOBILE);
    await replacePage.openReplaceModal();

    const text = await replacePage.getReplaceModalText();
    expect(text).toMatch(REPLACE_WARNING);
  });

test('[TC_RFEE_004] Replace modal displays the configured replacement fee (150 EGP)',
  async ({ page }) => {
    await replacePage.openCustomerCardPanel(REPLACE_MOBILE);
    await replacePage.openReplaceModal();

    const text = await replacePage.getReplaceModalText();
    expect(text).toMatch(REPLACE_FEE);
  });

test('[TC_RFEE_005] Replace modal mentions balance transfer to wallet',
  async ({ page }) => {
    await replacePage.openCustomerCardPanel(REPLACE_MOBILE);
    await replacePage.openReplaceModal();

    const text = await replacePage.getReplaceModalText();
    expect(text).toMatch(REPLACE_BALANCE);
  });

test('[TC_RFEE_006] Replace modal has "Replace card" and "Cancel" CTAs',
  async ({ page }) => {
    await replacePage.openCustomerCardPanel(REPLACE_MOBILE);
    await replacePage.openReplaceModal();

    await expect(replacePage.replaceConfirmBtn).toBeVisible();
    await expect(replacePage.replaceCancelBtn).toBeVisible();
  });

test('[TC_RFEE_007] Cancelling the Replace modal closes it with no card change',
  async ({ page }) => {
    await replacePage.openCustomerCardPanel(REPLACE_MOBILE);
    await replacePage.openReplaceModal();
    await replacePage.cancelReplacement();

    // Modal is gone; no navigation away from the card panel
    await expect(page).toHaveURL(/walletUsers/);
  });

test('[TC_RFEE_008] Pressing Escape dismisses the Replace modal with no card change',
  async ({ page }) => {
    await replacePage.openCustomerCardPanel(REPLACE_MOBILE);
    await replacePage.openReplaceModal();
    await replacePage.dismissReplaceByEscape();

    await expect(page).toHaveURL(/walletUsers/);
  });

test('[TC_RFEE_009] Confirming replacement submits a POST request and returns success',
  async ({ page }) => {
    // This test commits a card replacement — run only with a dedicated provisioned Active-card user.
    // Set REPLACE_CARD_MOBILE to a disposable test user and confirm the env has the flag ON.
    if (!process.env.REPLACE_CARD_MOBILE) {
      test.skip(true, 'REPLACE_CARD_MOBILE not set — skipping destructive confirm test');
    }

    await replacePage.openCustomerCardPanel(REPLACE_MOBILE);
    await replacePage.openReplaceModal();
    const result = await replacePage.confirmReplacement();

    expect(result.status, `Replace POST returned unexpected status: ${result.status}`).toBe(200);
  });

// ══════════════════════════════════════════════════════════════════════════════
//  B — Reapply for Breadfast Card modal (admin portal)
// ══════════════════════════════════════════════════════════════════════════════

test('[TC_RFEE_010] Reapply modal opens for a previously-closed-card customer',
  async ({ page }) => {
    if (!process.env.REAPPLY_CARD_MOBILE) {
      test.skip(true, 'REAPPLY_CARD_MOBILE not set — skipping: needs a Closed-card customer');
    }

    await replacePage.openCustomerCardPanel(REAPPLY_MOBILE);
    await replacePage.openReapplyModal();

    await expect(replacePage.replaceModal).toBeVisible();
    await expect(page.getByText(REAPPLY_TITLE)).toBeVisible();
  });

test('[TC_RFEE_011] Reapply modal displays the configured replacement fee (150 EGP)',
  async ({ page }) => {
    if (!process.env.REAPPLY_CARD_MOBILE) {
      test.skip(true, 'REAPPLY_CARD_MOBILE not set');
    }

    await replacePage.openCustomerCardPanel(REAPPLY_MOBILE);
    await replacePage.openReapplyModal();

    const text = await replacePage.getReapplyModalText();
    expect(text).toMatch(REAPPLY_FEE);
  });

test('[TC_RFEE_012] Reapply modal mentions pickup/branch collection',
  async ({ page }) => {
    if (!process.env.REAPPLY_CARD_MOBILE) {
      test.skip(true, 'REAPPLY_CARD_MOBILE not set');
    }

    await replacePage.openCustomerCardPanel(REAPPLY_MOBILE);
    await replacePage.openReapplyModal();

    const text = await replacePage.getReapplyModalText();
    expect(text).toMatch(REAPPLY_PICKUP);
  });

test('[TC_RFEE_013] Reapply modal has "Reapply" and "Cancel" CTAs',
  async ({ page }) => {
    if (!process.env.REAPPLY_CARD_MOBILE) {
      test.skip(true, 'REAPPLY_CARD_MOBILE not set');
    }

    await replacePage.openCustomerCardPanel(REAPPLY_MOBILE);
    await replacePage.openReapplyModal();

    await expect(replacePage.reapplyConfirmBtn).toBeVisible();
    await expect(replacePage.reapplyCancelBtn).toBeVisible();
  });

test('[TC_RFEE_014] Cancelling the Reapply modal closes it with no card change',
  async ({ page }) => {
    if (!process.env.REAPPLY_CARD_MOBILE) {
      test.skip(true, 'REAPPLY_CARD_MOBILE not set');
    }

    await replacePage.openCustomerCardPanel(REAPPLY_MOBILE);
    await replacePage.openReapplyModal();
    await replacePage.cancelReapplication();

    await expect(page).toHaveURL(/walletUsers/);
  });

test('[TC_RFEE_015] Confirming reapplication submits a POST request and returns success',
  async ({ page }) => {
    if (!process.env.REAPPLY_CARD_MOBILE) {
      test.skip(true, 'REAPPLY_CARD_MOBILE not set — skipping destructive reapply test');
    }

    await replacePage.openCustomerCardPanel(REAPPLY_MOBILE);
    await replacePage.openReapplyModal();
    const result = await replacePage.confirmReapplication();

    expect(result.status, `Reapply POST returned unexpected status: ${result.status}`).toBe(200);
  });

// ══════════════════════════════════════════════════════════════════════════════
//  C — Regression: "Replace Breadfast card" option visibility per card state
// ══════════════════════════════════════════════════════════════════════════════

test('[TC_RFEE_016] "Replace Breadfast card" action is present on the card panel for the test account',
  async () => {
    await replacePage.openCustomerCardPanel(REPLACE_MOBILE);

    await expect(replacePage.replaceCardLink).toBeVisible();
  });
