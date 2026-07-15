# Phase 2 — Platform Intelligence

> Phase 2 turns the Phase 1 foundation into reviewer-facing intelligence: traceability, explainability, visual testing, story health, recommendations, and richer reporting. Every capability must answer *does it improve review quality / traceability / confidence / visual testing / automation quality, reduce manual effort, or make the platform easier to trust?* Platform Parity and the canonical 27-node workflow remain unchanged. Foundation: [phase1-foundation.md](./phase1-foundation.md).

Milestones (each shipped + reviewed independently): **M1 Citation completion** → M2 Explainability + Review Confidence → M3 Visual Testing Intelligence → M4 Story Health → M5 AI Recommendations → M6 Activity Timeline → M7 Enhanced Reports → M8 Knowledge Lint.

---

## M1 — Citation & Traceability completion ✅

Builds on the Phase 1 citation *foundation* (optional `sources` on `RequirementsAnalysis`, `Hls` scenarios, `TestCase`, `Defect`). Completion adds **emit**, **resolve**, and **render**.

**Emit (versioned prompt change).** A shared `CITATION_DIRECTIVE` is appended to the prompts whose result schema has `sources`, instructing the model to record provenance as `{kind, ref}`:
- `requirements_analysis` v1.1.0 — cites ac|comment|rule|requirement.
- `generate_hls` v1.1.0 — per scenario, cites ac|requirement.
- `generate_testcases` v1.1.0 — per case, cites the ac it validates.
- `execution` v1.1.0 — per Defect, cites what it violates (ac|figma|rule), reinforcing the existing defect-grounding SOURCE gate.

Additive and optional — a model that omits `sources` still validates (back-compatible). Schema hints updated to show the `sources` shape. Prompt versions bump → recorded on every run via `PROMPT_REGISTRY_VERSION`.

**Resolve.** [`packages/shared/src/citations.ts`](../../packages/shared/src/citations.ts) — pure `resolveCitation(citation, ctx)` → `{ kind, ref, label, title?, href? }`:
- `story` → Jira `…/browse/<key>`; `comment` → `…/browse/<story>?focusedCommentId=<id>` (+ title); `ac` → label + AC text as title; `figma` → `figma.com/design/<fileKey>` (+ frame title); `rule`/`testcase`/`requirement` → labels (+ optional BrowserStack link). Jira/BS/Figma/KB-native only — no Azure concepts. Degrades to labels-only when no base URL.

**Render.** The HTML report ([`nodes.ts`](../../apps/worker/src/nodes.ts) `renderReport`) shows citation **chips** on each test case, each defect, and the requirements summary, built from a `CitationContext` assembled from run state (AC map, Figma file key, story key) + the Jira base URL (stashed in `html_report` from Settings). New `.cite` styles; deep-links where a base URL is configured.

**Tests:** [`citations.test.mjs`](../../packages/shared/citations.test.mjs) (7 — every kind, links, title, label override, empties) + updated prompt golden asserting the directive is appended while the baseline instruction is preserved.

**Serves:** traceability + trust — every generated artifact shows where it came from, and the model is now instructed to attribute it.

**Web rendering** of citations lands with **M2** (the AI Explainability panel), which surfaces the full provenance envelope (sources + prompt version + KB docs + Review Confidence) in the run UI.

---

## M2 — AI Explainability + Review Confidence ✅

**Explainability (not a citation dump).** [`packages/shared/src/explain.ts`](../../packages/shared/src/explain.ts) — pure `explainArtifact(input)` → `ArtifactExplanation { artifactKind, artifactLabel, node, reason, contributed, versions, evidence }`. `contributed` groups resolved citations by the reviewer question they answer (acceptanceCriteria / storyComments / figmaFrames / businessRules / testCases / other). `reason` is a human "why generated" sentence — derived per artifact kind, or **explicitly supplied** (the seam M3 uses: a visual finding passes `reason: "Button label uses sentence case instead of title case"` + the Figma frame as a `figma` citation). `versions` carries prompt/workflow/knowledge/framework/platform.

