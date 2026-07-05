# BrowserStack Process — Mobile Session, Appium API & CSV Import

> Detailed mobile-execution reference for the Breadfast QA Test Companion.
> CLAUDE.md is the orchestration layer; this file holds the implementation detail.
> Scope: iOS (iPhone) + Android, in Arabic (ar/EG) and English (en/US).

---

## 1. Environment Setup (before every session)

1. Active session ID lives in `D:/BreadfastQA/current_session.txt`. Read it before starting.
2. Check the session is alive:
   ```js
   const r = await bsReq('GET', `/wd/hub/session/${SID}`);
   console.log(r.status); // 'ready' or active
   ```
3. If none alive, create one with `start_session_arabic_locale.js` (Arabic) or the English equivalent.
4. Confirm screenshots accumulate in the correct JSON (see §6).
5. Confirm the build under test: `com.breadfast.testing`.

See the mobile WebDriver helper catalog in [appium-framework.md](automation/appium-framework.md).

---

## 2. Session Creation — Appium Capabilities (4 combinations)

All four platform × language combinations are required unless the user scopes down.

**iOS — Arabic (ar/EG):**
```js
const capabilities = {
  platformName: 'iOS',
  'appium:deviceName': 'iPhone 14',
  'appium:platformVersion': '18',
  'appium:app': 'bs://[IOS_APP_HASH]',
  'appium:automationName': 'XCUITest',
  'appium:language': 'ar',      // MUST be top-level, NOT inside bstack:options
  'appium:locale': 'EG',        // MUST be top-level, NOT inside bstack:options
  'bstack:options': {
    userName: process.env.BS_USER, accessKey: process.env.BS_KEY,
    projectName: 'Breadfast Card QA', buildName: '[STORY_ID] iOS Arabic',
    sessionName: 'iOS Arabic — [Flow Name]'
  }
};
```

**iOS — English (en/US):** same as above, **omit** `appium:language`/`appium:locale` (defaults to English).

**Android — Arabic (ar/EG):**
```js
const capabilities = {
  platformName: 'Android',
  'appium:deviceName': 'Samsung Galaxy S23',
  'appium:platformVersion': '13.0',
  'appium:app': 'bs://[ANDROID_APP_HASH]',
  'appium:automationName': 'UiAutomator2',
  'appium:language': 'ar', 'appium:locale': 'EG',
  'bstack:options': { /* same shape as above */ }
};
```

**Android — English (en/US):** same Android caps, **omit** language/locale.

**Critical rules:**
- `appium:language` + `appium:locale` MUST be top-level Appium caps on BOTH platforms. Inside `bstack:options` → schema validation error → session starts in English.
- iOS = `XCUITest`. Android = `UiAutomator2`. Never mix.
- iOS app hash ≠ Android app hash — upload the correct platform build.
- **iOS Settings access is blocked by BrowserStack** — never open Settings to change language; use capabilities only. Same for Android — change locale via caps, not Settings.

---

## 3. Step-by-Step Testing Procedure

```
1  Verify session alive
2  Initial screenshot — confirm correct screen
3  Read labels from page source — confirm language, content, layout
4  Execute the step (tap/type/swipe)
5  Wait for transition (sleep 1500–3000ms; Android slower)
6  Screenshot after navigation
7  Read labels — confirm expected screen loaded
8  Log key labels to console
9  Record pass/fail per test case
10 Write screenshots to JSON accumulator
```

---

## 4. Interaction Patterns

### 4.1 Navigation — extract coordinates from live XML (don't hardcode)
```js
async function tapByLabel(lbl) {
  const src = await getSource(SID);
  const escaped = lbl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`x="(\\d+)" y="(\\d+)" width="(\\d+)" height="(\\d+)"[^>]*label="${escaped}"`);
  const m = src.match(re);
  if (m) { await tap(SID, +m[1]+ +m[3]/2, +m[2]+ +m[4]/2); return true; }
  const el = await findElement(SID, 'xpath', `//*[@label='${lbl}']`);
  if (el) { await clickEl(SID, el); return true; }
  return false;
}
```
When coordinates fail: try alternate regex orderings → `accessibility id` → `xpath` → dump all buttons → known-good hardcoded coords.

**EXCEPTION — Pay screen always uses coordinate taps, never label-based.** Confirmed coords (device 390×844):
| Element | Coord |
|---------|-------|
| Card widget "Get started" / "ابدأ الآن" | (195, 540) |
| Activation "Got it" modal (no a11y label, RN view) | (195, 810) |
| Activation "Start" | XPath `//*[@label='Start']` + clickEl (~315, 580) |
| FAQ X close | (355, 57) |
| Pay tab | (273, 819) | 
| Home tab | (39, 819) |
| "Enter invitation code" | scroll down first (off-screen ~y1087 → ~y742), then tap |

