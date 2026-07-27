# B10-57393 — Selenium (Java/TestNG) vs Playwright (JS) on the same story

Both stacks automate the **same approved BrowserStack set** (PR-5 / folder `53134541`, 22 cases) for
*Mobile App Preview for Perk Creation*, drive the **same environment** (`card-panel-testing`, panel
2.4.5) from the **same machine**, and use the **BrowserStack case name as the test title**, so results
join by name with no hand-maintained mapping:

- Selenium: `D:\projects\src\test\java\cardService\adminPanel\B10_57393_AppPreviewModalTests.java`
- Playwright: [`../automation/tests/`](../automation/tests/) — `app_preview_modal.spec.js`, `app_preview_save_failure.spec.js`
- Join + report: [`../automation/compare_stacks.js`](../automation/compare_stacks.js) → [`stack-comparison.json`](stack-comparison.json)
- Title parity guard: [`../automation/check_test_name_parity.js`](../automation/check_test_name_parity.js) → **Java 20/22 OK · Playwright 21/22 OK**, all verbatim

Retry budgets are aligned at **zero on both sides**. That took a correction worth recording: the Java
framework *looks* like it retries — `RetryListener` installs `RetryAnalyzer` (`maxRetryCount = 1`) on
every `@Test` — but that listener is declared only inside `b10-57393-tests.xml`, and **the pom
hardcodes its own `<suiteXmlFiles>`**, so surefire never reads the story suite. Running
`mvn test -Dtest=B10_57393_AppPreviewModalTests` — the command the story README documents — therefore
loads **none** of the story suite's listeners. Confirmed empirically on the clean run: 4 failures,
**0 retries**, 43 config methods for 21 tests (21 setups + 21 teardowns + 1). Playwright was set to
`retries: 1` for parity and then back to `retries: 0` once that was established.

> **Two consequences beyond this comparison.** With that run command, `BrowserstackSyncListener`
> does not load either — so **results never post to BrowserStack TMS**, despite `@TmsLink` being
> present and the README stating that they sync. And `AllureTestNg` only applies because Allure
> self-registers through the ServiceLoader, not because the suite XML asked for it. Anything that
> depends on the story suite's `<listeners>` block is silently inert unless the story XML is added
> to the pom's hardcoded list — `-DsuiteXmlFile` cannot override a value hardcoded in
> `<configuration>`.

---

## 1. Result

Both suites, both fully debugged, run back to back on the same restored panel on 2026-07-28, zero
retries on either side. Machine-readable: [`stack-comparison.json`](stack-comparison.json) ·
[`stack-comparison.txt`](stack-comparison.txt) · [`stack-comparison-table.md`](stack-comparison-table.md).

| | Selenium | Playwright |
|---|---|---|
| Cases automated | 20 / 22 | **21 / 22** |
| Pass | 18 | 18 |
| Fail | **2** — DEF-1, DEF-2 | **3** — DEF-1, DEF-2, **DEF-3** |
| Retried / flaky | 0 | 0 |
| Suite test time | 17.6 min | **12.7 min** |

**Verdict agreement: 21 / 22.** The two stacks return the *same verdict on every case both
automate* — same two defects flagged, same eighteen passes, no case where one is green and the other
red. The single non-agreement is TC-53972, which Selenium cannot automate at all (§2).

**So the tools do not disagree about the product.** Everything that separates them is what they can
reach, how fast, what a failure costs to diagnose, and what they can feed the visual engine.

<details>
<summary>How the evidence got to this state (four runs, two of them discarded)</summary>

| Run | When | Validity |
|---|---|---|
| Playwright, full | 2026-07-27 16:54–17:31 | **Superseded.** 11 pass / 10 fail — 3 real defects, **7 harness bugs** (§5), all since fixed. |
| Selenium, full | 2026-07-27 21:56–23:24 | **Discarded — environment outage mid-run.** 5 pass / 2 fail / **14 skipped**; setup could not reach the admin-login API and one test died on `net::ERR_NAME_NOT_RESOLVED`. |
| Selenium, full | 2026-07-27 23:30 – 2026-07-28 00:15 | **Superseded.** 17 pass / 4 fail; the 4 included one false failure (TC-53973) and one 28-minute hang (TC-53969), both since diagnosed and fixed (§5). |
| Playwright, full | 2026-07-28 00:47–01:12 | **Counted.** 18 pass / 3 fail, 12.8 min. |
| Selenium, full | 2026-07-28 01:12–01:33 | **Counted.** 18 pass / 2 fail, 17.6 min. TC-53969 now passes in 64 s. |

