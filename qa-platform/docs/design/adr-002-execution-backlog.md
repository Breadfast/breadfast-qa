# BACKLOG-002 — Visual Testing: Engineering Execution Backlog

> **Status:** 🟢 **Execution backlog — ready for Jira planning. NOT implemented.**
> **Author role:** Principal Engineer + Engineering Manager
> **Date:** 2026-07-21
> **Implements:** [AIP-002](./adr-002-implementation-plan.md) migration order · [ADR-002 Rev.2](./adr-002-visual-testing-redesign-rev2.md) architecture (frozen).
> **Reference implementation:** Selenium Java (`D:\projects`). Architecture stays framework-independent.
>
> This backlog is dependency-aware, keeps the system **deployable after every story**, maximizes reuse (12 KEEP vs 3 REPLACE from AIP-002 Part 1), and flags every parallelization opportunity, blocker, and critical-path item. Estimates are ideal-engineer-days (d) + story points (sp), fibonacci.

---

## Conventions

**Owner codes:** `SH` = @qa/shared (schemas, registry/manifest types, pyramid pure fns) · `QAP` = QA Platform worker/engine (`apps/worker`, `packages/engine`) · `BE` = API (`apps/api`) · `FE` = Web (`apps/web`) · `SEL` = Selenium/Java (`D:\projects`) · `AI` = prompt/L8 owner · `QAL` = QA Leads (registry data curation).

**Complexity:** S ≤1d · M 2–3d · L 4–6d · XL 7–10d. **Flag states:** `QA_VISUAL_ENGINE ∈ {legacy, shadow, pyramid}`.

**Deployability invariant (applies to every story):** default flag stays `legacy` until M6; all new schema fields optional-with-default; every merge leaves `visual.test.mjs` + `phase2-validate.mjs` green.

**Story template:** each story carries — Subtasks · Acceptance Criteria (AC) · Definition of Done (DoD) · Dependencies · Rollback · Validation · Complexity · Effort · Affected files · Risks · Owner · Parallelizable?

---

## EPIC-VT-DEC — Prerequisites & Decisions (unblocks the critical path)

> **These are gating. Two are human decisions; one is ongoing curation. Start day 0.**

### DEC-1 — Ratify Screen Registry location & owner
- **Subtasks:** propose `docs/ai/screens/` (shared git) + QA-lead ownership; write a 1-page decision memo; get sign-off; record in ARCHITECTURE.md "Locked decisions".
- **AC:** location, format (per-file vs single manifest), and owning role are recorded and signed off.
- **DoD:** ARCHITECTURE.md updated; referenced by SH stories.
- **Dependencies:** none. **Rollback:** n/a (decision). **Validation:** sign-off recorded.
- **Complexity:** S · **Effort:** 0.5d · **Affected:** `ARCHITECTURE.md`. **Risk:** decision delay blocks VT0-S3. **Owner:** QAP + QAL. **Parallel:** ✅ (day 0).

### DEC-2 — Ratify L8 vision transport (CLI `Read` vs Messages API)
- **Subtasks:** document both options + the locked-decision tension (subscription-only CLI); recommend keeping CLI `Read` for now (L8 is rare) with a read-confirmation guard; escalate only if canvas screens are common.
- **AC:** transport chosen + recorded; if API, a scoped-key handling note added to secrets registry design.
- **DoD:** decision recorded; VT5 stories reference it.
- **Dependencies:** none (needed before M5). **Rollback:** n/a. **Validation:** sign-off.
- **Complexity:** S · **Effort:** 0.5d · **Affected:** `ARCHITECTURE.md`, secrets design. **Risk:** touches a locked decision. **Owner:** QAP + AI. **Parallel:** ✅ (needed by M5, not M0).

### DEC-3 — Registry data authoring (ongoing, highest-traffic first)
- **Subtasks:** identify top-N screens; author `screenId → figmaNodeId` (+ later `expectedComponents`); review workflow.
- **AC:** top-N screens registered before M4 layer value is claimed.
- **DoD:** registry populated for the golden-story set.
- **Dependencies:** DEC-1, VT0-S3 (schema). **Rollback:** unregistered screens degrade gracefully. **Validation:** registry-validation diagnostic (VT4-S7) green. **Note:** duplicate-`screenId` detection is a VT4-S7 responsibility (recorded from VT0-S3 review); author unique ids until it lands.
- **Complexity:** M (per batch) · **Effort:** ongoing · **Affected:** `docs/ai/screens/**`. **Risk:** curation capacity. **Owner:** QAL. **Parallel:** ✅ (continuous from M2).

---

## EPIC-VT0 — Foundations (M0) · *no behavior change*

**Feature:** flag plumbing + additive schema + registry/manifest scaffolding.

### VT0-S1 — Introduce `QA_VISUAL_ENGINE` + `QA_VISUAL_ABSTAIN` flags
- **Subtasks:** add to settings registry (default `legacy`/off); read in `html_report` visual dispatch; document in settings help.
- **AC:** flags resolvable per-run; default `legacy` reproduces current behavior byte-for-byte.
- **DoD:** flag wired, unit-tested, documented; no pipeline change at default.
- **Dependencies:** none. **Rollback:** remove flag reads. **Validation:** run with default → identical report to pre-change.
- **Complexity:** S · **Effort:** 1d · **Affected:** settings registry, `apps/worker/src/nodes.ts:1560-1567`. **Risk:** ⬇. **Owner:** QAP. **Parallel:** ✅.

