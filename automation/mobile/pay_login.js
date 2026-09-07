/**
 * Shared customer-app login + Pay-dashboard entry for ad-hoc mobile sessions.
 *
 * Promoted to automation/mobile/ on 2026-08-24 (B10-57796) from the per-story copy that B10-58603
 * had to derive the hard way. Story folders are gitignored, so this flow — which took four failed
 * combos to get right — lived nowhere reusable. It does now.
 *
 * Every trap below is a measured failure, not a precaution:
 *   - Android login fields are Compose: `element/value` is a silent no-op, keycodes work.
 *   - iOS ids differ from Android's and come from the framework's own page objects
 *     (`phoneNumberScreen_txtField`, `submitBtn`), never guessed.
 *   - Gates are detected STRUCTURALLY (a 10-key keypad = passcode; a 4-box OTP field = OTP).
 *     Copy matching put an ar/EG run through the wrong branch because the passcode screen's
 *     "forgot passcode" line contains the word "code".
 *   - The ar/EG keypad renders Arabic-Indic numerals, mixing U+06F0-9 and U+0660-9 in one keypad,
 *     so a search for "1" finds nothing. Try every glyph form.
 *   - The Pay-access OTP gate takes the phone's LAST 4 DIGITS; nothing is sent to the OTP space, so
 *     falling back to reading Chat hangs or re-keys the earlier LOGIN OTP.
 *   - `allowInvisibleElements` makes off-screen rows findable with NEGATIVE height; tapping their
 *     centre lands outside the app. Verify the rect is inside the viewport before tapping.
 *
 * Usage:
 *   const { loginAndOpenPay, findAny, labels, tapCentre, findVisible } = require('./pay_login.js');
 *   const r = await loginAndOpenPay({ sid, platform, locale, phoneLocal, passcode, shot });
 */
'use strict';

const S = require('./session.js');
const { fetchOtp } = require('./otp_google_chat.js');