### 4.2 Arabic-Indic numpad
Custom circular keypad uses `XCUIElementTypeButton` with Arabic-Indic digits in two Unicode ranges. The app uses **Extended Arabic-Indic (U+06F0)** for most digits. Always try both ranges + ASCII.
```js
const toArabicIndic    = {'0':'٠','1':'١','2':'٢','3':'٣','4':'٤','5':'٥','6':'٦','7':'٧','8':'٨','9':'٩'};
const toExtArabicIndic = {'0':'۰','1':'۱','2':'۲','3':'۳','4':'۴','5':'۵','6':'۶','7':'۷','8':'۸','9':'۹'};
```
RTL: digit ١(1) on the RIGHT of the top row, ٣(3) on the LEFT — reversed from LTR.

### 4.3 Text field input
- iOS: `findElements(SID, '-ios class chain', '**/XCUIElementTypeTextField')` → click → clear → set `value`.
- Android: `findElements(SID, 'class name', 'android.widget.EditText')` → click → clear → set `value` (or sendKeys).
- After setValue, the XML `label`/`text` may still show the placeholder; the real value is in `value`. Don't treat a persisting placeholder as failed input — verify on the next screen.

### 4.4 Dismiss keyboard
- iOS: tap neutral area `tap(SID, 195, 150)`.
- Android: `appium/device/hide_keyboard` OR press keycode 4 (back).

### 4.5 Back / close
- iOS back chevron: left side even in RTL, ~(15–40, 50–60). Arabic nav back often labeled `Back2`/`Back3` → `findElement('accessibility id','Back2')`.
- iOS unlabeled close (sheets): small 32×32 near top-right, e.g. `tap(SID, 366, 75)`.
- Android: keycode 4, or in-app arrow via `accessibility id 'Navigate up'` / content-desc (`رجوع` in Arabic).
- Bottom sheet dismiss: swipe down (pointer move 195,400 → 195,700).

### 4.6 Loading states
Look for `قيد التقدم` (In Progress). Poll `sleep(2000)` up to 8× before declaring timeout. BCID validation: server-side, poll up to ~16s.

---

## 5. OTP Rules

| OTP type | Rule | Entry method |
|----------|------|--------------|
| **Login OTP** | Fetch automatically from Slack `#testing-otp` (channel `C04TK0FM329`). Find latest message for the phone (+20 prefix), write to polling file (e.g. `ios_en_act_otp.txt`); `pollForOtp()` picks it up. | `typeDigitsW3C` (W3C keyboard) — never `tapDigitArabic` (fails on repeated digits). |
| **Card application OTP (1/3)** | Last 4 digits of test phone (01012350020 → 0020). | `typeDigitsW3C(PHONE.slice(-4))` |
| **Card activation OTP** (phone verify after "Start") | Last 4 digits of test phone — same rule. | `typeDigitsW3C` |

```js
async function typeDigitsW3C(code) {
  const keyActions = code.split('').flatMap(ch => [{type:'keyDown',value:ch},{type:'keyUp',value:ch}]);
  await bsReq('POST', `/wd/hub/session/${SID}/actions`, { actions: [{type:'key',id:'keyboard',actions:keyActions}] });
  await sleep(1500);
}
```

---

## 6. Screenshot Accumulators

| Platform | Language | JSON file | PNG prefix |
|----------|----------|-----------|------------|
| iOS | Arabic | `ios_ar_screenshots.json` | `ios_ar_s##_` |
| iOS | English | `screenshots_b64.json` | `s##_` |
| Android | Arabic | `android_ar_screenshots.json` | `and_ar_s##_` |
| Android | English | `android_en_screenshots.json` | `and_en_s##_` |

Snap before AND after every major action. Store base64 in the JSON under a semantic key; also write the PNG. Never skip a key screen. Figma frames stored in the same accumulator under `figma_en_*` / `figma_ar_*`.
```js
async function snap(key, file) {
  const r = await bsReq('GET', `/wd/hub/session/${SID}/screenshot`);
  if (typeof r.value !== 'string') return; // guard expired session
  shots[key] = r.value;
  fs.writeFileSync(file, Buffer.from(r.value, 'base64'));
  fs.writeFileSync(SHOTS_FILE, JSON.stringify(shots), 'utf8');
}
```