`card-panel-testing` was down (502) between roughly 23:00 and 23:29, which invalidated the first
Selenium attempt; the login API stayed up throughout, which is why the failure presented as skips
rather than as a clean stop.
</details>

---

## 2. Coverage — the one hard capability difference

| | Selenium | Playwright |
|---|---|---|
| Cases automated | **20 / 22** | **21 / 22** |
| TC-53972 — failed save keeps the modal open and shows an error | **cannot automate** | **automated** |
| TC-53974 — visual fidelity vs Figma (EN + AR) | not automated (design judgement, Phase 5) | not automated (same) |
| Extra tests beyond the approved set | 1 (`verifyOutsideMerchantPerkRendersInThePreview`, H&M branding — no `@TmsLink`, so it cannot sync) | — |

TC-53972 needs the perk-creation POST **forced to fail**. Playwright does it in six lines with
`page.route(...).fulfill({status: 500})`. WebDriver has no request-interception hook at all, so on
Selenium this case is permanently manual — and it is the case that found **DEF-3 (endless spinner,
no error surfaced)**, a defect a user hits whenever the backend hiccups. That is the difference that
matters: not "Playwright is 1 case better", but *this class of negative test is unreachable on
Selenium and will stay unreachable*.

---

## 3. Speed and per-test cost (measured today)

| | Selenium (2026-07-28) | Playwright (2026-07-28) |
|---|---|---|
| Per-case duration | 37–59 s, **median ~41 s** (test body only) | 31–52 s, **median ~34 s** (login + full form fill included) |
| Per-test setup outside that number | median **9 s** (fresh Chrome + admin-login API + warehouse/product data seeding + a DB SSH tunnel that fails on every test), 2.8 min across the suite | none — the spec is the whole cost |
| Effective per case | ≈ 50 s | ≈ 34 s |
| Suite wall clock, 21 tests | ≈ 17–18 min healthy | **12.8 min** |

The gap here is much narrower than the degraded run suggested — Selenium's per-case cost is
competitive once the environment is healthy. Do not read the per-case number as the headline
difference; §4 (diagnostics) and §2 (reachability) are where the stacks actually diverge.

Two structural reasons Playwright is cheaper per case here, both visible in the code:

1. **One round trip vs many.** `AppPreviewModal.measureFrame()` returns bezel layout box, screen
   layout box, rendered box and the ancestor transform in a single `evaluate`. The Java equivalent
   calls `getBezelLayoutSize`, `getScreenLayoutSize`, `getBezelRenderedSize`,
   `getFrameAncestorTransform` — and the assertion message calls several of them a second time, so
   one assertion costs six driver round trips.
2. **No per-test re-login.** Every Java test repeats the same seven-line
   navigate → login → Card Perks → Add perk → fill preamble, and pays the framework's data-seeding
   setup again, because the modal cannot survive a page reload. Playwright pays login once per test
   too, but nothing else.

---

## 4. Diagnostics — the largest practical gap

Playwright's default artefacts per failure: **screenshot + video + `trace.zip` + `error-context.md`**
(a full accessibility snapshot of the page at the moment of failure). **All seven harness bugs in §5
were diagnosed from those artefacts alone, with zero re-runs.** Two examples:

- The perks-table bug was proven from the snapshot: it lists `columnheader` ×2 with no label before
  `Perk ID`, and the row cells show `"15% CB 61857"` present — i.e. the perk *had* been created and
  the assertion was reading the wrong column.
- The `Select Type` collision was proven from the failure message itself, which printed both
  matching `mat-select` elements with their `formcontrolname` attributes.