/** Every distinct human-readable string on screen, in document order. */
function labels(src, isAndroid) {
  const out = [];
  const re = isAndroid ? /(?:content-desc|text)="([^"]{1,240})"/g : /(?:label|name|value)="([^"]{1,240})"/g;
  let m;
  while ((m = re.exec(src || ''))) {
    const v = m[1].trim();
    if (!v || /^(true|false|\d+(\.\d+)?|android\.|XCUIElementType|com\.breadfast)/.test(v)) continue;
    if (!out.includes(v)) out.push(v);
  }
  return out;
}

async function findAny(sid, needle, isAndroid) {
  const esc = String(needle).replace(/'/g, "\\'").replace(/"/g, '\\"');
  const tries = isAndroid ? [
    ['-android uiautomator', `new UiSelector().text("${esc}")`],
    ['-android uiautomator', `new UiSelector().description("${esc}")`],
    ['-android uiautomator', `new UiSelector().resourceIdMatches(".*${esc}.*")`],
    ['xpath', `//*[@text="${esc}" or @content-desc="${esc}"]`],
  ] : [
    ['-ios class chain', `**/*[\`label == "${esc}"\`]`],
    ['accessibility id', esc],
    ['xpath', `//*[@label="${esc}" or @name="${esc}" or @value="${esc}"]`],
  ];
  for (const [u, v] of tries) {
    try { const el = await S.find(sid, u, v); if (el) return el; } catch (_) { /* next */ }
  }
  return null;
}

/** Digit glyph variants to try for a keypad key: Western, extended Arabic-Indic, Arabic-Indic. */
const DIGIT_FORMS = (d) => {
  const i = Number(d);
  return [String(i), String.fromCharCode(0x06f0 + i), String.fromCharCode(0x0660 + i)];
};

async function findDigitKey(sid, d, isAndroid) {
  for (const glyph of DIGIT_FORMS(d)) {
    // Exact text/label only — a `resourceIdMatches(".*1.*")` fallback matches unrelated nodes and taps
    // them, which is how a failed ar/EG pass reported zero errors while achieving nothing.
    const tries = isAndroid
      ? [['-android uiautomator', `new UiSelector().text("${glyph}")`],
        ['-android uiautomator', `new UiSelector().description("${glyph}")`],
        ['xpath', `//*[@text="${glyph}" or @content-desc="${glyph}"]`]]
      : [['xpath', `//XCUIElementTypeOther[@name="${glyph}"]`],
        ['-ios class chain', `**/*[\`label == "${glyph}"\`]`],
        ['xpath', `//*[@label="${glyph}" or @name="${glyph}" or @value="${glyph}"]`]];
    for (const [u, v] of tries) {
      try { const el = await S.find(sid, u, v); if (el) return { el, glyph }; } catch (_) { /* next */ }
    }
  }
  return null;
}

async function tapCentre(sid, el) {
  const r = await S.rect(sid, el);
  await S.tap(sid, r.x + r.width / 2, r.y + r.height / 2);
  return r;
}

/** Find a node and make sure it is actually ON SCREEN before tapping it; scroll until it is. */
async function findVisible(sid, needle, size, isAndroid, maxScrolls = 4) {
  for (let attempt = 0; attempt <= maxScrolls; attempt++) {
    const el = await findAny(sid, needle, isAndroid);
    if (el) {
      try {
        const r = await S.rect(sid, el);
        const onScreen = r.height > 0 && r.width > 0 && r.y >= 0 && r.x >= 0
          && (r.y + r.height) <= size.height && (r.x + r.width) <= size.width;
        if (onScreen) return { el, rect: r };
      } catch (_) { /* stale — scroll and retry */ }
    }
    if (attempt === maxScrolls) break;
    await S.swipe(sid, { w: size.width, h: size.height }, 'up', 0.3);
    await S.sleep(2200);
  }
  return null;
}

/**
 * Log in and land on the Pay dashboard. Throws with a screen description rather than silently
 * continuing from a gate — "0 rows found" while still sitting on the passcode screen is not an
 * observation, it is a harness failure wearing an observation's clothes.
 *
 * @returns {{ notes: object, src: string }} notes carries what each gate actually did.
 */
async function loginAndOpenPay({ sid, platform, locale, phoneLocal, passcode, shot = async () => '' }) {
  const isAndroid = platform === 'android';
  const phoneE164 = '+20' + phoneLocal;
  const last4 = phoneLocal.slice(-4);
  const notes = {};

  await S.sleep(isAndroid ? 22000 : 30000);
  let src = await shot('launch');
  notes.launchLabels = labels(src, isAndroid).slice(0, 12);

  // ── login ────────────────────────────────────────────────────────────────
  const phoneEntry = await findAny(sid, 'phone_input_clickable_component', isAndroid);
  if (phoneEntry) { await tapCentre(sid, phoneEntry); await S.sleep(5000); src = await shot('phone_screen'); }

  const field = isAndroid
    ? await S.find(sid, 'xpath', '//*[@content-desc="phoneNumber_txtField"]//android.widget.EditText')
    : (await S.find(sid, 'xpath', "//XCUIElementTypeTextField[@name='phoneNumberScreen_txtField']")
       || await S.find(sid, 'xpath', '//XCUIElementTypeTextField'));
  if (!field) throw new Error('phone field not found on the login screen');

  if (isAndroid) {
    await S.fillSegmented(sid, field, phoneLocal, { android: true });
  } else {
    await S.enterText(sid, field, phoneLocal, { android: false });
  }
  await S.sleep(1200);
  await shot('phone_entered');

  const mark = Date.now();
  const next = await findAny(sid, isAndroid ? 'next_btn' : 'submitBtn', isAndroid)
    || await findAny(sid, 'next_btn', isAndroid) || await findAny(sid, 'submitBtn', isAndroid)
    || await findAny(sid, 'Next', isAndroid)
    // ar/EG: the submit button reads "التالي". Without it the iOS ar run entered the number correctly
    // (green tick) and then never tapped anything, failing as "OTP screen never opened".
    || await findAny(sid, 'التالي', isAndroid) || await findAny(sid, 'متابعة', isAndroid);
  if (next) await tapCentre(sid, next);

  let onOtp = false;
  //24s was too tight on iOS: the OTP was sent (so the tap worked) while the screen had not rendered yet.
  for (let i = 0; i < 25 && !onOtp; i++) {
    await S.sleep(2000);
    src = await S.source(sid) || '';
    onOtp = /otp_?[tT]extField|otpScreen_|verification code|رمز التحقق|تأكيد رقم/i.test(src);
  }
  if (!onOtp) {
    // NEVER blame a system this code has not checked.
    //
    // The previous version threw `OTP screen never opened (resend throttling?)`. The parenthetical was
    // a guess about the OTP DELIVERY system, while the only thing actually observed was "my matcher
    // did not match". That guess was then reported upward as fact across three runs and three
    // accounts, and a cooldown was proposed — when the OTPs had been arriving in #testing-otp the
    // whole time and the real fault was this predicate (it looked for Android's `otp_textField` and
    // English copy, while iOS exposes `otpTextField`/`otpScreen_*` and ar/EG reads "تأكيد رقم الهاتف").
    //
    // So: before failing, ASK THE OTP SOURCE. If a code did arrive, say plainly that delivery worked
    // and the fault is ours, and report what was actually on screen instead of a hypothesis.
    const shot0 = await shot('otp_screen_not_recognised');
    const arrived = await fetchOtp(phoneE164, { timeoutMs: 15000, notBefore: mark }).catch(() => null);
    const onScreen = labels(shot0 || src, isAndroid).slice(0, 15).join(' | ');
    const ids = [...String(src).matchAll(/(?:name|content-desc|resource-id)="([^"]{2,60})"/g)]
      .map((m) => m[1]).filter((v) => /otp|verif|code|screen_/i.test(v));
    throw new Error(
      'the OTP screen was not RECOGNISED by this matcher'
      + (arrived
        ? ` — but the OTP DID arrive (code ${arrived.otp} at ${arrived.createTime}), so delivery is fine `
          + 'and this is a detection failure here, not a throttling or backend problem.'
        : ' — and no code was found in the OTP space within 15s either, so delivery is the NEXT thing '
          + 'to check, not the assumed cause.')
      + `\n  matcher: /otp_?[tT]extField|otpScreen_|verification code|رمز التحقق|تأكيد رقم/i`
      + `\n  otp-ish identifiers actually on screen: ${ids.length ? JSON.stringify([...new Set(ids)]) : 'none'}`
      + `\n  labels on screen: ${onScreen}`);
  }

  const got = await fetchOtp(phoneE164, { timeoutMs: 90000, notBefore: mark });
  if (!got) {
    throw new Error(`no login OTP for ${phoneE164} appeared in the OTP space within 90s of ${new Date(mark).toISOString()}`
      + ' — this one IS a delivery observation: the space was polled and nothing matching this number arrived.');
  }
  notes.loginOtp = got.otp;
  const otpField = isAndroid
    ? await S.find(sid, 'xpath', '//android.widget.EditText[.//*[@content-desc="otp_textField"]]')
    : (await S.find(sid, 'accessibility id', 'otpTextField')
       || await S.find(sid, 'xpath', '//*[@name="otpTextField"]')
       || await S.find(sid, 'xpath', '//XCUIElementTypeTextField'));
  if (otpField) await S.fillSegmented(sid, otpField, got.otp, { android: isAndroid });
  else if (!isAndroid) {
    // no focusable field on this build — key the digits into the on-screen keyboard instead
    for (const d of got.otp) {
      const k = await S.find(sid, 'xpath', `//XCUIElementTypeKey[@name="${d}"]`);
      if (k) { await tapCentre(sid, k); await S.sleep(350); }
    }
  }
  await S.sleep(2000);
  for (const submit of ['otpScreen_submitBtn', 'تآكيد', 'تأكيد', 'Verify', 'Confirm']) {
    const b = await findAny(sid, submit, isAndroid);
    if (b) { await tapCentre(sid, b); break; }
  }
  await S.sleep(9000);
  src = await shot('home');

  // ── system permission alerts ──────────────────────────────────────────────
  // The app asks for location right after login. `appium:autoAcceptAlerts` does NOT catch this one on
  // iOS — the alert renders over the tab bar and the Pay tab lookup then fails with "Pay tab not
  // found" while the tab is plainly on screen behind it. Dismiss explicitly, and prefer the
  // least-privileged answer: the perks list does not need location.
  notes.alertsDismissed = [];
  for (let round = 0; round < 3; round++) {
    let hit = null;
    for (const label of ['Allow While Using App', 'Allow Once', 'Don’t Allow', "Don't Allow",
      'While using the app', 'Only this time', 'Allow', 'السماح', 'عدم السماح']) {
      const b = await findAny(sid, label, isAndroid);
      if (b) { hit = label; await tapCentre(sid, b); await S.sleep(2500); break; }
    }
    if (!hit) break;
    notes.alertsDismissed.push(hit);
  }
  if (notes.alertsDismissed.length) await shot('after_permission_alerts');

  // ── Pay tab ──────────────────────────────────────────────────────────────
  const payIds = isAndroid ? ['bottomBar_pay_btn', 'Pay', 'payTab'] : ['Pay', 'PayUnSelectedState', 'bottomBar_pay_btn'];
  let pay = null;
  for (const c of payIds) { pay = await findAny(sid, c, isAndroid); if (pay) break; }
  if (!pay) { await shot('no_pay_tab'); throw new Error('Pay tab not found'); }
  await tapCentre(sid, pay);
  await S.sleep(7000);
  src = await shot('pay_entry');

  // ── gates, detected structurally ─────────────────────────────────────────
  const hasOtpField = async () => !!(isAndroid
    ? await S.find(sid, 'xpath', '//android.widget.EditText[.//*[@content-desc="otp_textField"]]')
    : await S.find(sid, 'accessibility id', 'otpTextField'));
  const hasKeypad = async () => !!(await findDigitKey(sid, '5', isAndroid));

  if ((await hasKeypad()) && !(await hasOtpField())) {
    const glyphs = [];
    for (const d of passcode) {
      const k = await findDigitKey(sid, d, isAndroid);
      if (!k) throw new Error('passcode keypad key not found in any digit form: ' + d);
      glyphs.push(k.glyph);
      await tapCentre(sid, k.el); await S.sleep(330);
    }
    notes.passcodeGlyphs = glyphs.join('');
    await S.sleep(8000);
    src = await shot('after_passcode');
    notes.passcodeAccepted = !(await hasKeypad());
  }

  if (await hasOtpField()) {
    const f2 = isAndroid
      ? await S.find(sid, 'xpath', '//android.widget.EditText[.//*[@content-desc="otp_textField"]]')
      : (await S.find(sid, 'accessibility id', 'otpTextField') || await S.find(sid, 'xpath', '//XCUIElementTypeTextField'));
    if (f2) await S.fillSegmented(sid, f2, last4, { android: isAndroid });
    await S.sleep(9000);
    notes.payGatePassed = !(await hasOtpField());
    if (!notes.payGatePassed) throw new Error(`the Pay dual-authentication gate rejected the phone last-4 (${last4})`);
    src = await shot('after_pay_otp');
  }

  // ── the OTHER Pay verification gate ──────────────────────────────────────
  // Some accounts hit a REACT-NATIVE "Verify your mobile number" screen instead of the Compose OTP
  // component: one full-width EditText covering all four boxes, a Verify button, a Resend link, and
  // NO `otp_textField` content-desc anywhere — so the check above walks straight past it and the run
  // then reports the dashboard as "empty" while still standing on the gate.
  // Which code it wants is ACCOUNT-DEPENDENT: this screen says the code was *sent*, so read Chat
  // first and fall back to the phone's last 4. Either way, verify the gate was actually left.
  // Detect by the SOURCE, not by an input element. On iOS this screen exposes NO
  // XCUIElementTypeTextField at all — the four boxes are keyboard-driven — and the entire screen's
  // copy is collapsed into one aggregated 200-character `name` on a container, which a label filter
  // capped at 90 chars silently drops. Requiring a field element here made iOS fall through the gate
  // and report "never reached the Pay dashboard".
  const payVerifyGate = async () => {
    const s = await S.source(sid) || '';
    const looksLikeGate = /verification code|رمز التحقق|Verify your mobile|تأكيد رقم/i.test(s);
    if (!looksLikeGate) return null;
    const el = isAndroid
      ? await S.find(sid, 'xpath', '//android.widget.EditText')
      : await S.find(sid, 'xpath', '//XCUIElementTypeTextField');
    return { el: el || null, src: s };            // a gate with no field is still a gate
  };

  /** Key a code into a gate that has no focusable field, by tapping the on-screen digit keys. */
  const keyDigits = async (code) => {
    for (const d of String(code)) {
      const k = await findDigitKey(sid, d, isAndroid)
        || (isAndroid ? null : { el: await S.find(sid, 'xpath', `//XCUIElementTypeKey[@name="${d}"]`) });
      if (!k || !k.el) return false;
      await tapCentre(sid, k.el);
      await S.sleep(400);
    }
    return true;
  };

  let gate = await payVerifyGate();
  if (gate) {
    const mark2 = Date.now();
    notes.payVerifyGate = { seen: true, codesTried: [] };
    // The code is sent when the gate RENDERS, which is before we finish detecting it — a lookback
    // anchored at detection time misses it by seconds and the run then falls through to last-4 and
    // fails (measured: code 3179 arrived at 17:01:30, detection a moment later, nothing matched).
    // So look BACK, but reject the LOGIN OTP from earlier in this same run, which is the exact trap a
    // wide lookback otherwise walks into.
    const chat = await fetchOtp(phoneE164, { timeoutMs: 60000, notBefore: mark2 - 150000 }).catch(() => null);
    const candidates = [];
    if (chat && chat.otp && chat.otp !== notes.loginOtp) candidates.push({ code: chat.otp, from: 'google-chat' });
    else if (chat && chat.otp === notes.loginOtp) notes.payVerifyGate.skippedLoginOtp = chat.otp;
    candidates.push({ code: last4, from: 'phone-last4' });

    for (const c of candidates) {
      notes.payVerifyGate.codesTried.push(c);
      const field = isAndroid ? await S.find(sid, 'xpath', '//android.widget.EditText')
        : await S.find(sid, 'xpath', '//XCUIElementTypeTextField');
      if (field) {
        try { await S.req('POST', `/wd/hub/session/${sid}/element/${field}/clear`, {}); } catch (_) { /* best effort */ }
        await S.fillSegmented(sid, field, c.code, { android: isAndroid });
      } else if (!(await keyDigits(c.code))) {
        notes.payVerifyGate.noInputRoute = true;
        break;                                   // neither a field nor digit keys — nothing to type into
      }
      await S.sleep(2000);
      for (const label of ['Verify', 'تأكيد', 'Continue', 'متابعة']) {
        const b = await findAny(sid, label, isAndroid);
        if (b) { await tapCentre(sid, b); break; }
      }
      await S.sleep(9000);
      gate = await payVerifyGate();
      if (!gate) { notes.payVerifyGate.acceptedFrom = c.from; break; }
    }
    src = await shot('after_pay_verify');
    notes.payVerifyGate.passed = !gate;
    if (gate) {
      throw new Error('the Pay verification gate rejected every code tried ('
        + notes.payVerifyGate.codesTried.map((c) => `${c.from}=${c.code}`).join(', ') + ')');
    }
  }

  // "Save card for a faster checkout" interstitial
  for (const nope of ['Not now', 'ليس الآن']) {
    const b = await findAny(sid, nope, isAndroid);
    if (b) { await tapCentre(sid, b); await S.sleep(5000); src = await shot('dashboard'); break; }
  }
  src = await S.source(sid) || src;
  notes.onDashboard = /Card balance|Add Money|رصيد البطاقة|إضافة أموال/i.test(src);
  if (!notes.onDashboard) {
    throw new Error('never reached the Pay dashboard — still on a gate. On screen: '
      + labels(src, isAndroid).slice(0, 12).join(' | '));
  }
  return { notes, src };
}

/**
 * From the Pay dashboard, open the card settings ("More") screen.
 *
 * The entry point is the unlabelled "..." control on the card artwork. It carries NO text, no
 * content-desc and no id on either platform, so it can only be located geometrically: same row as
 * Add Money / Send, at the trailing edge — right in LTR, left in RTL. It is NOT the bottom-bar "More"
 * tab, which is a different app-level screen.
 *
 * Returns the tap point so a caller can re-open the screen later without recomputing it.
 */
async function openCardSettings({ sid, platform, locale }) {
  const isAndroid = platform === 'android';
  const size = await S.windowSize(sid);
  const anchor = await findAny(sid, locale === 'ar' ? 'إرسال' : 'Send', isAndroid);
  let dots;
  if (anchor) {
    const r = await S.rect(sid, anchor);
    const x = locale === 'ar' ? Math.round(r.x - r.width * 0.55) : Math.round(r.x + r.width * 1.55);
    dots = { x: Math.max(20, Math.min(size.width - 20, x)), y: Math.round(r.y + r.height / 2) };
  } else {
    dots = {
      x: locale === 'ar' ? Math.round(size.width * 0.18) : Math.round(size.width * 0.82),
      y: Math.round(size.height * 0.365),
    };
  }
  await S.tap(sid, dots.x, dots.y);
  return { dots, size };
}

module.exports = { loginAndOpenPay, openCardSettings, findAny, findDigitKey, findVisible, tapCentre, labels, DIGIT_FORMS };