---

## 7. Page Source Analysis

```js
async function labels() {
  const src = await getSource(SID);
  return (src.match(/label="([^"]{1,120})"/g) || []).map(l => l.replace(/^label="|"$/g, ''));
}
```
Dump interactive elements by filtering `XCUIElementTypeButton`/`XCUIElementTypeOther` with `accessible="true"` and reading x/y.

---

## 8. Element Type & Locator Reference

**iOS types:** `XCUIElementTypeButton` (buttons, custom keypad), `…TextField`, `…SecureTextField`, `…Key`, `…StaticText`, `…Other`, `…NavigationBar`, `…TabBar`, `…ScrollView`.

**Android classes:** `android.widget.Button`, `…EditText`, `…TextView`, `…ImageButton`, `android.view.View`/`ViewGroup`, `…ScrollView`, `androidx.recyclerview.widget.RecyclerView`, `android.webkit.WebView`.

**iOS locator strategies:** `accessibility id`, `xpath`, `-ios class chain`, `-ios predicate string`.
**Android locator strategies:** `accessibility id`, `xpath` (by `@content-desc` or `@text`), `class name`, `id` (resource-id), `-android uiautomator`.

---

## 9. Known Quirks (do NOT report these as app bugs)

- **WebView network failures** (iOS `NSURLErrorDomain -1005`, Android `net::ERR_CONNECTION_RESET`) — BrowserStack tunnel limitation.
- **iOS Settings access blocked** — environment, not a defect.
- Tunnel latency: Android via tunnel ~1.5× slower than iOS; use longer sleeps. Session start: `sleep(8000–12000ms)` before interaction.
- Android startup slower than iOS (8–10s vs 5s).
- Arabic font metrics differ on Android — minor differences expected, not bugs.
- Android RTL mirroring may differ slightly from iOS — check design spec first.
- `XCUIElementTypeKey` may be absent on custom keypads — use `XCUIElementTypeButton`.
- Duplicate labels in iOS a11y tree (visible + off-screen scroll content) — don't count by label occurrence.

See [exploratory-testing.md](exploratory-testing.md) §"Failure patterns" for the full heuristics table.

---

## 10. BrowserStack Test Management — CSV Field-Mapping Spec

Generated test cases are managed in BrowserStack Test Management as CSV. **This spec is locked to the canonical BrowserStack export/import format** from `test_cases_BCard Squad (1).csv` (project **BCard Squad**, project id `2407303`). If a future import rejects this format, surface the divergence (governance: [release-validation.md](release-validation.md) §5) before changing the spec.

### 10.0 Canonical test-case standard (source of truth)
The **approved BrowserStack test cases** (canonical export `test_cases_BCard Squad (1).csv`, folder `48895703`; reference sample TC-49835) are the **source of truth** for ALL future test-case generation. Every generated case must match them exactly in **structure, field mapping, naming convention, and writing style**. Non-negotiable step rules (see also [testing-process.md](testing-process.md) §3.7):

- **Granular user-action steps**, in order: **Login → Navigate → Search → Open Details → Edit/Open form → Action → Verify**. One user action per step.
- **Every step has its own Expected Result** (N steps → N expected results; validate 0 steps missing an expected result before export).
- **Never combine multiple actions in one step**; navigation, validations, and verifications are each explicit steps.
- **Titles**: descriptive `Verify …` sentences. **Type of Test Case** restricted to the canonical vocabulary (§10.2). **Template** always `Steps`.
- **Reuse the generator** `D:\Playwright\b55168_pom\gen_browserstack_csv_b10_56336.js` (reusable step preambles `OPEN_EDIT` / `OPEN_VIEW_REG` / `OPEN_VIEW_RECEIVED`) — adapt per story, don't re-derive the format.

This is automatic for every story — no extra instruction needed.

### 10.1 Column order (exact — header row, 24 columns)
```
Test Case ID,Title,Folder ID,Folder Path,State,Owner,Priority,Type of Test Case,Automation Status,Description,Preconditions,Template,Steps,Expected Result,Issues,Tags,Status (latest),Attachments,Created At,Created By,Last Updated At,Last Updated By,Project Name,Test Case URL
```

### 10.2 Field mapping
"Source" = **author** (we provide it) or **system** (BrowserStack generates/owns it — leave blank when importing new cases).