Selenium's artefacts are the TestNG XML/HTML, Allure hooks, the framework log stream and a failure
screenshot. Useful, but there is no DOM snapshot, no trace and no video, so the equivalent diagnosis
means re-running with the browser visible — on a suite where one run is ~40–90 minutes.

Failure-message quality, on the other hand, is a property of how the assertions were written, not of
the tool: both stacks emit the same self-explaining message for DEF-2, because both were written to
report the measurement rather than just `expected true but found false`.

One reliability note in Selenium's favour: `RetryAnalyzer` is installed framework-wide, so a transient
failure self-heals without anyone configuring it per suite. Playwright needed that turned on
explicitly.

**And one against it: nothing bounds a hung test, so a single helper bug froze the whole suite.**
TC-53969 produced no output for **28 minutes** on 2026-07-27, and hung again on the 2026-07-28 run —
both times the Chrome process had to be killed from outside, and a stall watchdog had to be armed to
finish the suite.

The cause was **not** the app. It is a bug in the framework's shared
`BaseWebPage.enterStringIntoTextField`, spotted by the QA engineer from a screenshot of the frozen
form showing the Perk title EN field reading `15% CashbackRamadan CashbackRamadan Cashback…` over a
"Maximum length should be 20 characters." error:

```java
while (!txtField.getAttribute("value").equalsIgnoreCase(text)) {
    if (!wait.until(visibilityOf(txtField)).getText().isEmpty())   // getText() on an <input>
        txtField.clear();
    txtField.sendKeys(text);
```

`getText()` returns an element's rendered text content, and an `<input>` has none — it is always
`""`. The guard was therefore always "empty", **`clear()` never fired, and every call appended**.
Overwriting a populated field produced `15% CashbackRamadan Cashback` (28 chars, past the 20-char
cap), which the loop condition could never match, so it appended again, and again — an unbounded
spin. Filling an *empty* field always worked, which is why the one test that **edits** a populated
field was the only one that ever hung.

Fixed: the guard reads `getAttribute("value")`, and the loop is bounded at 3 attempts and then
throws with the field's actual contents. **This is a framework-wide bug, not a story bug** — every
page object in `D:\projects` inherits it, so any test that overwrites a non-empty field has been
getting concatenated input or hanging the same way.

Three things follow, and only the third is about tool choice:
1. **Add a per-`@Test` `timeOut`** (or a surefire `forkedProcessTimeoutInSeconds`). A helper bug
   should cost one test, not an unbounded CI slot — twice.
2. **Audit other `enterStringIntoTextField` callers** that overwrite populated fields.
3. Playwright cannot reach an unbounded hang by construction: `timeout` (420 s here),
   `actionTimeout` and `navigationTimeout` (30 s) are always in force, so the same bug would have
   surfaced as one failed test with a trace, in 420 seconds, not as a frozen suite. That is a
   property of the runner's defaults, not of anyone's discipline.

**Correction on record:** this hang was first attributed in an earlier draft of this report to a
stuck CDK overlay intercepting the re-click of "Preview & save". That was wrong. The overlay
hardening added to `clickOnPreviewAndSaveBtn` was kept — the Playwright suite genuinely did hit an
interception on that same step — but it is hardening, not the fix.

---

## 5. What the first Playwright run actually measured (and why it is not the tool's score)

11/21 on the first full run looks bad and was not: **3 of the 10 failures were the real defects**
(DEF-1, DEF-2, DEF-3) and **7 were bugs in a suite that had never been run end to end**. Fixed in
this pass, in the shared page objects so every story benefits:

| Bug | Symptom | Fix |
|---|---|---|
| `getByRole('combobox', {name:'Select Type'})` | `funding_types` carries the same accessible name → strict-mode violation once the Value section renders | pinned to `mat-select[formcontrolname="type"]` |
| `getColumnValues()` indexed the **filtered** header list | the perks table has two unlabelled leading columns (drag handle, logo), so `Title` read the Category cell — a created perk reported as missing | index from the raw header list |
| `getSectionNames()` stripped only the first token | the Coupon header reads `local_offer Coupon code content_copy BFCOFFEE20` → `hasSection('Coupon code')` false on a rendered section | strip icon/button nodes in-page, then the leading ligature |
| four blind image uploads | a dialog that closed without committing left slot 4 empty; the form then blocked the preview with a required-image error far from the cause | loop until no "Add image" slot remains, then fail loudly |
| `See more` clicked as a text match with `{force: true}` | force skips the hit-target check, so the click missed the button; the earlier probe, clicking *without* force, expanded it correctly (scrollHeight 905 → 1085) | target the real `<button>`, no force |
| re-click of "Preview & save" after a dialog closed | a CDK overlay reported zero visible backdrops yet still owned the pointer → the full 30 s burned on the hit-target wait | `clickPreviewAndSave()`: clear overlays, then DOM-click fallback |
| parity checker zipped descriptions and `@TmsLink`s as two lists | the one test without a `@TmsLink` shifted every later pair → 5 phantom "TITLE MISMATCH" lines, while the real problem (a test bound to no case) showed only as a count warning | pair per method |

Note the shape of these: **every one is locator or flow logic — not a single timing/flake bug.**
That is Playwright's auto-waiting doing its job, and it is the same class of work that consumed
Selenium's four hardening runs on B10-56750 (SPA routing, stale element, dropdown race, lazy-load
scroll loop — three of those four *are* timing bugs).

**The Selenium suite had the same class of bug — two of them.** Symmetry matters here, so both are
recorded rather than only the JS ones:

| Bug | Symptom | Fix |
|---|---|---|
| `uploadImageToNextSlot` searched for the rejection message **inside the dialog** | the message is real but is rendered *outside* it, so the detector could not tell rejection from acceptance — both fell through as "accepted". TC-53973 reported *"a 240×180 logo was accepted into the 1080×1080 Cover photo slot"* against a panel that was working. | read the empty-slot count instead: if it did not drop, the file was not committed. Also makes the happy path fail fast. Re-ran → **passes**. |
| `BaseWebPage.enterStringIntoTextField` appended instead of replacing | unbounded loop → 28-minute suite freeze, twice (see §4) | value-based guard + bounded retries |

Settled by direct observation, not by preferring one harness's word:
[`probe_image_spec.js`](../automation/probe_image_spec.js) drove the real dialog and read the fact
neither suite checked — *does the slot end up filled?* A 240×180 into Cover EN leaves the dialog open
on its untouched prompt with the **slot empty**; the 1080×1080 control closes the dialog and **fills**
the slot. Verdict: **validation works.**

> **Correction on record — there is no UX defect here, and nothing to file.** An earlier version of
> this report claimed the panel rejects wrong-sized images *silently* and flagged it as a candidate
> defect ("DEF-4"). That was wrong, and it was wrong for the same reason the Java detector was wrong:
> the check was scoped to `mat-dialog-container`. Re-probed document-wide on 2026-07-28, the panel
> toasts **immediately (0 ms)**:
>
> > `Image resolution is invalid. Should be (1080 x 1080)`
>
> Material renders the snack-bar in `.cdk-overlay-container` as a **sibling** of the dialog, so no
> dialog-scoped read can ever see it. DEF-4 was never filed, so nothing needs retracting in Jira —
> but the false claim was sitting in the shared `PerksPage.js` comments, where it would have been
> inherited by the next story, and has been corrected there. `getUploadFeedbackToasts()` now reads
> toasts document-wide.
>
> **The transferable lesson:** three separate checks (two JS helpers and one Java page object) all
> scoped an "is there an error message?" question to the dialog, and all three concluded "no message"
> about a panel that was showing one. When asserting the *absence* of feedback, search the document.

So the honest scoreboard on harness quality is **7 bugs in the new Playwright suite, 2 in the
established Selenium suite** — and the Playwright suite was brand new while the Java one had already
been through hardening runs. The difference that actually separates the stacks is not who writes
buggier tests; it is **diagnosis cost**: the 7 JS bugs were all read off artefacts already on disk
with zero re-runs, while the 2 Java bugs needed a purpose-built probe and a human noticing a
screenshot.