### VT0-S2 — Additive schema extensions (finding/comparison)
- **Subtasks:** add optional `layer?`, `source? ∈ {deterministic,ai,ocr}`, `coverageGap?` to `VisualFinding`; widen `verdict` enum with `'coverage-gap'`; add `engine?` to `VisualComparison`. All optional-with-default.
- **AC:** old persisted runs still validate; `computeVisualHealth`/`detectVisualPatterns` consume widened shape unchanged.
- **DoD:** schema + zod defaults; back-compat test against an archived run.
- **Dependencies:** none. **Rollback:** fields ignored. **Validation:** `visual.test.mjs` extended; load an old run → validates.
- **Complexity:** S · **Effort:** 1d · **Affected:** `packages/shared/src/schemas.ts:324-382`, `visual.ts`. **Risk:** ⬇ (enum widening is safe). **Owner:** SH. **Parallel:** ✅.

### VT0-S3 — Screen Registry types + loader (empty OK) + Evidence Manifest types
- **Subtasks:** define `Screen`/`ScreenVariant`/`ExpectedComponent`/`ValidationProfile`/`CaptureRules` zod models (ADR-002 Rev.2 §6); loader from `docs/ai/screens/`; `EvidenceManifest` row schema; no-op when empty.
- **AC:** loader returns typed registry (empty when no data); manifest schema round-trips.
- **DoD:** types + loader + tests; `supportedTestCases` implemented as a **derived** reverse-index (not stored).
- **Dependencies:** DEC-1. **Rollback:** unused modules. **Validation:** loader unit tests (empty, one screen, variant-aware).
- **Complexity:** M · **Effort:** 2.5d · **Affected:** new `packages/shared/src/screen-registry.ts`, `manifest.ts`, `index.ts`. **Risk:** model churn if DEC-1 late. **Owner:** SH. **Parallel:** ✅ (after DEC-1).

> **M0 exit:** flags + schema + types merged, default `legacy`, all existing tests green. Deployable.

---

## EPIC-VT1 — Correct Pairing (M1) · ★ fixes the dominant bug

**Feature:** unified resolver with abstain, replacing `bestShot` + `matchExpected`.

### VT1-S1 — `resolvePair()` unified resolver (registry-first → heuristic → abstain)
- **Subtasks:** implement registry lookup by `screenId`+variant → `figmaNodeId`; heuristic fallback with **confidence floor**; below-floor ⇒ `coverage-gap` (no forced pair); expose a single function used by both the AI data path and the report embed.
- **AC:** never returns a pair below the confidence floor; registry hit is deterministic; identical frame for AI-judgment and report embed.
- **DoD:** function + tests; wired behind `QA_VISUAL_ABSTAIN` (opt-in first).
- **Dependencies:** VT0-S2, VT0-S3. **Rollback:** `QA_VISUAL_ABSTAIN=off` → legacy `bestShot`. **Validation:** unit (registry hit / heuristic hit / abstain); **shadow-diff** old-vs-new pairing on golden set.
- **Complexity:** M · **Effort:** 3d · **Affected:** `apps/worker/src/nodes.ts:1790-1804,1945-1956`, new resolver in `packages/shared`. **Risk:** ⬆ changes which pairs compare — mitigated by shadow log. **Owner:** QAP + SH. **Parallel:** ⚠ sequential after M0.

### VT1-S2 — Coverage-gap as a first-class result (not a defect, not silent)
- **Subtasks:** emit coverage-gap findings; `computeVisualHealth` treats them as non-penalizing but coverage-reducing; render a coverage-gap report row; feed run-eval visual signal.
- **AC:** a screen with no resolvable frame shows as coverage-gap, does **not** tank Visual Health, and is visible in the report + Review Confidence.
- **DoD:** health/report/run-eval updated + tested.
- **Dependencies:** VT1-S1. **Rollback:** treat coverage-gap as no-frame (legacy). **Validation:** `visual.test.mjs` (health with gaps); report snapshot.
- **Complexity:** S-M · **Effort:** 2d · **Affected:** `visual.ts:133-179`, `nodes.ts` report (`2089-2147`), `run-evaluation.ts:123-126`. **Risk:** ⬇. **Owner:** QAP + SH. **Parallel:** ⚠ after VT1-S1.

> **M1 exit:** no force-pairing; AI pair == report pair; coverage-gaps honest. Deployable (still `legacy` for detection).

---

## EPIC-VT2 — Evidence Manifest (M2)

**Feature:** manifest emit (Selenium) + ingest + synthetic shim.

### VT2-S1 — Manifest ingester + synthetic-manifest shim (back-compat)
- **Subtasks:** ingest a manifest file if present; else synthesize rows from existing `evidence[]` (unknown `screenId`); feed the resolver.
- **AC:** engine works identically whether a real or synthetic manifest is used; legacy stories unaffected.
- **DoD:** ingester + shim + tests.
- **Dependencies:** VT0-S3, VT1-S1. **Rollback:** ignore manifest → shim → legacy. **Validation:** integration (real + synthetic manifest round-trip via `phase2-validate.mjs` pattern).
- **Complexity:** M · **Effort:** 2.5d · **Affected:** `apps/worker/src/nodes.ts` (execution/report seam), `packages/shared/manifest.ts`. **Risk:** ⬇. **Owner:** QAP. **Parallel:** ⚠ after M1.

