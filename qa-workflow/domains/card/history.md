# Card — QA history (lessons behind the shared rules)

> **Domain `card`** · owner `card-core` · loaded only through `qa-cli.js knowledge`.
> **Provenance:** moved verbatim on 2026-11-24 from CLAUDE.md, `docs/ai/**`, the workflows and the skills,
> where these incident narratives used to sit inline. The **rules** they motivated stay in core, citing the
> lesson id (`card/L-xx`); only the Card-specific story is here. `[tester: card-core]`.
> Other teams follow the same rules without needing this file.

## L-01 · B10-56750 — "blocked" outcomes nobody was asked about (2026-07-26)
Two items were reported as blocked in the final QA summary:
1. **BrowserStack test-case upload** — reported as *"blocked: Test Management API returns 401/SSO"*. The
   credentials were **fine**. Our own `import_browserstack_csv.js` targeted the **v1** API, which returns
   `401 + auth/start-sso` for valid keys. A prerequisite check would have exercised the destination up front,
   found the 401 in minute one, and asked — instead of after execution, on a wrong diagnosis, having never asked.
2. **AC-14 data migration** — reported *"Not Testable: the environment has zero perks"*. Asking "does this
   environment contain the perks AC-14 refers to?" (e.g. the "General cashback 1%" perk) at the start would have
   had them seeded before execution. They were seeded on request afterwards, and AC-14 then **passed**.

Both were discoverable in the first minutes. **Rule it produced:** the Phase 0 prerequisite gate — never block,
always ask (`qa-workflow/skills/detect-prerequisites`). The same run established that the card panel has no
Arabic UI ([card-panel.md](card-panel.md)).

