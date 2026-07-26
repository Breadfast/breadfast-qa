# B10-56750 — Automation (Playwright, web / Card Admin Panel)

Automates the **Add Section to All Perk Types** story: the required Section
dropdown (shared surface with B10-56729) and the brand-new **"Add Section"**
inline-creation modal. Specs mirror the approved BrowserStack test cases 1:1
and cover AC-01 through AC-17 (14 ACs + 6 risk-driven, non-AC cases).

## Where things live
- **Specs + self-contained config:** `automation/tests/*.spec.js` + `automation/playwright.config.js`
  (this folder), matching the B10-56757 "each story owns its architecture" pattern.
- **Shared page object:** reuses & extends `D:\breadfast-qa\automation\pages\PerksPage.js`
  (new **"B10-56750"** Add Section modal method group + a `skipSection` option
  added to B10-56729's `fillGeneralCashbackMandatory`) — no parallel page
  object was created (reuse-before-build). The Section dropdown ITSELF
  (`mat-select[formcontrolname="section_id"]`) is the exact same control
  B10-56729 already selectored — not re-selectored here.
- **Runnable mirror:** `PerksPage.js` is mirrored byte-for-byte to
  `D:\Playwright\b55168_pom\pages\PerksPage.js`.

## How to run
```bash
cd D:\breadfast-qa\B10-56750\automation
npx playwright test                                 # whole suite (20 tests)
npx playwright test tests/add_section_dropdown.spec.js      # AC-01–AC-04
npx playwright test tests/add_section_modal.spec.js         # AC-05–AC-10, TC19
npx playwright test tests/add_section_cross_story.spec.js   # AC-11–AC-14, AC-17, localization, consistency, TC20 E2E
```
Login uses `ConfigReader.getAdminUserName()/getAdminPassword()` (admin panel
`agent`) against `card-panel-testing.breadfast.tech`.

### Destructive / gated tests
| Env flag | Enables |
|----------|---------|
| `RUN_PERK_CREATE=1` | actually save a perk in the AC-11/B10-56757 cross-story test and the TC20 E2E happy path |

All other tests create real **Sections** (there is no "Cancel"-only path for
most of them — creating a Section IS the thing under test) but do NOT save a
**perk**, so the perks list itself stays clean; the Section dropdown will
accumulate `QA ...`-prefixed test sections across runs (harmless test data,
consistent with how the sibling stories already leave test perks behind).

## Live-driven selector capture (2026-07-16, card-panel-testing)
Every selector in the new "B10-56750" PerksPage block — the Section
dropdown's `+ Add section` row, the Add Section modal, its fields/CTAs, the
duplicate-name error, and the Merchant/Category pickers needed to exercise
Section behavior across perk types — was captured by **actually driving the
live admin panel** (Playwright MCP browser), not inferred from Figma or the
BrowserStack CSV text. This surfaced several **confirmed live deviations**
from the documented AC/CSV wording and the Figma export — see
`ac-coverage-matrix.md` "Live findings" for the full list, including:
- The Add Section modal's title/labels differ in casing/wording from the CSV
  ("Add section" vs "Add Section"; "Section name EN/AR" vs "Section name
  English"/"Section Name Arabic").
- **AR IS required** live (resolves the AC-05 ambiguity flagged in
  requirements-analysis.md Risk 2).
- **No distinct "X" close icon exists** on the modal (only Cancel) — a live
  deviation from TC11's wording.
- The duplicate-name error is a **shared message**, not a red per-field
  highlight — a live deviation from AC-09's wording.
- The live-seeded Section data is only **Breadfast** + **General Purchases**
  (not the four shown in the reused Figma export) — and "General Purchases"
  (not "General") is confirmed as the real name, resolving the AC-14
  Figma-vs-AC naming discrepancy in the AC text's favor.
- No character cap was observed on the Section name field.
- The "+ Add section" row is a **disabled `<mat-option>` wrapping an enabled
  `<button>`** — clicking it requires `{ force: true }` (documented in
  `PerksPage.openAddSectionModal()`).
- The create-section endpoint is `POST /api/v1/web/card/perks/section/create`
  (`{name_en, name_ar}` → 200, or 400 `{"message":"This section already
  exists"}` on duplicate) — captured via direct network inspection and reused
  for a genuine parallel-request concurrency test (TC19).

## Known follow-ups / honestly-unverified items
- **AC-13 (mobile Section-tab ordering)** is only checked from the admin
  dropdown/API, per the story's own scope — full "Breadfast first, rest
  alphabetical" confirmation needs the Breadfast Pay **mobile app**, out of
  this Playwright/web run's reach. The admin dropdown's own order was simply
  recorded, not asserted against, since Figma already flags that the admin
  dropdown's internal order is not guaranteed to be Breadfast-first.
- **AC-14 (data-migration backfill)** is intentionally `test.skip` with the
  reason recorded — it is a DB/API verification of existing perks' Section
  assignment, not a Create-Perk UI flow, and no DB/API access was available in
  this Playwright-only run.
- **Full ar-EG locale-switch localization (non-AC risk case)** — no dedicated
  Arabic/locale-switcher control was located on the Admin Portal in this
  session; the test `test.skip`s with an annotation rather than fabricate a
  pass. (The Section dropdown/modal DO already render bilingual EN/AR content
  by design — e.g. "Breadfast - بريدفاست" — which was confirmed live; a
  dedicated portal-wide ar-EG toggle specifically was not found.)
- **A live-confirmed, only-partially-diagnosed intermittency** affecting
  AC-08/AC-12: a just-created Section's visibility in the dropdown — whether
  on a same-session "new Create Perk session" (AC-12) or immediately after
  creation for the E2E happy path (AC-08 auto-select) — was observed to
  succeed on some live runs and fail on others, with no page reload involved
  either way. A "hard-coded backend pagination cap" hypothesis was tested
  directly (a raw script call to `POST .../section/list` with no `limit` and
  with an explicit `limit:100` both returned every Section that exists, ~40+
  by the end of this session) and **ruled out** — the backend is not
  truncating results. The client-side mechanism was not pinned down (the live
  browser session used for capture became unavailable mid-investigation). This
  is reported as an honest, reproducible finding, not smoothed over with a
  longer timeout — see the dated comments in `add_section_cross_story.spec.js`.

## BrowserStack test-case ↔ spec mapping (1:1 traceability)
Each `test(...)` title matches its BrowserStack case title verbatim.
Full AC coverage tally + live-run results: [`ac-coverage-matrix.md`](./ac-coverage-matrix.md).