### VT2-S2 — Manifest emitter (platform-side, Option A) + external Selenium follow-up
- **✅ RESOLVED (Option A, approved 2026-07-21):** the **platform-side emitter** is implemented IN THIS REPO — the AI execution flow emits `evidence-manifest.json` **deterministically** from `ExecutionResults` (`buildManifestFromExecution` in `@qa/shared`, written by the `execution` node). The **Evidence Manifest is the stable producer/consumer contract**; the platform is **producer-agnostic** and consumes any valid manifest (Selenium/Playwright/BrowserStack/Appium/Maestro/AI agent).
- **⏭ EXTERNAL FOLLOW-UP (not in this repo):** the Selenium **TestNG `ITestListener` + `@VisualScreen("screenId")`** listener is a **separate integration in the external Selenium repo (`D:\projects`)** that emits the *same manifest format*. Do NOT implement it here; do NOT copy Selenium code here. Tracked as an external SEL task. (Original intent below, retained for the external implementer.)
- **Subtasks (external):** `@VisualScreen("screenId")` annotation; `ITestListener`/interceptor captures `getScreenshotAs(BYTES)` + `screenId` + (later) structured dump; append manifest row; write to the story workspace.
- **AC:** a reference Selenium web run produces a valid manifest with correct `screenId`/`platform`/`locale`/paths.
- **DoD:** listener in `D:\projects`; sample test annotated; manifest validated by ingester.
- **Dependencies:** VT0-S3 (schema), VT2-S1 (ingester). **Rollback:** don't register listener → synthetic shim path. **Validation:** manifest schema validation on real run.
- **Complexity:** M · **Effort:** 3d · **Affected:** `D:\projects` TestNG listener + annotation. **Risk:** ⬆ external framework access. **Owner:** SEL. **Parallel:** ✅ (SEL works in parallel with QAP on VT2-S1; contract = manifest schema).

