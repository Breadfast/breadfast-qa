# Testing Process — Methodology, Test Design & Figma Visual Comparison

> Core QA methodology for the Breadfast Test Companion. Orchestration lives in CLAUDE.md;
> this file holds the standing methodology that every story passes through.

---

## 1. Testing Philosophy

End-to-end functional QA of the Breadfast mobile app on **iOS and Android**, in **Arabic (ar/EG) and English (en/US)**, plus backend/API/automation where the story requires it. Always behave as a senior QA engineer (5+ yrs mobile): realistic user journeys against the exact production-candidate build, never shallow coverage.

**Platform × Language matrix — all four are required per feature unless scoped down:**

| | English (en/US) | Arabic (ar/EG) |
|---|---|---|
| **iOS (iPhone 14 / iOS 18)** | Required | Required |
| **Android (Samsung Galaxy S23 / Android 13)** | Required | Required |

Standing rules:
- Never assume a screen is correct because it rendered — read labels from page source.
- Never mark PASS without screenshot evidence on each tested platform × language.
- Never mark PASS without a Figma comparison result (§4).
- Always test the full journey, not isolated screens.
- Platform differences are expected and documented — not automatically bugs.
- Treat test-environment seeded data ("merchantperk", "test", "LOGO ENGLISH LOGO") as test data, not bugs.
- Production safety: only the test build `com.breadfast.testing`, never production credentials/endpoints.
- **Verify persistence/traceability ACs on the destination, not the request.** Any AC with verbs like *recorded / logged / traceable / audited / persisted / reflected / reported* must be confirmed on the actual destination surface — the audit log, report screen, transaction history, or DB — **never** inferred from "the request sent the field and returned 200." Accepting input ≠ persisting/tracing it. (Card Portal destinations: Reports → Audit Trail `POST /web/user/action/getOrganizationActions`; Reports → Audit log `wallet-audit-log`; Reports → Transaction Details.) *Lesson from B10-55570 AC4 → B10-57179: an adjustment returned 200 with the card id on the request but was never written to the Audit Trail.*
- **Never turn an unverified item into a ✅.** If a surface or AC was not actually checked, mark it ⚠️ not-verified (or ⛔), never PASS.
- **Ask for missing credentials/access up front; never silently skip a step.** Known needs: BrowserStack UI login (TM CSV import), Jira API token (attachments / REST), card-panel login.

### Scope expansion (2026 update)
This work now spans the **full QA lifecycle**, including authoring and running automation (Playwright + Appium + API/DB). This supersedes the earlier "this is NOT automated/API testing" statement. Manual visual QA remains the core; automation is a first-class deliverable when the story warrants it. See [automation/reusable-components.md](automation/reusable-components.md) — always reuse existing framework assets before writing new ones.

---

## 2. Testing Priorities (ordered)

1. Regression prevention — happy path still works end-to-end before edge cases.
2. Realistic user behavior — real test accounts, realistic data (Arabic names, valid NIDs, valid expiry).
3. Cross-platform consistency — iOS ≡ Android behavior; deviations documented.
4. Cross-language consistency — every EN flow mirrored in AR (RTL, Arabic-Indic numerals, labels, direction).
5. Production safety.
6. UX consistency — step indicators (1/3…), back/close, error messages, success screens match spec.
7. Edge-case validation — wrong OTP, duplicate NID, mismatched passcode, invalid BCID.
8. Error resilience — graceful Arabic error labels, retry flows.
9. Mobile responsiveness — all interactive elements tappable/visible on target devices.

---

## 3. Test Case Design Rules

### 3.1 Coverage priority
1. Golden path iOS EN (baseline, 100% before expanding) → 2. iOS AR → 3. Android EN → 4. Android AR → 5. Error paths → 6. Boundary conditions → 7. Recovery flows → 8. Navigation integrity.

### 3.2 Per-screen checklist (all applicable platform × language)
- Title/header correct in both languages, both platforms.
- Step indicator correct (1/3, 2/2…).
- All interactive elements tappable.
- Layout direction correct (LTR EN / RTL AR).
- Arabic text uses real Arabic chars (not placeholder ASCII); Arabic-Indic numerals where appropriate.
- Back/close works (iOS chevron / Android system back or in-app arrow).
- Success action navigates to correct next screen.
- Font rendering acceptable (minor platform differences OK).
- Figma content match EN + AR; Figma style match iOS + Android (§4).
- Figma reference screenshot stored under `figma_en_[screen]` / `figma_ar_[screen]`.