**One fix reaches beyond this story.** `getColumnValues()` lives in the shared `PerksPage.js`, and
the perks-table story **B10-56757** reads `Type` / `Category` / `Status` / `Title` through it in five
specs. With the old filtered index every one of those reads was two columns to the left of the
column it named (`Title` → Category, `Type` → Perk ID). Whether that changed any B10-56757 verdict
depends on whether the two unlabelled columns existed when that suite last ran, so this is flagged
for a re-check rather than asserted — but the reads were wrong from today's DOM, and are now right.

Also worth a follow-up: today's env-degraded Selenium run failed TC-53973 with
*"A 240×180 logo was accepted into the 1080×1080 Cover photo slot, so image-spec validation
regressed"*. Both suites assert this, so it is a real candidate finding rather than a harness
artefact — but it landed 20 s before the environment fell over, so it must be re-observed before
being filed.

---

## 6. Cost to author and maintain (measured on this story)

| | Selenium | Playwright |
|---|---|---|
| Story test class / specs | 893 lines | 462 lines (2 specs) |
| New modal page object | 541 lines (`AppPreviewModal.java`) | 398 lines (`AppPreviewModal.js`) |
| Shared page-object edits | +282 `PerksPage.java`, +11 `BaseTest.java` (page-object wiring) | +372 `PerksPage.js` (not all of it this story) |
| Runner config | story suite XML + framework properties | 51-line `playwright.config.js` |
| Per automated case | ≈ 45 lines | ≈ 22 lines |
| New-test wiring cost | new page object must be registered in `BaseTest` (`ThreadLocal` field) before any test can use it | `new AppPreviewModal(page)` in the spec |

The Java suite is not verbose by accident — it buys the framework's API clients, data factories,
config source of truth, Allure, and `@TmsLink` result sync. But per *assertion*, the JS suite says the
same thing in half the code.

---

## 7. Which one to rely on

**Keep Java/Selenium as the regression suite of record. Keep Playwright as a first-class specialist
tool for three specific jobs.** Not "pick one" — the two are strong at different things, and this
story demonstrates both halves.

**Java/Selenium stays the default** because the reasons are organisational, not technical:
the framework is the config source of truth, it owns the API clients and data factories that seed
test data, its `BrowserstackSyncListener` already posts results per `@TmsLink`, it runs on
BrowserStack/HyperExecute, and — decisively — **mobile Appium automation lives in the same
framework**. A team that writes web in Java and mobile in Java maintains one language, one CI path,
one set of page-object conventions. Moving web to Playwright would fork that and duplicate the API
clients.

**Playwright is the right tool, and should stay sanctioned, for:**

1. **Anything needing request interception or browser-level control** — forced failures, offline,
   slow network, geolocation, permissions, injected clock. Selenium cannot do these, so without
   Playwright these cases stay manual forever. TC-53972 → DEF-3 is the proof.
2. **The visual engine's capture/extract layer** — see §8. This is already the built design.
3. **Fast exploratory probing and evidence capture** during execution and visual testing. The
   probes in this story (`preview_modal_probe.js`, `preview_modal_edge.js`) produced the DOM
   measurements that both suites' assertions were then written against, and produced them in minutes.

**Decision rule to apply per case:** if the case needs request interception, deterministic pixel
capture, or a whole-DOM/computed-style dump → Playwright. Otherwise → Java/Selenium.

**Do not dual-maintain both suites per story.** This story deliberately built both to answer the
question; the standing cost is two suites, two locator sets and two hardening cycles for one extra
case. That is not worth repeating — which is why the B10-56750 Playwright specs were archived rather
than kept alive.

> **Governance note.** [`docs/ai/automation/automation-generation.md`](../../docs/ai/automation/automation-generation.md)
> and CLAUDE.md §8 currently record (2026-07-27) that **all** new web automation targets
> Java/Selenium and "new Playwright only on explicit user request". Point 1 above (interception-class
> cases) and point 2 (the visual capture layer) are narrower than that line allows. That is a
> conflict with a recorded decision, so it is flagged here and **not** written into the docs —
> confirm the carve-out and it can be added to the generation contract as an explicit exception list.