### VT2-S3 — Mobile manifest rows (platform-side) + BrowserStack `screen` convention
- **✅ RESOLVED (Option A):** mobile manifest rows are produced by the **same producer-agnostic** `buildManifestFromExecution` (it parses each case's `combo` = "<platform> · <locale>", so android/ios rows carry the right platform) — no separate mobile path needed. Emitted deterministically by the platform, not the agent.
- **⏭ FOLLOW-UP (pending DEC-3):** the BrowserStack `screen`=`screenId` test-case field is the future **screenId source**; until the registry maps test cases → screens (DEC-3), manifest rows carry `screenId: ''` (heuristic pairing) with `testCaseId` populated from the case title. Wiring `screenId` from the test case is a DEC-3 follow-up. `bs_helper.js` needs no change (platform emits the manifest post-execution).
- **Subtasks:** add `screen`=`screenId` label/field to BS test cases; `bs_helper.js` capture writes manifest rows with `screenId`.
- **AC:** mobile screenshots land as manifest rows keyed by `screenId`; registry derives coverage.
- **DoD:** convention documented; mobile run produces valid rows.
- **Dependencies:** VT2-S1. **Rollback:** synthetic shim. **Validation:** mobile run manifest validated.
- **Complexity:** M · **Effort:** 2d · **Affected:** `bs_helper.js`, BS test-case template, `prompts.ts` mobile exec. **Risk:** ⬆ app instrumentation. **Owner:** SEL + QAP. **Parallel:** ✅.

> **M2 exit:** stable identity flows end-to-end; legacy stories still run via shim. Deployable.

---

## EPIC-VT3 — Structured Extraction (M3)

**Feature:** DOM/a11y (web) + page-source (mobile) + normalizer + OCR fallback. *Capture only — no comparison yet.*

### VT3-S1 — Web structured extractor (CDP/a11y + bounds/styles)
- **✅ RESOLVED (Option A, platform-side):** the **StructuredDump contract** (`structured.ts`) + **normalizer** (`normalize.ts`) + **OCR adapter** (`ocr.ts`) ship in `@qa/shared`; the **AI web flow** captures an a11y dump (`browser_snapshot` → `Write` to `<index>_<slug>.dump.json`) recorded in `CaseResult.structuredDump` and flowed to the manifest's `structuredDumpPath`. Producer-agnostic — any producer emits the same contract.
- **⏭ EXTERNAL FOLLOW-UP:** the Selenium 4 `DevTools` **CDP DOM/a11y + `getRect`/`getCssValue`** native extractor lives in the external Selenium repo and emits the **same StructuredDump format**. The raw-dump → normalized `StructuredDump` **parser** lands in **VT4** (consumption). Do not implement native Selenium here.
- **Subtasks (external):** Selenium 4 `DevTools` CDP DOM/a11y snapshot; `getRect`/`getCssValue`/`getDomAttribute` fallbacks; emit `structuredDump` into manifest; capability-branch when CDP absent.
- **AC:** reference web screens produce a parseable dump (roles, names, bounds, text, styles, test-ids).
- **DoD:** extractor + golden dumps; graceful degradation documented.
- **Dependencies:** VT2-S2. **Rollback:** stop populating dump (optional field). **Validation:** golden-dump tests.
- **Complexity:** L · **Effort:** 4d · **Affected:** `D:\projects` extraction utils, manifest schema. **Risk:** ⬆ Chromium/CDP dependency. **Owner:** SEL. **Parallel:** ✅ (with VT3-S2/S3).

### VT3-S2 — Mobile structured extractor (Appium page-source)
- **✅ RESOLVED (Option A, platform-side):** the **AI mobile flow** captures `getSource()` as the structured dump (recorded in `CaseResult.structuredDump` → manifest `structuredDumpPath`), using the same contract as web.
- **⏭ EXTERNAL FOLLOW-UP:** a richer native Appium extractor (`getPageSource()` XML → resource-id/content-desc/bounds/text, sparsity detector) is an external SEL task emitting the same StructuredDump format; the XML → `StructuredDump` parser + sparsity detection land in **VT4**.
- **Subtasks (external):** `getPageSource()` XML parse → components (resource-id/content-desc/bounds/text); emit dump; sparsity detector.
- **AC:** reference mobile screens produce a dump; sparse screens flagged (→ OCR/AI later).
- **DoD:** extractor + tests + sparsity flag.
- **Dependencies:** VT2-S3. **Rollback:** optional field. **Validation:** golden-dump tests (android/ios).
- **Complexity:** M-L · **Effort:** 3.5d · **Affected:** `bs_helper.js`/Appium utils, manifest. **Risk:** ⬆ app a11y-id quality. **Owner:** SEL. **Parallel:** ✅.

### VT3-S3 — Style normalization layer + OCR fallback module  ✅ DONE (platform-side)
- **Subtasks:** normalize color (→ΔE), units (px/rem), font-stack; OCR adapter for canvas/image/native-unstructured only.
- **AC:** normalizer passes color/unit/font cases; OCR invoked only when dump is sparse/absent.
- **DoD:** normalizer + OCR module + tests.
- **Dependencies:** VT0-S3. **Rollback:** normalizer identity + OCR off. **Validation:** normalizer unit matrix; OCR gated test.
- **Complexity:** M · **Effort:** 3d · **Affected:** new `packages/shared/normalize.ts`, OCR adapter. **Risk:** ⬆ format edge cases. **Owner:** SH (+ AI for OCR). **Parallel:** ✅ (independent of S1/S2).

> **M3 exit:** structured dumps + normalizer available; not yet consumed by comparison. Deployable.

---

## EPIC-VT4 — Validation Pyramid (M4) · *shadow mode*

**Feature:** deterministic layers, one at a time, each appending `VisualFinding` to the same `VisualComparison`. AI still runs on residual throughout M4.

> **Shared story shape for VT4-S2…S7:** each layer is a pure function `(expected, actual, profile) → VisualFinding[]` with `layer` + `source:'deterministic'`; unit-tested in the `visual.test.mjs` pattern; **shadow-diffed** vs legacy AI findings for that defect class before AI is disabled for it (in M5). Reuses `computeVisualHealth`/`detectVisualPatterns`/`renderReport` unchanged.

### VT4-S1 — Pyramid orchestrator (refactor `runVisualComparison`)
- **⚠ CONSTRAINT (recorded from VT0-S1 review):** `ctx.state.visualEngine` / `ctx.state.visualAbstain` are **informational/telemetry only**. The code that consumes the flag MUST obtain it from the single source of truth — `resolveVisualEngine(...)` / `resolveVisualAbstain(...)` — or receive it as an explicit input parameter. Do NOT make VT4-S1 depend on transient `ctx.state` values as its authoritative configuration source.
- **Subtasks:** extract the aggregation tail (keep); replace the pair→single-AI core with a per-component layer runner honoring `validationProfile.enabledLayers`; collect-all findings, local short-circuit on missing components; dispatch AI residual.
- **AC:** orchestrator runs enabled layers, aggregates via existing functions, emits the same `VisualComparison` shape.
- **DoD:** orchestrator + tests; behind `QA_VISUAL_ENGINE=shadow/pyramid`.
- **Dependencies:** M1–M3. **Rollback:** flag `legacy`. **Validation:** orchestrator integration test; shadow log.
- **Complexity:** L · **Effort:** 4d · **Affected:** `apps/worker/src/nodes.ts:1815-1859`, new `packages/shared/pyramid/*`. **Risk:** ⬆ central refactor — contained by flag. **Owner:** QAP + SH. **Parallel:** ⚠ gates S2–S7.

### VT4-S2 — L5 Text/Copy layer *(first — biggest deterministic win)*
- Figma text-layer (REST) vs dump text; exact + Unicode-normalize + RTL.
- **Complexity:** M · **Effort:** 3d · **Affected:** `pyramid/text.ts`, Figma text fetch. **Owner:** SH + QAP. **Parallel:** ✅ after S1 (independent of other layers).

### VT4-S3 — L2 Component Tree layer *(highest-value defects)*
- `expectedComponents` vs actual set: missing/extra/order/hierarchy/duplicate.
- **Complexity:** L · **Effort:** 4d · **Affected:** `pyramid/components.ts`. **Dep:** DEC-3 (expectedComponents authored). **Owner:** SH + QAP. **Parallel:** ✅ after S1.

### VT4-S4 — L3 Visibility layer
- `isDisplayed` + bounds>0 + on-screen. **Complexity:** S-M · **Effort:** 2d · **Affected:** `pyramid/visibility.ts`. **Owner:** SH. **Parallel:** ✅.

### VT4-S5 — L4 Layout layer
- bounds vs Figma abs-box within tolerance. **Complexity:** M · **Effort:** 3d · **Affected:** `pyramid/layout.ts`. **Dep:** normalizer. **Owner:** SH. **Parallel:** ✅.

### VT4-S6 — L6 Styles/Tokens layer
- normalized computed style vs Figma node style. **Complexity:** M · **Effort:** 3d · **Affected:** `pyramid/styles.ts`. **Dep:** VT3-S3 normalizer. **Owner:** SH. **Parallel:** ✅.

### VT4-S7 — L7 Pixel (advisory) + registry-validation diagnostic
- SSIM/diff → regions (advisory, not gate in design mode); registry-drift diagnostic in the pre-execution gate.
- **⚠ FOLLOW-UP (recorded from VT0-S3 review):** the VT0-S3 loader does NOT detect/reject **duplicate `screenId`** values across registry files — it collects all. The registry-validation diagnostic MUST detect and report duplicate `screenId`s (and, per §6, duplicate `ValidationProfile.id`s) as a hard validation error before registry data is relied upon. Until then, callers should treat a duplicate id as undefined-order. (See also DEC-3.)
- **Complexity:** M · **Effort:** 3d · **Affected:** `pyramid/pixel.ts`, `apps/api/src/diagnostics`. **Owner:** QAP + BE. **Parallel:** ✅.

> **Common to VT4-S2…S7:** **AC** = layer detects its defect class deterministically ≥ parity with legacy AI on the golden set. **DoD** = unit tests + shadow-diff reviewed at CP-3. **Rollback** = disable via `enabledLayers`. **Risk** = false positives from cross-source deltas (mitigated by tolerances). **Parallelizable** = ✅ across layers once S1 lands.

> **M4 exit:** all deterministic layers produce findings in shadow; report shows them; AI still authoritative. Deployable (report still legacy-driven).

> **✅ M4 DELIVERED (2026-07-21, "engine + dispatch now" scope, approved).** Implemented in `@qa/shared/pyramid.ts` (all layers **L2–L7** + orchestrator, pure + unit-tested) + worker dispatch (`QA_VISUAL_ENGINE` = `legacy`|`shadow`|`pyramid`, resolved via `resolveVisualEngine`, passed explicitly). `runPyramidComparison` reuses the unified resolver (registry-first pairing), the registry (`expectedComponents`/profile), and structured dumps; **L2/L3/L5** run on registry+dump data; **L4/L6** run when expected `bounds`/`styles` are present (additive on `ExpectedComponent`); aggregation reuses `computeVisualHealth`/`detectVisualPatterns`/`renderReport` unchanged. VT4-S7 registry-validation diagnostic (incl. the duplicate-`screenId` follow-up) shipped as a **non-required** `core.screenRegistry` check + pure `validateScreenRegistry`.
>
> **⏭ DEFERRED PRODUCERS (dormant until wired — layers implemented + tested):** (1) **Figma structured extraction** (expected `bounds`/`styles`/text → activates L4/L6 fully); (2) **raw-dump parser** (Playwright a11y-text / Appium XML → `StructuredDump`; today only `StructuredDump`-JSON dumps are consumed, else the actual side is dormant); (3) **real pixel comparator** (`pixelmatch`/`pngjs` behind `PixelComparator`; `nullPixelComparator` default → L7 no-op); (4) **DEC-3 registry data** (authored `screenId`→`figmaNodeId` + `expectedComponents`). Shadow mode correctly shows pyramid < legacy until these land.
>
> **Producer progress (coverage push toward a GO):**
> - **#1 Figma structured extraction — ✅ CODE DONE (2026-07-21).** Pure `figmaNodesToStructuredDump` (Figma REST node tree → `StructuredDump`, frame-relative bounds + color/font/radius styles) + conservative `structuredDumpToExpectedComponents` (TEXT/components only, `required:false` → no L2 missing-spam) in `@qa/shared/figma-extract.js` (unit-tested). Worker: `extractFigmaStructures` (figma.ts) fetches + caches `figma-analysis/extract/<nodeId>.json` during `figma_analysis` (opt-in `QA_FIGMA_EXTRACT`, best-effort, rate-limit-safe); `runPyramidComparison` loads it as the EXPECTED source when the registry has no curated components. **Runtime evidence gated on a live run** (Figma token + real story) — not collectable in a headless session. Note: L4/L5/L6 still need the ACTUAL side (producer #3) to fire end-to-end.
> - **DEC-3 registry framework — ✅ DONE (2026-07-21).** Schema (`Screen`/`ValidationProfile`) + validator (`validateScreenRegistry`) already shipped (VT0-S3/VT4-S7). Added the authoring **guide** (`docs/ai/screens/README.md`), a **template** (`_template.json`), and one worked **example** (`_example.address-list.json`). Verified: the loader **skips** `_`-prefixed files (registry stays empty — no fabricated production data), and the example/template are schema-valid + validator-clean. **Populating real screens** (real test-ids + Figma node-ids) is a live QA-lead data task.
> - **#3 raw-dump parser — ✅ DONE (2026-07-21).** `@qa/shared/dump-parse.js`: `parsePlaywrightA11y` (a11y snapshot text → hierarchy/roles/names/text), `parseAppiumXml` (Android bounds/resource-id + iOS x/y/w/h/name — dependency-free), `parseRawDump` (JSON/XML/a11y auto-detect). Wired into the worker's `loadStructuredDump`, so the ACTUAL side now feeds L2–L6 from real captures. Unit-tested (4).
> - **#4 pixel comparator — ✅ DONE (2026-07-21, optional).** Worker `pngPixelComparator` (`apps/worker/src/pixel.ts`) via `pngjs`+`pixelmatch`; dimension-gated (design-vs-actual size mismatch → skip/null), opt-in `QA_VISUAL_PIXEL`, advisory L7 only. Runtime smoke-verified (identical→0, different→1, mismatch/missing→null).
> - **Remaining (live-environment only):** populate the registry from the real Figma project → run `shadow` on real stories → `evaluateCutover(persisted metrics)` → flip default on **GO**.
> - **Cutover status:** `evaluateCutover([])` = **NO-GO** (0 real shadow runs collected — requires a live environment). Unchanged; default stays `legacy`.

---

## EPIC-VT5 — AI Narrowing (M5)

**Feature:** AI-skip predicate + deterministic severity/root-cause; AI → residual only.

### VT5-S1 — AI-skip predicate (§5 seven clauses) + audit sampling
- **Subtasks:** implement predicate over layer results; invoke AI only on residual/unstructured components; add logged audit-sample of PASSes.
- **AC:** 0 AI calls on all-clean fully-structured golden screens; audit-sample logged; AI runs on residual.
- **DoD:** predicate + tests + telemetry.
- **Dependencies:** M4, DEC-2. **Rollback:** predicate off → M4 behavior. **Validation:** assert AI-call count; token telemetry.
- **Complexity:** M · **Effort:** 3d · **Affected:** `pyramid/orchestrator`, LLM log. **Risk:** ⬆ over-suppression — audit sample mitigates. **Owner:** QAP + AI. **Parallel:** ⚠ after M4.

### VT5-S2 — Deterministic severity + root-cause for layer-produced findings
- **Subtasks:** severity = magnitude × category × layer weights; root-cause via `rootCauseFor`-style template; AI severity kept only for AI-source findings.
- **AC:** deterministic severity matches reviewer expectation on golden set; same evidence → same severity.
- **DoD:** severity fn + tests.
- **Dependencies:** M4. **Rollback:** revert to AI severity. **Validation:** determinism test (same input → same output).
- **Complexity:** M · **Effort:** 2.5d · **Affected:** `visual.ts`, `pyramid/*`. **Risk:** ⬇. **Owner:** SH. **Parallel:** ✅ (with VT5-S1).

### VT5-S3 — Narrow the L8 AI prompt (classify, not detect) + direct-image path
- **⏭ FOLLOW-UP (deferred, dependency-gated).** The residual AI today runs on screens the deterministic layers **could not evaluate at all** (no structured dump / no expected data), so there are no deterministic findings to "classify" — the existing `visual_comparison` **detect** prompt is the correct behavior and is reused. The narrowed **classify-mode** prompt + direct-image path (DEC-2) becomes meaningful only once the deterministic layers reliably produce findings for the AI to *verify* (i.e., after Figma extraction + the raw-dump parser land). Deferred to avoid a speculative, unused prompt; recorded here.
- **Subtasks:** rewrite `visual_comparison` sub-capability to *classify/confirm* a specific flagged region (not free-hand detect); bump prompt version; direct-image (per DEC-2) for canvas; read-confirmation guard.
- **AC:** L8 receives only the residual region + expected/actual values + relevant checklist; prompt version recorded.
- **DoD:** prompt v2 in registry; explainability provenance intact.
- **Dependencies:** VT5-S1, DEC-2. **Rollback:** previous prompt version (registry). **Validation:** LLM-log inspection; token/accuracy on golden residuals.
- **Complexity:** M · **Effort:** 2.5d · **Affected:** `prompts.ts:506-539`, engine call, `nodes.ts:1834-1845`. **Risk:** ⬆ prompt regression — versioned rollback. **Owner:** AI. **Parallel:** ✅.

> **M5 exit:** AI ≈ 0 on structured screens; deterministic severity/root-cause; token reduction measured. Deployable in `shadow`.

> **✅ M5 DELIVERED (2026-07-21).** **VT5-S1** — pure `shouldInvokeAi` gate (§5) + deterministic `isAuditSampled` in `@qa/shared/visual-ai-gate.ts`; wired into the `pyramid` engine so AI runs **only on the residual** (no structured/expected data) + a bounded audit sample (`QA_VISUAL_AI_AUDIT_RATE`, default 0); per-run `AI invoked/skipped` logged. Shadow's pyramid pass stays **deterministic-only** (no double AI cost). **VT5-S2** — deterministic magnitude-based severity (`severityForRatio`) applied to L4/L6 (≥3×tol→major, >1×→minor); root-cause already deterministic in the layers. **VT5-S3** — deferred (see story note). **Shadow divergence metrics** (per directive) — `computeVisualDivergence` persisted to `ctx.state.visualDivergence` + `visual-shadow-metrics.json` each shadow run (verdict-agreement rate, per-severity finding counts) for the cutover decision; **rollout unchanged** (default `legacy`).

---

## EPIC-VT6 — Cutover & Legacy Removal (M6)

> **✅ M6 STATUS (2026-07-21): decision engine delivered; cutover HELD (approved).** The deterministic **`evaluateCutover`** engine (VT6-S1) is implemented + tested and is the sole sanctioned basis for cutover. Applied to current evidence it returns **🔴 NO-GO** — two blockers: (1) **no shadow-window evidence** collected from real runs yet (`screensCompared = 0`); (2) the pyramid's data producers are **dormant** (Figma structured extraction, raw a11y/XML→`StructuredDump` parser, DEC-3 registry data all deferred), so its deterministic-only shadow pass under-detects → `findingRatio → 0`. **Default stays `legacy`.** **VT6-S2 (flip default) and VT6-S3 (remove legacy) are BLOCKED**, gated on a **GO** verdict after the deferred producers land AND a real shadow window clears the thresholds. Forcing cutover now would regress detection to ≈0 and delete the only working engine.

### VT6-S1 — Shadow-window analysis + go/no-go (CP-5)  ✅ DONE (engine); verdict NO-GO
- **Delivered:** `evaluateCutover(divergences[], thresholds?)` in `@qa/shared/visual-cutover.ts` — aggregates the VT5 shadow divergences → GO/NO-GO with explicit reasons (insufficient evidence / low verdict agreement / finding under-detection), configurable thresholds (default: ≥20 screens, ≥90% verdict agreement, ≤10% finding regression). Pure + reproducible; unit-tested. Feeding it aggregated persisted `visual-shadow-metrics.json` across real runs is the remaining (data-gated) step.
- **Subtasks:** run `shadow` across the agreed real-story window; quantify divergence; sign-off report.
- **AC:** divergence within agreed bounds; parity/Review-Confidence non-regressed.
- **DoD:** cutover report + approval.
- **Dependencies:** M5. **Rollback:** stay `shadow`. **Validation:** divergence dashboard.
- **Complexity:** M · **Effort:** 3d (mostly runtime) · **Affected:** telemetry, report. **Owner:** QAP + QAL. **Parallel:** ⚠ gating.

### VT6-S2 — Flip default → `pyramid`  ⛔ BLOCKED (gated on GO)
- **AC:** new runs use pyramid; legacy reachable via flag for one release.
- **Complexity:** S · **Effort:** 0.5d · **Rollback:** flag back to `shadow`/`legacy`. **Owner:** QAP. **Parallel:** ⚠ after VT6-S1.

### VT6-S3 — Remove legacy force-pairing + path-image delivery (post-bake)  ⛔ BLOCKED (gated on GO + bake)
- **Subtasks:** delete `bestShot`/`matchExpected` force-pair branches; remove common-case "(READ it)" delivery (keep L8 canvas); prune dead flags.
- **AC:** no dead legacy path; tests green.
- **Complexity:** M · **Effort:** 2d · **Rollback:** git revert. **Validation:** full regression. **Owner:** QAP. **Parallel:** ❌ (last).

> **M6 exit (partial):** cutover **decision engine** delivered; cutover itself **held at NO-GO** (default `legacy`). Full M6 exit (ADR-002 Rev.2 DoD; legacy removed) is reached only after a **GO** — i.e. deferred producers land + a real shadow window clears `evaluateCutover`. Deployable throughout (legacy unchanged).

---

## EPIC-VT7 — Regression Mode (M7) · *optional, future*

### VT7-S1 — `baselineRef` storage + pixel-as-gate in regression profile
- **AC:** a screen with a baseline gates on pixel diff (same-app regression); design-conformance unaffected.
- **Complexity:** L · **Effort:** 5d · **Owner:** QAP + SH. **Parallel:** ✅ (net-new).

---

# Summary plans

## 1. Overall implementation timeline (team of 4–5)

| Milestone | Calendar | Sprints |
|---|---|---|
| DEC-1/DEC-2 + M0 Foundations | Week 1 | S1 |
| M1 Correct Pairing | Week 2 | S1–S2 |
| M2 Evidence Manifest | Weeks 3–4 | S2–S3 |
| M3 Structured Extraction | Weeks 4–5 | S3 |
| M4 Validation Pyramid | Weeks 6–8 | S4–S5 |
| M5 AI Narrowing | Weeks 9–10 | S5 |
| M6 Cutover (incl. shadow bake) | Weeks 11–12 | S6 |
| M7 Regression (optional) | later | — |

≈ **10–12 weeks** to M6 with a team; M7 deferred.

## 2. Critical path

```
DEC-1 → VT0-S3 (registry types) → VT1-S1 (resolver) → VT1-S2 (coverage-gap)
      → VT2-S1 (ingester) → VT4-S1 (orchestrator) → VT4-S3 (L2 components)
      → VT5-S1 (skip predicate) → VT6-S1 (shadow analysis) → VT6-S2 (flip) → VT6-S3 (remove legacy)
```

The **orchestrator (VT4-S1)** and **resolver (VT1-S1)** are the two central chokepoints; everything deterministic hangs off them. DEC-1 gates the whole chain on day 0.

## 3. Parallel work streams

| Stream | Owner | Runs in parallel |
|---|---|---|
| **Platform core** | QAP + SH | resolver, orchestrator, pyramid layers, predicate (critical path) |
| **Selenium/Java** | SEL | manifest emitter (VT2-S2), web/mobile extractors (VT3-S1/S2) — parallel to platform, contract = manifest schema |
| **AI** | AI | OCR (VT3-S3), L8 prompt (VT5-S3), severity input |
| **Registry data** | QAL | DEC-3 authoring — continuous from M2 |
| **API/Web** | BE + FE | diagnostics (VT4-S7), report/coverage-gap rendering |

Layers **VT4-S2…S7 fully parallelize** once VT4-S1 lands (independent pure functions).

## 4. Milestone plan (M0–M7)

M0 Foundations · M1 Correct Pairing (★bug fix) · M2 Evidence · M3 Extraction · M4 Pyramid (shadow) · M5 AI Narrowing · M6 Cutover · M7 Regression (opt). Exit criteria per epic above; go/no-go at CP-1…CP-5 (AIP-002 Part 8).

## 5. Suggested Jira epic hierarchy

```
Initiative: Visual Testing Engine — ADR-002 Rev.2
├─ EPIC-VT-DEC  Prerequisites & Decisions
├─ EPIC-VT0     Foundations (M0)
├─ EPIC-VT1     Correct Pairing (M1) ★
├─ EPIC-VT2     Evidence Manifest (M2)
├─ EPIC-VT3     Structured Extraction (M3)
├─ EPIC-VT4     Validation Pyramid (M4)
│    └─ Features: Orchestrator · L5 · L2 · L3 · L4 · L6 · L7
├─ EPIC-VT5     AI Narrowing (M5)
├─ EPIC-VT6     Cutover & Legacy Removal (M6)
└─ EPIC-VT7     Regression Mode (M7, optional)
```
Each `VTx-Sy` = a Story; subtasks = Jira sub-tasks; DEC-* = Spikes/Decisions.

## 6. Recommended sprint grouping (2-week sprints)

- **S1:** DEC-1/2, VT0-S1/S2/S3, start VT1-S1.
- **S2:** VT1-S1/S2, VT2-S1; SEL starts VT2-S2.
- **S3:** VT2-S2/S3, VT3-S1/S2/S3 (parallel), DEC-3 ongoing.
- **S4:** VT4-S1, then VT4-S2/S4 (parallel).
- **S5:** VT4-S3/S5/S6/S7, VT5-S2 (parallel), start VT5-S1.
- **S6:** VT5-S1/S3, VT6-S1 (shadow bake), VT6-S2/S3.

## 7. Team staffing recommendation

- **2× QA Platform engineers** (SH/QAP) — resolver, orchestrator, layers, predicate (critical path).
- **1× Selenium/Java engineer** (SEL) — listener + extractors (parallel stream).
- **1× AI engineer** (AI, part-time) — OCR + L8 prompt + severity input.
- **0.5× Backend/Web** (BE/FE) — diagnostics + report rendering.
- **QA Leads** (QAL) — registry curation + shadow-window review.

Minimum viable: 2 platform + 1 Selenium + shared AI/QAL.

## 8. Risk matrix

| Risk | Likelihood | Impact | Mitigation | Owner |
|---|---|---|---|---|
| Registry drift (missing screenId/node) | Med | High | VT4-S7 drift diagnostic; `figmaFrameName` cross-check | QAP/QAL |
| Registry curation capacity | Med | High | progressive adoption; graceful degradation | QAL |
| Cross-source style/format deltas → false positives | Med | Med | normalizer + tolerances; ambiguous → L8 | SH |
| Mobile dump sparsity (app not instrumented) | Med | Med | sparsity detector → OCR/AI; report as coverage gap | SEL |
| CDP/Chromium dependency (web) | Low-Med | Med | graceful L6 downgrade to advisory | SEL |
| Central refactor (orchestrator/resolver) regressions | Med | High | flag + shadow mode + golden set | QAP |
| Over-suppression by skip-predicate | Low-Med | Med | audit-sample + logging | QAP/AI |
| DEC-2 touches locked decision | Low | Med | keep CLI `Read` default; escalate only if needed | QAP |

## 9. Implementation order — solo vs team

**Solo engineer (value-first, minimize context switches):**
1. DEC-1 → VT0 (all) → **VT1-S1/S2 (ship the bug fix — highest ROI alone)**.
2. VT2-S1 + synthetic shim (identity without needing Selenium yet).
3. VT4-S1 orchestrator → **VT4-S2 (L5 Text)** → VT5-S2 deterministic severity (biggest AI reduction for least code).
4. VT4-S3 (L2) once registry has `expectedComponents`.
5. VT3 extraction (only as deep as the layers you've built need).
6. VT5-S1 predicate → shadow → cutover.
> Solo path front-loads the pairing fix and text layer — the two changes that remove most false positives and most tokens with the least surface area. Defer mobile extraction, pixel, and regression mode.

**Team (maximize parallelism):**
- Platform pair drives the critical path (resolver → orchestrator → predicate).
- SEL builds emitter + extractors against the frozen manifest schema in parallel from S2.
- AI owns OCR + L8 prompt independently.
- QAL curates the registry continuously.
- Layers VT4-S2…S7 fan out across engineers once VT4-S1 merges.

---

### Cross-references
Architecture: [ADR-002 Rev.2](./adr-002-visual-testing-redesign-rev2.md) · Migration plan: [AIP-002](./adr-002-implementation-plan.md) · Current-state: [ADR-002 Rev.1](./adr-002-visual-testing-redesign.md).