**Server-side builder = the reusable seam.** `RunsService.explain(runId)` ([`runs.service.ts`](../../apps/api/src/runs/runs.service.ts)) assembles explanations for every supported artifact (requirements, impact, each HLS scenario, each test case, each defect) from **persisted** `RunStep.outputJson` + the **LLM Request Log** (prompt version that actually ran) + the `Run` version stamps. Route: `GET /runs/:id/explain`. Because it reads only persisted data, the same seam serves **Story Replay** and **QA Analytics** with no new architecture. Extends to `visual_finding` (M3) and `recommendation` (M5) with zero shape change.

**Review Confidence — deterministic, NOT model-estimated.** `computeReviewConfidence(input)` in [`run-evaluation.ts`](../../packages/shared/src/run-evaluation.ts) (same engine as Parity — the Phase-1 substrate). Scores 13 evidence signals (requirements analyzed, AC mapped, comments analyzed, Figma analyzed, visual comparison completed, test cases generated, BrowserStack import verified, automation generated, automation executed, report generated, evidence collected, defects reviewed, traceability) — each scored **only when applicable** (its phase was enabled / its precondition holds). Score = satisfied ÷ applicable; every unmet applicable signal yields a plain-language **reduction** ("Missing Figma analysis", "Visual comparison skipped", "Automation not executed"). Same input → same output; changes only when evidence changes. Computed in `html_report`, persisted to `Run.reviewJson`.

**Rendering.** HTML report gains a Review Confidence section (badge + reductions + per-signal ✓/✗). Web run detail ([`stories/[id]/page.tsx`](../../apps/web/app/stories/[id]/page.tsx)) gains an **Explainability panel**: a Review Confidence badge + signal chips, and an expandable per-artifact "Explain" view (why · AC · comments · Figma · rules · prompt/workflow versions · evidence) fed by `GET /runs/:id/explain`.

**Tests:** `explain.test.mjs` (grouping, explicit-reason/visual shape, confidence high/deterministic/reductions/applicability) + `scripts/phase2-validate.mjs` (live end-to-end: explain assembles artifacts + resolved AC text + prompt version from the log + persisted review confidence).

**Serves:** review quality, confidence, trust, auditability — and lays the explainability foundation for M3 visual findings.

## M3 — Visual Testing Intelligence ✅

The platform's biggest differentiator: reasons about the UI like a Senior QA Engineer against **both** the Acceptance Criteria (expected behavior) and the Figma design (expected implementation).

**Determinism model (honest split).** *Detection* is AI vision reasoning (inherently non-deterministic, like execution). *Everything around it is deterministic and tested*: the checklist of what's validated, per-category/severity aggregation, visual health, pass rate, coverage, grouping, explainability.

**Checklist (deterministic taxonomy).** [`packages/shared/src/visual.ts`](../../packages/shared/src/visual.ts) — `VISUAL_CATEGORIES` (11: layout, positioning, typography, content, color, components, dropdowns, states, navigation, responsive, accessibility) + `VISUAL_CHECKS` (~47 fine-grained checks covering the full mandated set: layout/grid/section-order/hierarchy; alignment/position/margins/padding/spacing/distribution; font family/size/weight/line-height/letter-spacing/sentence-case/wrapping; exact wording for labels/helper/placeholder/button/validation/success/error + punctuation/whitespace; background/text/border/shadow/radius; components incl. dropdowns item-ordering/values/selection; default/hover/focus/active/selected/disabled/loading/error/success/empty states; navigation/conditional visibility; responsive; contrast/focus/a11y-labels). The checklist is injected into the prompt so every dimension is independently and reproducibly covered.

**Comparator (AI vision).** Prompt `visual_comparison` v1.0.0 (registry sub-capability): given the Figma frame image + actual screenshot + AC + the checklist, returns a `VisualScreenComparison` with reviewer-grade findings — each: category, dimension, severity (critical|major|minor|info), expected, actual, **differenceDescription** (self-explaining), recommendation, **confidence** (AI detection certainty — distinct from Review Confidence), and sources (AC + Figma frame). Enforces the RTL/per-platform-frame parity rule and the same grounding discipline as defects (no invented issues).