### 3.3 Arabic-specific (both platforms)
All static labels, placeholders, error messages in Arabic; Arabic-Indic numerals on custom keypads; RTL primary flow; mirrored tab bar/nav; Arabic date format; Android system UI switches to Arabic/RTL.

### 3.4 Platform-parity (iOS vs Android)
Same titles/labels (exact text), same step indicators, same screen order, same error messages, same success screens, no feature present on one platform and missing on the other (unless by design), appropriate keyboard type per field.

### 3.5 Risky areas (extra scrutiny)
Custom keypads · horizontal carousels · bottom sheets/modals (state preserved behind) · multi-step flows (indicator increments) · duplicate-constraint fields (NIDs — use fresh data) · WebView screens (env failures) · status-dependent screens (activation needs backend status change).

### 3.6 Ambiguous behavior
Check PRD/AC → Figma → compare to other language → ask PO before classifying as bug → document as "Needs Clarification".

### 3.7 Test-case step structure — CANONICAL PROJECT STANDARD (mandatory)
All generated test cases — for every story, every platform — MUST follow the structure of the **approved BrowserStack test cases** (project **BCard Squad**, canonical export `test_cases_BCard Squad (1).csv`, folder `48895703`; reference sample TC-49835). That approved set is the **source of truth** for test-case generation. Rules:

1. **Granular user-action steps.** Decompose the journey into one user action per step, in order: **Login → Navigate → Search → Open Details → Edit/Open form → Action → Verify**. Example sequence: "Log in to the Admin Portal with valid agent credentials" → "Navigate to Card Users > Search Cards and search for a customer by mobile number" → "Click 'More Details' to open the customer details page" → "Click 'Edit' to open the Edit Customer Details form" → "<the specific action>" → "<the verification>".
2. **Every step has its own Expected Result.** No step may be left without a paired expected result. (A case with N steps has N expected results.)
3. **Do NOT combine multiple actions into one step.** "Fill the fields and click Confirm" is two steps. Each navigation, each field entry of interest, each click, each verification is its own step.
4. **Navigation, validations, and verifications are explicit steps** — never implied or folded into another step.
5. **Match the approved CSV exactly** — column structure, field mapping, naming convention (descriptive `Verify …` titles), writing style, Priority/Type vocabulary, and Preconditions style. Full spec + import workflow: [browserstack-process.md](browserstack-process.md) §10.
6. **Reuse the generator.** `D:\Playwright\b55168_pom\gen_browserstack_csv_b10_56336.js` encodes this structure with reusable step preambles (`OPEN_EDIT`, `OPEN_VIEW_REG`, `OPEN_VIEW_RECEIVED`). Adapt it per story rather than re-deriving the format. Validate before export: 0 steps missing an expected result.

This standard is automatic for every future story — no additional instruction required.

### 3.8 Automation mirrors the approved test cases 1:1
The automated suite is a **1:1 mirror of the imported BrowserStack test cases**: one automated test per case, **named identically to the BrowserStack title** (verbatim, no `[TC_...]` prefix — the BrowserStack case id is the traceability key), and **each assertion checks that case's expected result** (so a failure means the feature deviates from the AC, and per-case status maps straight to a defect). Consequences:
- A test that covers a persistence/traceability AC must assert against the **destination** (§1), e.g. query the audit-trail API after posting — not just that the request returned 200.
- For ACs that can't be exercised (no role account, surface not present), use an explicit **skip with a reason** so the status is visible — never a silent pass.
- Generate a per-test-case report so every case shows PASS / FAIL / SKIP and its mapped defect (see [release-validation.md](release-validation.md) §2). *Pattern established on B10-55570: `B10-55570_browserstack_suite.spec.js` (28 cases) + `gen_suite_report.js`.*
- **Maintain a test-case → script mapping table** in the story's automation `README.md`: BrowserStack Case ID + Title → spec file → automated? (with a reason for any non-automatable case). This makes 1:1 coverage auditable. Format + rules: [coding-standards.md](automation/coding-standards.md) "Test-case → script traceability".