| # | Column | Source | Meaning | Observed values / format |
|---|--------|--------|---------|--------------------------|
| 1 | **Test Case ID** | system | BrowserStack ID | `TC-49841` (assigned on import; blank for new) |
| 2 | **Title** | author | Full descriptive title | Sentence form, e.g. `Verify DOB for a user exactly 15 years old is accepted in Admin Portal` |
| 3 | **Folder ID** | author/system | Target folder numeric id | `48895703` |
| 4 | **Folder Path** | author | Human folder path (`>`-delimited) | `2026.Q2.S5>Update date-of-birth minimum age configuration in Admin Portal from 16 to 15` |
| 5 | **State** | author | Case lifecycle state | `Active` |
| 6 | **Owner** | author | Owner name | `Fintech` |
| 7 | **Priority** | author | Test priority | `High` · `Medium` · `Low` (also `Critical`). Distinct from bug P1–P4. |
| 8 | **Type of Test Case** | author | Test category | `Acceptance` · `Regression` · `Functional` · `Usability` · `Smoke & Sanity` |
| 9 | **Automation Status** | author | Automation state | `Not Automated` (also `Automated`, `Automation Not Required`) |
| 10 | **Description** | author | Intent of the case | Free text (may contain newlines) |
| 11 | **Preconditions** | author | Setup/state before steps | Free text (may contain newlines). Note: header is `Preconditions` (no hyphen). |
| 12 | **Template** | author | Case template type | Always `Steps` |
| 13 | **Steps** | author | One test step | Free text. **One row per step.** |
| 14 | **Expected Result** | author | Expected outcome of that step | Free text, paired with the Step on the same row |
| 15 | **Issues** | author | Linked Jira key | Story id, e.g. `B10-55294` |
| 16 | **Tags** | author | Tags | `ai-created` for generated cases |
| 17 | **Status (latest)** | system | Latest run status | Blank until executed |
| 18 | **Attachments** | system/author | Attachment refs | Blank |
| 19 | **Created At** | system | Creation timestamp | `MM/DD/YYYY HH:MM:SS` (e.g. `06/08/2026 10:01:33`) |
| 20 | **Created By** | system | Creator | `Fintech` |
| 21 | **Last Updated At** | system | Update timestamp | `MM/DD/YYYY HH:MM:SS` |
| 22 | **Last Updated By** | system | Last editor | `Fintech` |
| 23 | **Project Name** | author | BrowserStack project | `BCard Squad` |
| 24 | **Test Case URL** | system | Direct case URL | `https://test-management.browserstack.com/projects/2407303/folder/<folderId>/test-cases/<id>` |