**Schema (M3).** `VisualFinding` upgraded to the full reviewer record; `VisualScreenComparison` adds `categoriesChecked`; `VisualComparison` adds `categoriesCovered`. Back-compatible (widened enums, optional fields).

**Pipeline + wiring.** `runVisualComparison(ctx)` (worker `html_report`, best-effort, bounded by `QA_VISUAL_MAX_SCREENS`): matches each exported Figma frame to an actual screenshot (token overlap, index fallback), runs the vision comparator per pair, aggregates into a `VisualComparison` on `ctx.state.visual`. Modular — future comparators (pixelmatch, OCR, axe, cross-browser/device, theme) append findings to the same shape with **no architecture change**. Feeds Parity Certification's visual coverage and Review Confidence's visual signal.

**Aggregation (deterministic).** `computeVisualHealth(vc)` → screens validated/passed/failed, pass rate, findings by severity + by category, categories covered, coverage %, and an overall **Visual Health** (100 − severity-weighted penalties) + level. Pure and tested.

**Evidence + report.** A dedicated **Visual Testing Intelligence** report section: KPI tiles (Figma frames, screens validated/passed/failed, visual pass rate, category coverage), Visual Health badge, findings by severity/category, and a self-explaining card per finding (severity · category/dimension · screen · confidence · differenceDescription · expected/actual · fix · AC/Figma chips). The existing Expected-vs-Actual screenshot embedding remains beneath it.

**Explainability.** `explainVisualFinding()` maps each finding to the M2 `ArtifactExplanation` with a precise reason ("Button label uses sentence case instead of title case") + the compared Figma frame + AC + evidence; `RunsService.explain` emits `visual_finding` artifacts (prompt version = `visual_comparison`), so the web Explain panel renders them like any other artifact.

**Tests:** `visual.test.mjs` (checklist completeness incl. all mandated dimensions, deterministic health/coverage/pass-rate, explainVisualFinding precision) + `scripts/phase2-validate.mjs` extended (visual finding flows through `explain()` end-to-end).

**Serves:** the strongest visual validation in the platform — visual testing, review quality, confidence, and trust. *(AI detection quality is validated in live runs; the deterministic framework is fully unit/integration-tested here.)*

### M3.5 — Design-system awareness + pattern detection ✅

Refinement of M3 (no architectural change — additive to the same comparator pipeline). The engine now reasons about the **design system**, not just visual deltas.

**Design-system awareness (schema, additive).** `VisualFinding` gains optional `component` (free-text, drawn from the `UI_COMPONENTS` vocabulary — Primary Button, Dropdown, Card, Bottom Sheet, …) and `token` (`DesignTokenRef { kind ∈ typography|color|spacing|layout|radius|shadow|component, name?, expected?, actual? }`). Component is intentionally an open string (not an enum) so a model may name a component we haven't enumerated without breaking validation. This is the seam future **Design-Token validation / Component-Library comparison / Figma Variables** feed into — no schema change required to populate `token.name`/`expected`/`actual` from extracted variables later.

**Component + token in the prompt (`visual_comparison` v1.1.0).** The comparator is instructed to name the reusable component, cite the design token that is the **root cause** (a color delta on a button → a color-token issue), and phrase recommendations at the shared-component/token level ("Update the shared Primary Button typography token") rather than per-screen. The component vocabulary + token kinds are injected. Version bumped → recorded on every run.

**Pattern detection (deterministic).** `detectVisualPatterns(vc)` in [`visual.ts`](../../packages/shared/src/visual.ts) groups findings that share a key (category + dimension + component + token) into a single `VisualPattern` when they recur (occurrences ≥ 2) — "Sentence case affecting 8 screens", "Primary Button spacing affecting 5 screens". Each pattern carries the highest grouped severity, the affected screen list, a **root-cause** sentence, and an **actionable, root-cause-level recommendation**. Pure and tested — same findings ⇒ same patterns, never model-authored. Avoids N duplicate findings when one root cause explains them. `computeVisualHealth` now also reports `componentsAffected` + `patternCount`.