---

## 4. Figma Visual Comparison — MANDATORY

A test case is not complete without a Figma comparison result. Three non-negotiable rules:

1. **Content must match Figma exactly** — both platforms, both languages. Wrong/missing/extra text = bug.
2. **Content must be identical across iOS and Android** — same EN text on both, same AR text on both. Any cross-platform content difference is a platform-specific bug.
3. **Style may differ between iOS and Android** — each platform matches its own Figma frame. Minor rendering differences (font hinting, shadow, corner radius) consistent with the platform frame are expected, not bugs.

**RTL rule:** AR frame is the reference for AR layout; EN frame for EN. Never compare an AR screenshot to an EN frame or vice versa.

### 4.1 Fetch workflow (before running test cases) — MCP BATCH EXPORT FIRST

> **⚠️ The Figma file key is PER-STORY.** It is NOT a constant. Every story links its own Figma
> design; the key lives in that URL — `https://www.figma.com/design/<FILE_KEY>/<name>?node-id=<frame>`.
> Always read the Figma link from the Jira story under test (description / attachments / comments),
> then derive the key with `FigmaExporter.fileKeyFromUrl(storyFigmaUrl)`. The node IDs are per-story
> too (from each frame's `node-id`). **The only thing reused across stories is the API token**
> (`automation/config/figma.js` / `FIGMA_API_TOKEN`) — never hardcode a file key or node IDs in the
> helper or config. (`tvvGnEaxVjJvMWOTl4zjZC` is just B10-56336's key, used as an example only.)

**Step 0 — mandatory session check (before opening the browser):** verify the Settings → Figma
Browser Session cookies are saved and fresh (`GET /figma/status` in the QA Platform, or the
Settings page badge). If `disconnected` or `expired`, **stop and ask the tester to (re)authenticate**
via Settings → Figma Browser Session → Connect/Reconnect Figma — never attempt the batch export
against a missing/stale session and silently fall through to REST/spec-only. In the QA Platform
this is enforced in code: `apps/worker/src/nodes.ts` → `figma_analysis` calls
`getFigmaSessionStatus()` first and pauses the run (`ask.awaiting`) if not `connected`.

**Primary method: Playwright MCP batch export (Ctrl+Shift+E → ZIP).** Navigate to the story's
Figma file with the container frame pre-selected (via `?node-id=<frame>` in the URL), press
`Ctrl+Shift+E` to open the global export dialog, verify "N of N selected", click Export, and
extract the downloaded ZIP to the story's `figma-analysis/` folder. The MCP browser is always
authenticated — no API quota, no rate-limit. Output is **individual named screens** at the
designer-configured resolution (typically 2× 750×1624 px for mobile) — one file per screen state,
named by the Figma layer name, mapping 1:1 to test cases. Zero post-processing needed.

```
Step-by-step (Playwright MCP):
1. browser_navigate → https://www.figma.com/design/<FILE_KEY>/design?node-id=<CONTAINER_FRAME>
2. browser_wait_for  → canvas element + title contains "–"
3. browser_press_key → Control+Shift+E   (opens batch export dialog)
4. Verify dialog shows "N of N selected"
5. browser_click     → Export button (getByLabel('Export').getByRole('button', {name:'Export'}))
6. Wait for download event → save ZIP → Expand-Archive to figma-analysis/
```

Output: individual PNGs named by screen state (`Sufficient balance.png`, `CVV.png`,
`Checkout.png`, etc.) stored directly in the story's `figma-analysis/` folder. These are the
Figma reference files for visual comparison (§4.2–4.4).

**When to fall back to REST API:** use `FigmaExporter.exportNodes()` only for frames that are
**not pre-configured for export** in the designer's file (e.g. a newly added Arabic-only frame
with no export settings), or when an exact node ID is needed for a diff against a prior run.
REST API is token-efficient (downloads straight to disk) but **rate-limits aggressively on the
View seat** (Retry-After up to 77+ hours observed 2026-06-29) — do not treat it as the default.

```js
// Fallback only — explicit node IDs for frames not covered by batch export:
const FigmaExporter = require('../../automation/helpers/FigmaExporter');
const fx = new FigmaExporter();
await fx.exportNodes({ fileKey, outDir, scale: 2, nodes: [
  { id: '2603:2312', name: 'figma_ar_balance' },
]});
```

No frame found → log `[FIGMA] No frame for: <screen>` and mark `NO FIGMA REF`.

### 4.2 What to compare
**Content (exact):** screen title, button text, step indicators, placeholders, error copy, body copy, icon presence.
**Style (per-platform frame):** primary color, typography (SF Pro iOS / Roboto Android — family differs, size/weight must match), corner radius, nav style, input style, icon rendering.

### 4.3 Mismatch classification
| Mismatch | Severity | Action |
|----------|----------|--------|
| Wrong text label (EN or AR) | High | Bug; block PASS |
| Missing element present in Figma | High | Bug; block PASS |
| Extra element not in Figma | Medium | PO clarification; flag |
| Wrong icon | Medium | Bug; block PASS |
| Wrong color vs platform frame | Medium | Bug; flag |
| Wrong layout direction (LTR where RTL) | High | Bug; block PASS |
| Style diff matching platform frame | None | "platform-appropriate"; PASS |
| Style diff, no platform-specific frame | Low | "needs designer review" |
| Figma frame missing | None | `NO FIGMA REF`; functional result still applies |

### 4.4 Decision tree
No frame → `NO FIGMA REF` (functional only). Frame exists → content mismatch → `FIGMA MISMATCH` (bug, block PASS). Content OK → style mismatch → content-impacting? yes → bug; no → `STYLE NOTE`. Style OK → `MATCHES FIGMA` → visual PASS.

Reference flow frames: [figma_full_flow_reference.md](../../figma_full_flow_reference.md).

### 4.5 Figma fetch order & fallbacks (MANDATORY — never stop QA on a failure)
Capture in this order; each step is a fallback for the one above. **Do not stop the QA process.**

1. **Playwright MCP batch export (PRIMARY)** — `Ctrl+Shift+E → ZIP → extract` (§4.1). The MCP
   browser is always authenticated; no API quota; no Retry-After. Produces individual named screen
   files at 2× the designer-configured resolution. Works for every story where the designer has
   pre-configured export settings on frames (standard practice on the Fintech team).
2. **REST API export** — `FigmaExporter.exportNodes()` for specific frames not covered by the batch
   export (e.g. a newly added frame without export settings). Needs explicit node IDs. Rate-limited
   on View seats (Retry-After up to 77+ hours observed 2026-06-29) — use sparingly.
   - Need a token: Figma → Settings → Security → Personal access tokens, scope `file_content:read`;
     set `FIGMA_API_TOKEN` or `automation/config/figma.js`.
   - `GET /v1/files…` (used by `exportPage`) rate-limits faster than `/images` — prefer explicit
     node IDs from the Figma URL `node-id` or MCP `get_metadata`.
3. **Figma MCP `get_metadata`** — enumerate node IDs when unknown. Use `get_screenshot` as a last
   resort; it hits a **per-seat tool-call cap** on the Professional View seat.
4. **Continue** requirements validation and design-vs-implementation comparison using whatever was
   captured (§4.2–4.4); store as `figma_*` in the story folder.
5. If design access is truly impossible, record `NO FIGMA REF` and proceed on functional results —
   only after exhausting steps 1–3.

*History: B10-56336 (2026-06-24) — MCP `get_screenshot` hit quota; REST API promoted to primary.
B10-Card-Balance (2026-06-29) — REST API rate-limited (77h); Playwright MCP batch export (ZIP)
produced 37 named individual screens at 750×1624 px, decisively better output than container
frames. MCP batch export is now the documented primary.*

---

## 5. Screenshot Strategy
Snap before and after every major action; sequential prefixed names; store base64 in the correct accumulator (see [browserstack-process.md](browserstack-process.md) §6) with a semantic key. Missing screenshot on a key screen = incomplete evidence = not PASS.

---

## 6. Minimum Deliverables Per Story
- ≥1 screenshot per key screen per platform × language (4 sets).
- Figma comparison result (MATCHES / MISMATCH / NO REF) per screen, EN + AR.
- Pass / Fail / Blocked per AC item per tested platform × language.
- **Per-test-case evidence for EVERY executed case — passed AND failed** (see [release-validation.md](release-validation.md) §2.1): Test Case ID, Pass/Fail, screenshot(s), Expected Result, Actual Result, Figma/Design reference, and a Design-vs-Implementation note. Every validation must be traceable through screenshots/evidence.
- All bugs documented (see [bug-reporting.md](bug-reporting.md)).
- HTML report regenerated (`test_report_[STORY_ID].html`).
- Memory updated with reusable knowledge (not story-specific noise).

Quality gates and sign-off live in [release-validation.md](release-validation.md).

---

## 7. Test Data Management (mandatory) — DYNAMIC PROVISIONING

**Standard (2026-06-22): create test data per-run via API, delete it from the DB after.** No static
sheet. This ports the canonical Java framework's idea (`cardService/adminPanel/CardAdminPanelTests`
+ `TestExecutionHelper.registerUsingApi` + `CardServiceApiClient`) into the Playwright/JS layer.

