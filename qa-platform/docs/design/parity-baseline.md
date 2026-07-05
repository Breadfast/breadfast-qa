# Canonical Parity Baseline — Definition of Done

> **Status:** LOCKED (Phase 0, 2026-07-05). This is the authoritative baseline against which **every** platform feature is validated.
> **Governing principle:** *Does this improve or preserve Platform Parity with the canonical QA Companion?* If no → reconsider before implementing.

## 1. What "the canonical QA Companion" is

The single source of truth is the union of three things:

1. **The frozen QA Companion workflow** — `CLAUDE.md` (orchestration layer, STEP 0–7 + §3 web / §4 mobile lifecycle) + `docs/ai/**` (all detailed knowledge: testing process, BrowserStack process, exploratory, regression, bug reporting, release validation, business rules, automation frameworks).
2. **The lifecycle implemented in `apps/worker/src/nodes.ts`** — the concrete node behaviors, plus the graph in `packages/shared/src/domain.ts` (`LIFECYCLE_GRAPH`).
3. **This documented Definition of Done — Platform Parity** (§3 below).

The web platform is an **orchestration layer over** this workflow. It may change *how a step is triggered, displayed, resumed, configured, or stored* — it must **not** change *what the step does* without updating the workflow definition (both `nodes.ts` and this baseline) and re-verifying parity.

## 2. The canonical lifecycle (27 nodes)

Authoritative order + kind, from `LIFECYCLE_GRAPH` (`packages/shared/src/domain.ts`). Any run must execute these in this order (nodes may be conditionally skipped via directives, but never reordered or silently dropped):

| # | Node | Kind | CLAUDE.md mapping |
|---|---|---|---|
| 1 | `create_workspace` | code | STEP 0 — per-story artifact folder |
| 2 | `fetch_jira` | code | Story retrieval (real Jira REST) |
| 3 | `parse_instructions` | ai | Compile Execution Instructions → directives |
| 4 | `requirements_analysis` | ai | STEP 1 |
| 5 | `acceptance_criteria` | ai | AC analysis |
| 6 | `comments_analysis` | ai | Comments may override AC |
| 7 | `linked_stories` | ai | Related tickets / linked docs |
| 8 | `figma_analysis` | ai | STEP 2 (browser export → REST → screenshot fallbacks) |
| 9 | `detect_prerequisites` | ask | Ask ONLY for genuinely-missing, underivable prereqs |
| 10 | `clarification` | ask | STEP 3 (only if genuinely blocking) |
| 11 | `impact_analysis` | ai | STEP 4 (impacted / regression / smoke / automation) |
| 12 | `review_requirements` | gate | M1b human-review checkpoint |
| 13 | `generate_hls` | ai | STEP 5 (≤20 cap, resolution order preserved) |
| 14 | `gate_push_hls` | gate | STEP 5 write → Jira checklist (never edits AC) |
| 15 | `generate_testcases` | ai | STEP 6 (granular, per-step Expected Result) |
| 16 | `review_testcases` | gate | M1b human-review checkpoint |
| 17 | `generate_csv` | code | STEP 7 (24-col BrowserStack CSV) |
| 18 | `gate_upload_browserstack` | gate | STEP 7 write → BrowserStack |
| 19 | `exploratory_testing` | ai | §3.2 charters (+ live probing for web) |
| 20 | `review_exploratory` | gate | review checkpoint |
| 21 | `automation_generation` | ai | reuse-before-build; framework-aware |
| 22 | `review_automation` | gate | M1b human-review checkpoint |
| 23 | `execution` | code | web Playwright / mobile bs_helper; 4-combo scope |
| 24 | `html_report` | code | HTML report + README index |
| 25 | `review_report` | gate | review checkpoint before bug filing |
| 26 | `gate_file_bugs` | gate | defect reporting → Jira (sub-task + ADF) |
| 27 | `knowledge_update` | ai | knowledge-base proposals |

Gate→source map for Regenerate is defined in `GATE_SOURCE` (`domain.ts`) and is part of the baseline.

## 3. Definition of Done — Platform Parity checklist

The platform is at parity when, for a representative story, it produces outputs **identical in substance** to a hand-run of the canonical Companion. Concretely:

**Inputs & grounding**
- [ ] Reads the REAL Jira story: description, acceptance criteria (HeroCoders checklist), comments, linked issues, attachments, embedded Figma URLs — comments can override AC.
- [ ] Uses the per-story Figma file key from *that* ticket; exports frames (browser batch → REST → screenshot fallbacks) at scale=2.
- [ ] Threads tester Execution Instructions + Additional Inputs into every node; compiles them into directives (skip/only/maxHls/…).
- [ ] Loads `CLAUDE.md` + `docs/ai/**` as project instructions (engine cwd = repo root); fails loudly if the knowledge base is missing.

**Analysis & design (clarify-first)**
- [ ] Requirements, AC, comments, linked-story analyses match the canonical depth (challenge assumptions, hunt missing requirements/risks/regression).
- [ ] Impact analysis produces Impacted / Regression / Smoke / Automation.
- [ ] Clarification pauses only for genuinely-blocking scope gaps.
- [ ] HLS ≤ 20 (cap resolution: directive → Settings → env → 20), added to Jira as a **separate checklist** (never edits AC), canonical `HLS || <name>` format.
- [ ] Test cases in the canonical granular standard: one action per step, every step its own Expected Result, navigation/validation explicit.
- [ ] 24-column BrowserStack CSV in the canonical layout.

**Execution & reporting (auto-run once scope locked)**
- [ ] Web: drives the live app via Playwright; Mobile: drives BrowserStack via bs_helper; 4-combo scope (iOS+Android × en/ar) honored per story.
- [ ] Per-case status (pass/fail/blocked/skipped), ≥1 screenshot/evidence per case.
- [ ] Figma visual validation vs AC/business rules; platform differences documented.
- [ ] HTML report (release-validation §2): summary, coverage matrix, cases+results, defects, exploratory.
- [ ] Defects: one per bug, canonical title, ADF Steps/Actual/Expected (cf_10042/10043/10044), sub-task under the story, evidence attached.

**Governance & safety**
- [ ] Every external write (Jira push, BS upload, bug filing) is gated + audited; DRY-RUN default on fresh installs.
- [ ] Quality gates enforced (AC covered · HLS · cases · BS import · exploratory · regression · automation · defects · report · docs).
- [ ] Knowledge governance: conflicts surfaced, reusable knowledge proposed, story-specific state to memory.
- [ ] Per-story artifact folder with the 10 standard subfolders.

## 4. How parity is enforced going forward

- The `LIFECYCLE_GRAPH` order + kinds are frozen; a change requires updating `nodes.ts`, `domain.ts`, this baseline, and `CLAUDE.md` together, with a stated parity justification.
- **Workflow Version** (see [versioning](../../ARCHITECTURE-REVIEW.md#17-platform-versioning-decision-4)) is bumped only on an intentional, parity-preserving workflow change and recorded on every run.
- Phase E ends with a parity audit against this checklist.

## 5. Official parity validation stories

Two real stories are the **official Platform Parity validation set**. Every major phase (A–E) must be validated against BOTH before it is considered complete — the platform's outputs for these stories must match the canonical Companion's hand-run outputs to the DoD in §3.

| Story | Why it's a good parity probe |
|---|---|
| **B10-56336** | Card-service web (Edit Customer KYC fields) — exercises real Jira fetch, Figma, web execution via Playwright, card-user provisioning, defect fidelity. Has an established canonical result (20/20) to diff against. |
| **B10-55570** | Card Portal Super Card adjustment (single + bulk) — exercises supercard selection, external-write gates (HLS push, bug filing), persistence/traceability ACs, and a known defect set (B10-57172/57173). |

Per-phase rule: a phase's exit review includes a **parity diff** for both stories (dry-run where external writes are gated). A regression against either story blocks the phase.

## 6. Version compatibility

To prevent incompatible configurations, the platform records and enforces **minimum supported versions**:

- **Minimum supported Workflow Version** and **Minimum supported Knowledge Version** are declared in the platform (e.g. `packages/shared`).
- On startup / before a run, the platform compares the current `docs/ai/**` Knowledge Version and the `LIFECYCLE_GRAPH` Workflow Version against these minimums.
- If either is below the minimum (e.g. a stale knowledge base or an out-of-date workflow definition), the run is blocked with a clear message rather than producing a non-parity result. Surfaced via the Platform Parity Health diagnostic ([diagnostics](./diagnostics.md)).
- Every `Run` records the four versions used (Platform / Workflow / Knowledge / CLAUDE.md) plus the minimums in force, so any result is reproducible and its compatibility is auditable.