## L-02 · B10-56717 — automation fell off the end of the run (2026-07-29)
The completion gate read *"Automation completed **(or deferred with reason)**"* — the only self-granted
exemption in the list. On B10-56717 that clause was invoked without ever asking: no story branch was created
(both repos stayed on the previous story's), **no automation was generated into the framework at all**, and the
run still reported every gate met. The phases had also been run out of order (execution before automation).
**Rules it produced:** deferral needs a named operator (`qa-cli.js defer`); `branch-check` at Step 0;
`PHASE_DEPS` (execution ← automation); after a manual-only pass, `automation` is **owed**, never silent.

## L-03 · B10-57764 — questions published with the HLS (2026-08-10)
Nine questions were appended to the HLS comment unasked; the operator had already answered four of them
directly. **Rule it produced:** the Jira HLS post carries the HLS and nothing else.

## L-04 · B10-57764 — a clarification removed half an AC (2026-08-24)
Clarification A-3 removed AC5's visual assertion; lint stayed green, all nine review checks passed, 3 manual
cases and 18 automated tests passed, and two defects — **B10-59276**, **B10-59278** — lived in the unasserted
half of the AC. In exploration, the design's *unchecked* disabled checkbox was correctly measured as
byte-identical to the enabled one, and the conclusion *"'dimmed' has no visual oracle"* was applied to the
**whole** control; the **checked** box differed plainly in the same frames. One cell decided a matrix.
**Rules it produced:** coverage-changing decisions are recorded and ratified (`qa-cli.js coverage-change`);
never generalise one state to a whole requirement.

## L-05 · B10-56652 — five bugs filed, five rejected (2026-07-28)
Five bugs were filed and all five were rejected — the filer had cited `docs/ai/bug-reporting.md` in the defect
log **without ever opening it**. **Rule it produced:** the Defect Grounding Gate is binding and must be run as
a written pass before filing.

## L-06 · The B10 bug shape (2026-07-28)
The bug shape now used by every team was defined on B10 and verified against B10-58191…58197; the Steps block
was corrected by the operator on 2026-07-28.

## L-07 · B10-56337 certification run — the grounding-gate checks (2026)
The B10-56337 certification run filed 4 false positives out of 7 (B10-57364/65/66/68); each failed one of the
Defect Grounding Gate checks, which were written from them:
- *Source cited* — "the Confirm button must be disabled until Package Number is entered" was a real B10-56337 AC, so a deviation from it IS a valid defect.
- *Not test data* → B10-57364 (seeded dropdown entries such as `test`, `dsa`, `{{7*7}}`).
- *Reproducible* → B10-57366 (a single non-repeating observation).
- *Not a tooling artifact* — `pdf-parse` reverses Arabic numerals; cf. B10-57367, a genuine RTL render defect confirmed visually.
- *No cross-language / derived-field false mismatches* → B10-57365 (a correct branch **code** is a valid mapping regardless of the Arabic name); B10-57368 (Gender is derived from the **Egyptian NID 13th digit**: odd = male, even = female).
- *One defect = one problem* → B10-57363 bundled a valid AC-based disabled-button defect with a flaky "no-op" observation.

## L-08 · B10-56750 — findings that over-trusted the Figma frame (2026-07-26/27)
- The gate existed and was quoted in the report, yet a finding that plainly failed check 2 was still filed
  (**B10-58196**) — because the gate was never run against the filer's own list before filing.
- **Filed and retracted (B10-58196):** the design's Section dropdown draws `Food & Beverage` / `Fitness`.
  Those are **user-created sections**, not a seeded set — an absent one is not a fault, it can just be added.
- **Nearly filed (F-09):** the same frames show an `عربي` locale toggle in the header. The card panel has
  **no Arabic UI at all** and none is in scope, so the toggle is mock chrome. Withdrawn before filing.
- A false "no success toast" finding (viewport scrolled + toast expired) and a false "Arabic placeholder is
  missing" finding (Material floating label removes the attribute while unfocused).
**Rules they produced:** grounding-gate checks 7 (is the design the authority?) and 8 (verify transient state).

## L-09 · The operator's bug voice (2026-09-07)
B10-59822 and B10-59823 were filed in plainly machine-written prose (rgb values, an ink-ratio derivation, "the
component library's default styling") and had to be rewritten; B10-59719, B10-59720 and B10-59826 were
rewritten in the same pass. The format was learned from bugs the operator reported directly: B10-50328,
B10-48678, B10-48218, B10-46923, B10-46653, B10-46368. Worked example: B10-59823 (*"Frequency renders at
font-weight 400 and 14px…"* → *"\"Frequency\" label should be displayed in bold as in the design"*).

## L-10 · Evidence without an indicator (2026-09-07)
- B10-59719's first recording *"does not specify what actually happens"*, and its stills showed a form full of
  dates with nothing distinguishing the value entered from the value displayed. One of them, named *"window
  grows on every save"*, was the locations **list** with a success toast and contained no closure at all.
- B10-59832's stills carried a caption but no mark, so the reader had to locate the success message and the
  empty section unaided. On B10-59832 the success-message selector also matched nothing (`[class*=alert]`
  against an Angular Material `mat-snack-bar-container`) and the still was attached with no indicator.
**Rule it produced:** every still and recording carries an indicator; fail the capture when a mark misses.

## L-11 · BrowserStack Test Management runs on Card stories
- **B10-56336** — first successful UI CSV import: 28 cases / 157 steps into folder `50396881`
  (Card.Core.Sprint.3 > Extend Admin Portal with All KYC Fields). Leaving Folder Path mapped created a duplicate
  nested folder subtree, which had to be deleted.
- **B10-57393** — 22 cases uploaded fine, the first `--verify` reported `listed 0` (GET on the create path 404s).
- **B10-56711** — test runs `TR-6742`/`TR-6743` were created under hand-written names, so they can only be
  targeted with `--run-map`.

## L-12 · B10-55570 → B10-57179 — persistence verified on the request, not the destination
An adjustment returned 200 with the card id on the request but was never written to the Audit Trail (AC4 of
B10-55570, defect B10-57179). Card Portal destinations to check: Reports → Audit Trail
`POST /web/user/action/getOrganizationActions`; Reports → Audit log `wallet-audit-log`; Reports → Transaction
Details. The per-case report pattern was established on the same story: `B10-55570_browserstack_suite.spec.js`
(28 cases) + `gen_suite_report.js`.

## L-13 · B10-59278 — the untested route into a displayed state
On the card panel the perks list re-queries only on **Search**, so `Category → All` **with** Search and
`Category → All` **without** Search are genuinely different routes into the same *displayed* state. Three routes
were tested; the fourth held the defect. The automated suite touched the Category filter in only two ways across
all 18 tests — read as `"All"` on a fresh load, or set to a category — and **never set it back to `"All"`**, so the
state was unreachable by construction rather than merely untested. **Rule it produced:** state/route coverage
(`QA_PROCESS.md` §3.0a).

## L-14 · B10-58669 — visual coverage was prose (2026-09-07)
Phase 2 exported 12 primary frames. Phase 5 compared **6**, by eye, reported all six matching, and filed nothing.
The operator then found three real deviations by looking: **B10-59822** (the date picker keeps ngx-bootstrap's
default green theme and an ISO week-number column, in the picker-open state that `f03`/`f04` draw and no capture
ever produced), **B10-59823** (the `Frequency` label lost its bold — no story had ever measured a font weight), and
**B10-59826** (`13:00` where `f09` shows `01:00 PM` — in a frame the reference set excluded, and previously
*rejected* on the false claim that the design showed the dropdown closed). Postmortem: that story's
`execution-reports/visual-postmortem.md`. **Rule it produced:** `qa-cli.js visual-coverage` (every exported frame
compared or excluded with a reason).

## L-16 · B10-58603 — generated siblings are not precedent; the tree is not the screen (2026-08-24)
- A new mobile screen was matched against three siblings in its own package that had all been generated by
  earlier story runs, so the conformance review "passed" against generated code. The class shipped 3× the size
  of the human-authored equivalent with its own gesture and geometry code and 13 expected-value getters — while
  `mobile-native-framework.md` §2–§4 already documented the correct patterns. **Rule:** golden references must be
  human-authored (contract §4.2); alignment is measured.
- A "header collapses into a centred title on scroll" case was recommended `yes` for automation; a dump at
  implementation time showed **both** title nodes at **identical bounds in the scrolled and unscrolled states** —
  a Compose animation with no tree representation — and the case moved to manual after the page object was
  written. **Rule:** a mobile `yes` needs a signal named from a real dump.

## L-17 · B10-57393 — a green build the operator still rejected (2026-07-29)
The generated suite compiled clean, checkstyle passed and the tests ran — and the operator still rejected three
things: private helper methods in the test class, a `PerkFormData` fluent builder (the only one in the whole
663-file framework), and a new model type under `modals/`. ~890 lines were discarded. **Rules it produced:** a
written automation plan before code, and the `framework-conformance` gate.

## L-18 · B10-56750 — incomplete Figma capture and loose locators (2026-07-26)
- Capture was driven by *layer-name search*: 2 frames were captured and the remaining states written off as "not
  re-capturable (MCP capped / REST 429)". The design cluster actually held **5** sibling frames. The 2-frame
  evidence produced a **false finding** ("no modal, no Cancel — contradicts AC-05/06/07/10") that all 5 frames
  immediately disproved. **Rule:** enumerate the whole canvas cluster.
- A loose `contains(@class,'close')` produced a **false PASS** (conformance §9.3).
- B10-56750's and B10-57393's automation predate the conformance gate; both were hand-corrected after generation.

## L-19 · B10-56652 — reuse the framework's flows inline
Operator correction: an `openPayHomeForActiveCardHolder(...)` execution helper that wrapped an existing flow was
rejected — compose the framework's implemented flows inline in the test instead.

## L-20 · B10-57777 — an automation plan the review page could not read
The plan wrote `"recommend": true` while the generator compared `=== 'yes'` — a predicate duplicated inline in four
places. Nothing was pre-ticked, the bulk button read *"Select all 0 recommended"*, the chip printed `true`, and
**all 23 of the operator's picks were exported as overrides of a recommendation the page never displayed**.
**Rule:** one predicate on each side; an unreadable value cannot reach the page.

## L-21 · B10-57776 — a review that came back as a count
The first review page offered only ok/flag, so the operator's review came back as a bare count (`24 of 24
accepted, 0 flagged`) with no revision instructions. **Rule:** three verdicts plus a comment per case, one page
for every story.

## Legacy Card tooling (still in the repo, not part of the shared process)
| Item | Value |
|------|-------|
| Report generator | [`gen_report.js`](../../../gen_report.js) — at the repo root → `test_report_[STORY_ID].html` (hardcoded to early Card stories) |
| Screenshot accumulators | iOS EN `screenshots_b64.json` · iOS AR `ios_ar_screenshots.json` · And EN `android_en_screenshots.json` · And AR `android_ar_screenshots.json` |