Shared helper `automation/helpers/CardUserFactory.js`:
- `await factory.provision()` → registers a brand-new card user up to status **Registered** and returns
  `{ phone, searchMobile, breadfastId, nationalId, email, firstName, lastName, localPhone }`.
  Flow: `send-otp` → read OTP from `breadfast_testing.bf_phone_otp_verification` (DB) → `verify-otp`
  → `register` (breadfast_id) → card-service scheme token → **invitation gate** (generate → export → consume;
  testing is invite-only, else createCardUser 400s "Access is by invitation only") → `createCardUser`
  (Pending; **Arabic** names required) → `createPin` (Registered).
  Two DB connections are used: **OTP read** on the breadfast host (PropertiesReader → `config_testing.properties`),
  **teardown** on the live card host configured in `CardConfig.cardDb` (the Java config's card DB host is stale;
  env-overridable via `BF_CARD_SSH_*`/`BF_CARD_DB_*`). `DbHelper` supports password SSH + an explicit config object.
  Verify teardown with `factory.existsViaApi(searchMobile)` (authoritative — uses the allWallets API, not the DB).
  A freshly provisioned user is Registered with **no KYC details** — ideal for gate/edit tests.
- `await factory.destroy(phone)` → deletes the user from `cards_hades_testing` (actions_logger,
  wallet_user_sessions, cards, external_user_balances, wallet_users by `mobile_number`). Idempotent.