### 10.3 Multi-step row pattern (critical)
Each test case spans **one row per step**:
- **First row of a case** — populate columns 1–16 + 19–24 (Test Case ID, Title, Folder ID/Path, State, Owner, Priority, Type, Automation Status, Description, Preconditions, Template=`Steps`, Steps=step #1, Expected Result=step #1, Issues, Tags, then the system timestamp/owner/project/URL columns), Status (latest) + Attachments blank.
- **Each subsequent step row** — **all columns blank EXCEPT** column 13 **Steps** and column 14 **Expected Result** (i.e. 12 leading empty fields, the step text, the expected text, then 10 trailing empty fields).

Example (first row + one continuation row):
```
TC-49826,Verify DOB for a user 14 years and 364 days old is rejected in Admin Portal,48895703,2026.Q2.S5>Update date-of-birth minimum age configuration in Admin Portal from 16 to 15,Active,Fintech,High,Functional,Not Automated,"Validates that a DOB making the user 14 years and 364 days old (one day short of 15) is rejected ...","Agent is logged into the Admin Portal. A customer record is accessible via Search Cards.",Steps,"Log in to the Admin Portal and navigate to Card Users > Search Cards","Agent is logged in and Search Cards page is displayed",B10-55294,ai-created,"","",06/08/2026 10:01:13,Fintech,06/08/2026 11:29:36,Fintech,BCard Squad,https://test-management.browserstack.com/projects/2407303/folder/48895703/test-cases/111691123
,,,,,,,,,,,,"Search for a customer and open their details page, then click 'Edit'","Edit Customer Details modal is displayed",,,,,,,,,,
```
(For brand-new cases being imported, leave the **system** columns — Test Case ID, Created/Updated At/By, Test Case URL, and Status (latest) — blank; BrowserStack fills them.)

### 10.4 Quoting & encoding (standard CSV)
- Wrap any field containing a comma, double-quote, or **newline** in double quotes. Many Description/Preconditions/Steps/Expected cells in the canonical file contain embedded newlines — that is expected; keep them inside quotes.
- Escape an internal double-quote by doubling it (`""text""`).
- UTF-8 encoding (Arabic expected text must round-trip).

### 10.5 End-to-end BrowserStack workflow (run automatically every story)
This is the standing process — no extra instruction required:

1. **Generate test cases** from the AC/HLS following the canonical standard (§10.0).
2. **Generate the BrowserStack-compatible CSV** per §10.1–10.4 (24-column header byte-exact; one row per step; every step has an Expected Result; Folder Path `>`-delimited).
3. **Ask for BrowserStack credentials if not available** (saved as User env vars `BS_TM_USERNAME`/`BS_TM_API_TOKEN` + `BROWSERSTACK_USERNAME`/`BROWSERSTACK_ACCESS_KEY`). UI login (when API is SSO-blocked) uses the Test Management web login.
4. **Ask for the project/folder destination if not provided** (project id `2407303` = BCard Squad; set Folder ID / Folder Path).
5. **Upload the test cases** (§10.6).
6. **Verify the import succeeded** — folder count = expected case count (e.g. `28(28)`), cases land directly in the target folder (no nested/duplicate folder), open one case and confirm the Steps & Results render granularly with an expected result per step. Record destination + result in the story report.

### 10.6 Upload method — Test Management UI via Playwright (proven)
The Test Management **REST API is SSO-gated** for this org (the App Automate access key returns 401 + `auth/start-sso`), so import is driven through the **UI with Playwright**, logged in via the Test Management web login. Reusable API importer (`D:\Playwright\b55168_pom\import_browserstack_csv.js`) is kept for when API access is enabled.

UI flow (logged in):
1. Navigate to `test-management.browserstack.com/projects/2407303/folder/<FOLDER_ID>/test-cases` → **Import Test Cases** (deep link `/projects/2407303/import?folder=<FOLDER_ID>`).
2. Upload the CSV → **Proceed** → **Map Fields** (24 values auto-map) → **Proceed** → **Import Test Cases** (final).
3. Verify the folder count and open a case to confirm structure.

**Gotchas (learned, must apply):**
- **File upload root**: the Playwright MCP only allows files under `d:\BreadfastQA` and the drive letter must be **lowercase `d:`** — copy the CSV to `d:\BreadfastQA\.playwright-mcp\` first.
- **Two file inputs**: the AI-generate input's `accept` also contains `.csv`; target the IMPORT input (whose `accept` **starts with `text/csv`**) to arm the chooser, else the file lands in the AI panel.
- **Folder Path mapping**: when importing into a PRESELECTED folder (`?folder=<id>`), set **Folder Path → "Ignore This Field"** at Map Fields. Leaving it mapped to "Folder Name" CREATES a duplicate nested folder subtree inside the target (had to be deleted on B10-56336). The CSV still carries Folder Path (canonical format) — it's just ignored at map time.
- **Delete cases**: select-all-on-page → toolbar overflow "⋮" → **Delete Permanently** → type `delete` → confirm. **Delete a folder**: tree-node kebab → **Delete Folder Permanently**.

First successful run: **B10-56336**, 28 cases / 157 steps imported into folder `50396881` (Card.Core.Sprint.3 > Extend Admin Portal with All KYC Fields).

---

## 11. Core API Patterns (raw WebDriver over REST)

```js
// Screenshot
const r = await bsReq('GET', `/wd/hub/session/${SID}/screenshot`);
// Page source
const src = await bsReq('GET', `/wd/hub/session/${SID}/source`);
// Tap (W3C pointer)
await bsReq('POST', `/wd/hub/session/${SID}/actions`, { actions: [{ type:'pointer', id:'f1',
  parameters:{pointerType:'touch'}, actions:[
    {type:'pointerMove',duration:0,x:X,y:Y},{type:'pointerDown',button:0},
    {type:'pause',duration:50},{type:'pointerUp',button:0}]}]});
// Type into element
await bsReq('POST', `/wd/hub/session/${SID}/element/${id}/value`, { text:'v', value:'v'.split('') });
// Clear / native back
await bsReq('POST', `/wd/hub/session/${SID}/element/${id}/clear`, {});
await bsReq('POST', `/wd/hub/session/${SID}/back`, {});
```

Helper functions (`bsReq`, `getSource`, `findElement(s)`, `clickEl`, `tap`, `sleep`) are catalogued in [appium-framework.md](automation/appium-framework.md).