**Explainability.** `explainVisualFinding` leads with the design-system framing when a component/token is present ("Primary Button uses the wrong typography token: …") and names the component in the artifact label, so the web Explain panel and the report read like a Senior QA reviewer.

**Report.** The Visual Testing Intelligence section gains a **Recurring patterns** block (root cause · occurrences · affected screens · root-cause fix), a **components-affected** summary, and component/token chips on every finding card.

**Future readiness (no architecture change).** Design-Token validation, Component-Library comparison, Figma Variables, pixel comparison, OCR, and accessibility scanners all fit the existing pipeline: new comparators append `VisualFinding`s (optionally populating `component`/`token`) to the same `VisualComparison`; `detectVisualPatterns` + `computeVisualHealth` + `explainVisualFinding` consume them unchanged. Figma Variables extraction populates `token.name`/`expected`/`actual` through the already-defined `DesignTokenRef` seam.

**Tests:** `visual.test.mjs` extended (vocabulary exports, deterministic pattern grouping across screens with highest-severity + root-cause recommendation, components-affected/pattern-count in health, design-system reason prefix) + `scripts/phase2-validate.mjs` asserts the component/token framing flows through `explain()` end-to-end.

**Serves:** actionable, root-cause visual review — reviewers fix the shared component/token once instead of triaging duplicate findings, and the platform is ready for token/component/variable comparators with zero rework.

**Runtime characteristics (token-consumption principle).** M3.5 introduces **zero additional Claude model invocations**. It reuses the **single** existing Visual Comparison reasoning call (`visual_comparison`, one per matched Figma frame↔screenshot pair, bounded by `QA_VISUAL_MAX_SCREENS` — unchanged from M3) and performs **all** additional processing deterministically in pure code: `detectVisualPatterns` (pattern grouping + root-cause recommendations), `computeVisualHealth` (`componentsAffected` + `patternCount`), and `explainVisualFinding` (design-system framing) make **no** AI or network calls. Component/token identification is emitted *within* the existing per-frame call — the prompt bump (v1.0.0 → v1.1.0) enriches that call's output, adding a small, bounded amount of input tokens per existing call but **no new call**. This upholds the platform principle: **one AI reasoning step → multiple deterministic downstream capabilities**, never multiple AI reasoning steps.

## M4 — Story Health ✅

A single, deterministic **six-dimension roll-up** of overall story quality — the top-level "is this story in good shape?" score — computed by **reusing** existing evaluation outputs. **Zero new AI invocations** (ADR-001): it derives entirely from data other steps already produced.