- `CardUserFactory.randomPackageNumber()` → random 6-digit collect package (retry on the rare
  `/received` 400 "already assigned" collision).
- `searchMobile` (= phone without the `+2` prefix, e.g. `011…`) is what the admin-panel search box expects.

Supporting helpers: `EncryptionHelper.js` (RSA-OAEP-SHA256 for the encrypted card endpoints, reads the
Java `cardServiceEncryptionPublicKey.pub`), `CardConfig.js` (URLs/scheme creds/passcode/NID-expiry read
live from the Java `.properties` — **no secrets duplicated** into this repo), `DbHelper.js` (MySQL over SSH).

Spec pattern:
- **Non-destructive suites** (edit/validation, gate checks): `beforeAll` → `provision()` once; `afterAll` → `destroy()`.
- **Destructive flow** (full collection → Received, PDF reprint): provision a dedicated user inside the
  test, run, and `destroy()` in `finally` (so a failure still cleans up).

Rules:
- **Never hard-code phone/package/customer values, and never depend on pre-existing records.** Provision fresh.
- **Always tear down** what you provisioned (DB delete) — leave the env clean. Use `finally` for destructive flows.
- Reaching **Received** for the current build uses the UI (`EditCustomerPage.fillAllValid` + `CollectDialogPage`)
  because the legacy Java `editCustomerDetails` API predates B10-56336's new KYC fields and won't satisfy the
  new completeness gate.

> **DEPRECATED:** the static `D:/BreadfastQA/test_data_inventory.csv` + `TestDataInventory.js`
> (Available/Consumed/Reserved ledger) are superseded by the above and no longer used by the KYC specs.
> Kept temporarily for reference; remove once dynamic provisioning is verified against a healthy env.
> If a flow genuinely cannot be provisioned via API, fall back to requesting data from the user — never invent it.