---

## 8. Which approach the visual testing engine should use

**Playwright, unambiguously — and this is already how the engine is built, not a proposal.**

The engine ([`qa-workflow/capabilities/visual/`](../../qa-workflow/capabilities/visual/), L1 pre-flight
… L7 pixel deterministic + L8 AI residual) consumes an *expected model* from Figma and an *actual
capture* from the app. What the actual capture has to contain, layer by layer:

| Layer | Needs from the browser | Playwright | Selenium |
|---|---|---|---|
| L2 component tree | full a11y/role tree with identity (test-id → role → name) | `actual/parse.js` **already accepts Playwright a11y dumps** as a first-class input format | no a11y-tree API at all; would have to synthesise one of the two supported shapes itself |
| L3 visibility | per-component zero-area detection | one `evaluate` over the tree | `getRect()` per element, one round trip each |
| L4 layout | per-component bounds vs tolerance | same single `evaluate` | same per-element round trips |
| L6 styles/tokens | computed styles (colour, font-family, lengths) per component | same single `evaluate` | `getCssValue()` is one round trip **per property per element** — or `executeScript`, i.e. writing the same JS through a slower channel |
| L7 pixel | deterministic captures | `clip`, `mask`, `animations:'disabled'`, `caret:'hide'`, full-page stitching, browser build pinned to the library version | viewport/element screenshots only; no masking, no animation freezing, and **CDP is pinned per Chrome release** — today's Selenium run logged `WARNING: Unable to find CDP implementation matching 150` on *every single test* |

On top of that, [`automation/helpers/VisualComparisonHelper.js`](../../automation/helpers/VisualComparisonHelper.js)
— the current Figma-vs-actual evidence generator, including annotated design-bug pages and
`rasterize()` for the Jira attachments — **takes a Playwright page as its input**. There is no
Selenium path through it.

So the answer to "does the tool choice matter for the visual engine?": **it matters for the capture
layer and nowhere else.** The engine is deliberately transport-agnostic — the deterministic core has
zero AI and zero browser knowledge, and reads a StructuredDump. Whatever runs the functional
regression, the visual engine's *actual* side should be produced by Playwright, because a
determinism-critical, whole-tree-in-one-read capture is exactly the shape of work WebDriver's
one-round-trip-per-property protocol is worst at.

**Practical consequence for automation generation:** generated Selenium suites should not be asked to
produce visual baselines. Phase 5 keeps its own Playwright capture pass — which is what this story
did, and why the visual findings exist at all.

---

## 9. Outstanding

**Done:** confirming run of both suites in one healthy window ✓ · TC-53973 settled by probe ✓ ·
shared page objects mirrored to `D:\Playwright\b55168_pom` ✓.

**Needs a decision or a follow-up:**

1. **Confirm or reject the Playwright carve-out** (§7 governance note) so it can either be written
   into [automation-generation.md](../../docs/ai/automation/automation-generation.md) as an explicit
   exception list, or dropped.
2. ~~File the silent image rejection~~ — **withdrawn.** The panel toasts
   `Image resolution is invalid. Should be (1080 x 1080)` immediately; the "silent rejection"
   reading was an artefact of a dialog-scoped check (§5). Nothing to file.
3. **Framework fixes made here that outlive the story**, all in `D:\projects` and all needing review
   before they merge:
   - `BaseWebPage.enterStringIntoTextField` — appended instead of replacing; **framework-wide**.
   - `PerksPage.uploadImageToNextSlot` — rejection detected by slot state, not by an error string.
   - `PerksPage.clickOnPreviewAndSaveBtn` — overlay dismissal + intercepted-click fallback.
4. **Add a per-`@Test` `timeOut`** (or surefire `forkedProcessTimeoutInSeconds`) — §4.
5. **Register the story suite XML in the pom**, or accept that `@TmsLink` results never reach
   BrowserStack TMS with the documented run command — see the note at the top.
6. **Re-check B10-56757's table assertions** against the fixed `getColumnValues()` (§5).