**Engine (reuses the Phase-1 substrate).** `computeStoryHealth(input, parity, review, extras)` in [`run-evaluation.ts`](../../packages/shared/src/run-evaluation.ts) — the same module as Parity Certification + Review Confidence. It takes the already-computed `ParityCertification` + `ReviewConfidence` + (optional) `VisualHealth` (from M3's `computeVisualHealth`) + defects, and never recomputes them. Pure — same inputs ⇒ same output.

**Six dimensions**, each scored 0–100 and **applicability-gated** (a skipped phase is `n/a`, never a 0 that unfairly drags the mean):
1. **Requirements** — AC captured & testable + requirements analysis completed.
2. **Coverage** — AC↔case mapping (`parity.acCoverageRate`) + platform×locale combo coverage (`parity.comboCoverageRate`).
3. **Execution** — pass rate of executed cases.
4. **Visual** — reuses M3 Visual Health.
5. **Defects** — inverse severity-weighted burden (Critical 30 · High 15 · Medium 6 · Low 2).
6. **Traceability** — % of test cases carrying citations (reuses Citation & Traceability).

Overall = mean of **applicable** dimensions; level high/medium/low; plain-language `reductions` for every dimension below "high". A `summary` line cross-references Review Confidence + Parity so the three roll-ups stay legible together.

**Persistence + surfacing (reuses existing seams).** `html_report` computes `health` alongside `parity`/`review` and returns it; `RunsService.ingest` persists it to the new nullable `Run.storyHealthJson`; `GET /runs/:id/explain` returns `storyHealth`. The web run detail renders a **Story Health** card (overall badge + per-dimension tiles with level chips + reductions) above Review Confidence; the HTML report gains a **Story Health** section (overall badge + KPI tiles + a per-dimension detail table).

**AI Impact Statement.** New AI invocations: **0**. Token increase: **0**. Runtime increase: negligible (pure arithmetic over in-memory data). Derivable deterministically from existing AI outputs: **yes** — which is exactly how it is built.

**Tests:** `run-evaluation.test.mjs` extended (deterministic six-dimension roll-up, non-applicable dimensions excluded from the mean, severity-weighted defect penalty) + `scripts/phase2-validate.mjs` (Story Health persists to `Run.storyHealthJson` and flows through `explain()` with six dimensions).

**Serves:** at-a-glance story quality + review triage — one deterministic score that reuses parity, review confidence, visual health, execution, defects, and traceability without a single extra model call.

## M5 — Recommendations ✅

Prioritized, actionable, root-cause recommendations — a **deterministic + rule-based** engine (Layers 1 & 2 of the approved strategy). **Zero AI invocations** (ADR-001): every recommendation is derived from structured outputs other steps already produced. Supersedes the earlier roadmap item ("terminal AI recommendation node") — computed inside the `html_report` seam, so the frozen 27-node workflow is untouched.

**Engine.** `computeRecommendations(input)` in [`recommendations.ts`](../../packages/shared/src/recommendations.ts) — pure, reuses `ParityCertification` + `ReviewConfidence` + `StoryHealth` + the M3.5 visual **patterns** + defects + traceability.
- **Layer 1 (deterministic):** one recommendation per concrete gap — missing AC coverage, missing visual coverage, missing automation, missing workflow stages, high-severity defects, unmet Review-Confidence signals (evidence/import/comments/traceability/figma).
- **Layer 2 (rule-based, still no AI):** thresholds + grouping that turn many findings into one root-cause fix — recurring visual patterns → "update the shared component/token" (reuses `detectVisualPatterns`), all-cases-unautomated → "establish automation", ≥2 defects sharing a component → "investigate the shared root cause".
- **Layer 3 (AI):** not built. The `Recommendation[]` shape + this pipeline are the seam a future AI recommender would append to (with its own AI Impact Statement).

**Theme-merge (no duplicates).** Recommendations are keyed by theme, so multiple corroborating signals (parity + review + health for the same issue) **merge into one** — raising confidence and accumulating provenance — instead of emitting duplicates.

**Recommendation record.** `id · title · category (12: Visual, Automation, Test Coverage, Regression, Design System, Accessibility, Performance, Maintainability, Test Data, Knowledge, Framework, Process) · severity · impact · effort · expectedBenefit · confidence · priorityScore · rootCause · actions[] · eliminatesFindings · layer · sources (citations) · derivedFrom`.

**Deterministic priority + confidence.** `priorityScore = severity × impact × (1 + eliminatesFindings) / effort` — structurally ranks **fix-one-clear-many** above one-offs. `confidence` is evidence-strength (pattern occurrences, certification-level gaps, defect severity), **not a model estimate** (principle #8).

**Persistence + surfacing (existing seams).** `html_report` computes + returns `recommendations`; persisted to nullable `Run.recommendationsJson`; `GET /runs/:id/explain` returns them and emits `recommendation` explanations (reason = root cause, evidence = derived-from signals). HTML report gains a prioritized **Recommendations** section; web run detail gains a **Recommendations** card (severity · category · priority · impact/effort/confidence · clears-N · root cause · action).

**AI Impact Statement.** New AI invocations: **0** · token increase: **0** · runtime increase: negligible (pure arithmetic) · derivable deterministically: **yes** (Layers 1 & 2 only).

**Tests:** `recommendations.test.mjs` (determinism, required fields, pattern→one root-cause rec clearing many, fix-one-clear-many outranks one-offs, parity-gap recs with AC citations, shared-component defect grouping, synchronous/no-AI) + `scripts/phase2-validate.mjs` (recs persist to `Run.recommendationsJson` and flow through `explain()` as `recommendation` artifacts).

**Serves:** actionable review triage — a prioritized, root-cause, traceable, explainable action list that eliminates multiple findings per fix, with no extra model call.

## M6 — Activity Timeline ✅

A deterministic milestone timeline of a run — **built entirely from persisted data the platform already records** (`RunStep` timing/status + `Approval` decisions + `Clarification` prompts). **Zero AI invocations** (ADR-001) — pure aggregation. Also the audit-trail building block for Story Replay.

**Engine.** `buildActivityTimeline(input)` in [`activity.ts`](../../packages/shared/src/activity.ts) — pure. Emits an ordered `ActivityEvent[]` (run_created/started/finished · node_started/finished/failed · gate_awaiting/approved/rejected · clarification_asked/answered), per-node **durations**, curated **milestones** (created → analysis → test cases → execution → report → finished), and summary counts (nodes, completed, failed, gates, total duration). Deterministic ordering: chronological by timestamp, tie-broken by ordinal then a fixed kind-priority; unresolved (null-timestamp) events sort last so an in-progress run still renders correctly. Accepts Date objects, ISO strings, or numbers (normalized internally).

**Surfacing (reuses existing seams).** `RunsService.timeline(runId)` loads the same `getRun`-shaped rows (steps + approvals + clarifications) and runs the pure builder; `GET /runs/:id/timeline`. The web run detail renders an **Activity Timeline** panel (timestamped event list with status dots + durations + summary), shown live for any run — not just completed ones. No new persisted column (derived on read).

**AI Impact Statement.** New AI invocations: **0** · token increase: **0** · runtime increase: negligible (pure aggregation on read) · derivable deterministically: **yes**.

**Tests:** `activity.test.mjs` (deterministic chronological ordering, node durations + summary counts, gate + clarification events, curated milestones, failed-step handling, in-progress run with unresolved events) + `scripts/phase2-validate.mjs` (timeline built through the real service from persisted steps).

**Serves:** auditability + progress visibility + the Story Replay foundation — a deterministic "what happened, when, and how long" with no extra model call.

## M7 — Enhanced HTML Reports ✅

Consolidates the full Phase-2 intelligence into one cohesive, navigable, self-contained report. **Zero AI invocations** (ADR-001) — pure rendering of outputs already computed. No new engine; `renderReport` reuses Story Health, Recommendations, Parity, Review Confidence, Visual Intelligence (+ M3.5 patterns), citations, and the M6 timeline.

**Executive summary band.** A top-of-report row of prominent badges — Story Health · Review Confidence · Platform Parity · Visual Health · Recommendations count — so the headline verdict is legible at a glance.

**Navigable structure.** A sticky **table of contents** links to every present section; the report is assembled from a **section registry** (`sectionDefs` → only non-empty sections render, each wrapped in an addressable `<section id>` with `scroll-margin`). Consistent anchors, print-friendly (`@media print` unpins the TOC).

**Activity Timeline embedded.** The M6 timeline is now also rendered **inside the report** (built in `html_report` via `getRunDetail` + `buildActivityTimeline`), so the HTML artifact is a complete, self-contained audit trail — event list with timestamps + per-node durations + summary. `StepDetail` was extended with timing/approval/clarification timestamps for this.

**AI Impact Statement.** New AI invocations: **0** · token increase: **0** · runtime increase: negligible (one extra `getRunDetail` read + string building) · derivable deterministically: **yes**.

**Tests:** covered by the existing worker report path + M6 `activity.test.mjs`; the report is deterministic string assembly over already-tested engine outputs. Full monorepo build (incl. worker + web) green.

**Serves:** a single, trustworthy, navigable report that unifies every intelligence engine — the reviewer's one-stop artifact.

## M8 — Knowledge Lint ✅

The final Phase-2 milestone. A **deterministic** governance check of the `knowledge_update` proposals against the documentation governance protocol (CLAUDE.md §6) — *does it already exist, does it conflict, is it placed correctly, is it well-formed* — **before** anything is persisted. **Zero AI invocations** (ADR-001): lexical comparison over text the platform already has.

**Engine.** `lintKnowledgeProposals(input)` in [`knowledge-lint.ts`](../../packages/shared/src/knowledge-lint.ts) — pure. Four check families:
- **Placement** — path must live under an allowed root (`docs/ai/`) and be `.md`; otherwise a hard error (verdict `reject`).
- **Duplicate** — Jaccard token overlap vs the existing corpus; ≥ threshold ⇒ flagged (update the existing doc rather than duplicate), with the `similarTo` doc + score.
- **Conflict** — shares the topic (overlap ≥ min) **and** uses contradiction language (`instead`, `no longer`, `replace`, `override`, `supersede`, …) ⇒ "present the conflict and confirm precedence (§6)".
- **Quality** — vague/short/generic summary, missing rationale, and in-batch duplicate proposals.

Verdict is deterministic: any error ⇒ `reject`; any warning ⇒ `review`; else `ok`. The linter **never auto-persists or auto-rejects** — it enforces "present conflicts, ask for confirmation."

**Wiring.** The worker `knowledge_update` node assembles a best-effort corpus from `docs/ai/**` (path + first heading + leading excerpt, across candidate roots) and runs the linter; results are stashed on state, logged, and rendered as a **Knowledge Lint** section in the report (per-proposal verdict + governance issues). Degrades gracefully to placement/quality/in-batch checks when the corpus can't be read.

**AI Impact Statement.** New AI invocations: **0** · token increase: **0** · runtime increase: negligible (lexical checks) · derivable deterministically: **yes**.

**Tests:** `knowledge-lint.test.mjs` (determinism, placement reject for non-`docs/ai`/non-`.md`, duplicate detection with `similarTo`, conflict-marker detection, quality vague/missing-rationale, in-batch duplicate, empty-corpus fallback, clean-proposal ok).

**Serves:** knowledge quality + governance — the documentation protocol enforced deterministically at the point of proposal, keeping `docs/ai/**` clean and conflict-free.

---

## Phase 2 — complete

All eight milestones shipped, each deterministic-first and reviewed independently: **M1** Citation & Traceability · **M2** Explainability + Review Confidence · **M3(+M3.5)** Visual Testing Intelligence + Design-System Awareness · **M4** Story Health · **M5** Recommendations · **M6** Activity Timeline · **M7** Enhanced HTML Reports · **M8** Knowledge Lint. Combined footprint on a normal story execution: **0 additional AI invocations** beyond the canonical workflow (the one visual-comparison sub-capability aside) — every intelligence engine derives deterministically from existing outputs, per [ADR-001](../../ARCHITECTURE.md#adr-001--ai-reasoning-frugality-one-reasoning-step--many-deterministic-capabilities). The frozen 27-node workflow and Platform Parity are unchanged throughout.
See [../../ARCHITECTURE.md](../../ARCHITECTURE.md) phase roadmap and the approved Phase 2 roadmap. Each milestone follows the Phase Quality Standard: full build green, existing tests stay green, new tests per capability, docs updated, parity preserved, no duplicate/temporary implementations, and — per [ADR-001](../../ARCHITECTURE.md#adr-001--ai-reasoning-frugality-one-reasoning-step--many-deterministic-capabilities) — an **AI Impact Statement** (new AI invocations · token increase · runtime increase · can it be derived deterministically instead) reviewed against the AI Reasoning Frugality rule.
