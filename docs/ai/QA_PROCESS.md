# Canonical QA Process

> **Status:** Canonical QA methodology. Every implemented story follows this process.
> **Nature:** Platform-agnostic. It can be executed **manually**, via **Claude Code**, or by **any orchestration system** — it defines *what* each phase produces and *when* a phase is complete, never *which tool* runs it.
> **Relationship to other docs:** This operationalizes the QA lifecycle into **seven gated phases (Phase 0 – Phase 6)** and makes **Visual Testing** a first-class phase. It governs the per-story methodology. Detailed test-design/business rules live in the `docs/ai/**` knowledge base; tool-specific operation of the deterministic visual engine lives in the Visual Testing Operations Manual; session/browser-lifecycle requirements for Claude Code as executor live in [`execution-engine.md`](execution-engine.md).
> **Workflow architecture:** the split into **Pre-Development (shift-left)** and **Post-Development (implementation-validation)** workflows — plus **`qa-full`**, which composes both into one end-to-end run of Phases 0–6 for a story with no existing baseline — the reusable-artifact contract, and the plugin-alignment strategy are defined in [`architecture/adr-001-qa-workflow-independent-plugin-aligned.md`](architecture/adr-001-qa-workflow-independent-plugin-aligned.md) (contract: [`architecture/qa-artifact-contract.md`](architecture/qa-artifact-contract.md), schema: [`architecture/qa-state.schema.json`](architecture/qa-state.schema.json)). QA_PROCESS.md remains authoritative on *phase methodology*; the ADR governs *workflow orchestration and artifact reuse*.

---

## Principles (apply to every phase)

1. **Deterministic-first.** Prefer exact, reproducible checks over judgement. Use AI **only** where a deterministic check is impossible or genuinely ambiguous.
2. **Evidence-based.** Every result is backed by a persisted artifact (a requirement mapping, a manifest row, a structured dump, a finding). No claim without evidence.
3. **Traceable.** Every finding cites what it violates (an Acceptance Criterion, a design element, or a rule) and which screen it came from.
4. **Explainable.** Severity and root cause are derived by rule from the evidence, so the same evidence always yields the same verdict.
5. **Default scope = four combos.** Mobile stories are validated on **iOS + Android** in **English (en) + Arabic (ar)** — all four — unless a story explicitly narrows scope. Web stories are validated per supported browser/locale.
6. **Coverage gap ≠ defect.** "We could not check this screen" is reported as a *coverage gap*, never as a UI failure.
7. **A decision that reduces coverage is reviewable, never inherited** — see below.
8. **Rejecting a claim is not proving the requirement** — see Phase 5 §5.7.

---

## Coverage-changing decisions (cross-phase — the authoritative rule)

**A clarification, exploration or reconciliation does not become authoritative just because downstream
phases implemented it faithfully.** A test suite can be perfectly conformant to a wrong premise: lint
green, every check passing, every case tracing to an AC — and still blind to half the requirement.

A decision is **coverage-changing** when it does any of:

| | |
|---|---|
| removes AC coverage | narrows AC coverage to a subset of its states/inputs |
| removes a **state** from scope | removes a **route** into a state |
| removes visual validation | converts **visual → behavioural** validation |
| converts **automated → manual** | merges several requirements/clauses into one assertion |
| declares a requirement **not testable** | otherwise materially reduces or changes planned validation |

Such a decision **must be recorded as a coverage change and explicitly ratified by the operator before
the reduced coverage becomes authoritative**:

```
node qa-workflow/bin/qa-cli.js coverage-change add <storyDir> <id> \
     --source clarification --source-ref "clarification/clarifications.md#A-3" \
     --affects AC-5 --kind removes-visual-validation,visual-to-behavioural \
     --was "…" --now "…" --reason "…" --evidence "…" --scope-checked "…"
node qa-workflow/bin/qa-cli.js coverage-change approve <storyDir> <id> --by "<operator>"
```

**Mechanically enforced, so the wording cannot be routed around:**
- `approve <storyDir> testcases` **exits non-zero** while any coverage change is `proposed`.
- `complete-check` **fails** the run on any coverage change still `proposed`.
- `status` lists them and names what they block.
- **`reject`** means the coverage *stays*: the suite must cover it, and test design re-opens.

**`--scope-checked` is the field that matters most.** It records *which states, routes and variants the
evidence actually covers*. Generalising a correct measurement of **one** state into a decision about a
**whole requirement** is the specific failure this whole rule exists to prevent.

> **Motivating failure — B10-57764 (2026-08-24).** Clarification **A-3** pixel-diffed the design's
> *unchecked* disabled checkbox against the enabled one, correctly found them byte-identical, and
> concluded *"'the box is dimmed' has no visual oracle"*. The **checked** box differed plainly in the same
> two frames (`#F3F4F5`/`#D8D8D8` vs `#AA0082`/white). That inference removed **all** visual assertion
> from AC5 and replaced it with a behavioural model asserted in **one direction only**. Lint stayed green
> (four cases carried `ac:AC-5`), the nine review checks passed, 3 manual cases and 18 automated tests
> passed — and two defects (**B10-59276**, **B10-59278**) lived in the unasserted half until the operator
> found them by hand on a build already signed off PASS 6/6.

**Interaction with the clarifications materiality gate** ([contract](architecture/qa-artifact-contract.md)
§5.2): a *cosmetic* Jira change carries `clarifications` forward, but **never carries an open coverage
change forward as settled** — a `proposed` decision stays `proposed` across reconciliation, and an
`approved` one is re-opened when the AC it affects materially changes.

Where each phase's duty sits: **emit** — `grill-me` (clarification), `exploratory-testing`,
`test-design` Phase C · **challenge** — `testcase-review` check 10 · **record/gate** — `qa-cli.js`.

---

## Per-story artifact set

Each story produces this set of artifacts (folder names are conventions; the *artifacts* are what matter):

| Artifact | Produced in phase | Purpose |
|---|---|---|
| Requirements summary + AC map | 1 | what must be true, and how each AC is testable |
| Impact & constraints note | 1 | affected areas, regression risk, architecture limits |
| Exported design frames | 2 | the expected visual reference |
| Structured design extraction | 2 | expected components (bounds/styles/text) per frame |
| Screen Registry entries | 2 | stable `screenId` → design frame + expected components + validation profile |
| Exploratory analysis notes *(conditional)* | 3 | observed behaviour of the current app that grounds the cases |
| High-Level Scenarios (HLS) | 3 | risk-ranked coverage outline |
| Functional test cases (+ edge + negative) | 3 | executable, step-by-step, each with an expected result |
| Test-case review record + approval | 3 | the gate: checklist verdicts, revisions, AC coverage — only approved cases are imported |
| Test-management import record | 3 | destination, counts, verification, case-id map |
| Execution results (per combo) | 4 | pass/fail/blocked + evidence per API/Web/Mobile |
| Evidence Manifest | 5 | one row per captured screen (identity + screenshot + structured dump) |
| Structured dumps | 5 | machine-readable structure of each actual screen |
| Visual findings + visual report | 5 | deterministic findings (+ residual AI where required) |
| QA Summary | 6 | functional + visual results, coverage, risks, recommendation |

---

## Process flow

```mermaid
flowchart TD
  P1[1 · Requirements Analysis] --> P2[2 · Figma Analysis]
  P2 --> P3[3 · Test Design]
  P3 --> P4[4 · Test Execution]
  P4 --> P5[5 · Visual Testing]
  P5 --> P6[6 · QA Summary]
  P1 -. gate .-> G1{scope locked?}
  P3 -. gate .-> G3{coverage complete<br/>reviewed & approved?}
  P5 -. gate .-> G5{visual evidence produced?}
```

Phases 1–3 are **pre-development** (the shift-left workflow) and Phases 4–6 **post-development**; Phase 3's
artifacts are reconciled (§3.6) rather than regenerated on the post-development pass.

Each phase has an **exit gate**. Do not enter the next phase until the current gate passes.

---

# Phase 0 — Prerequisites

**Purpose:** establish what this run needs and does not have, and **obtain it**, before any analysis or
planning is done. Added 2026-07-26 (ported from the QA Platform's `detect_prerequisites` node) after a
story shipped a QA summary containing two avoidable "blocked" outcomes, both discoverable in the first
minutes.

**Governing rule — never block, always ask:**
> Do not report a step as blocked without having asked for the missing input first. A run may legitimately
> end "asked, awaiting X". It must never end with a flat "blocked on X" the operator was never asked about.

**Activities**
1. Enumerate the required inputs by category: **access** (URLs, credentials, API tokens), **destinations**
   (test-management project/folder, Jira parent, report paths), **targets** (app IDs, build under test,
   device/OS matrix), **test data** — including any record an AC names explicitly — **backend state**
   (migrations run, flags on, account status), **design** (file key + node ids for *this* story; is the
   linked design alive?), and **platform/locale scope**.
2. Resolve from configuration first — a credential loader or env var beats asking. Never ask for what is
   already available.
3. **Verify every access item with one real authenticated call.** A prerequisite is "have" only when a call
   succeeded, never merely because a value exists.
4. **Diagnose failures before escalating them.** A `401`/`403`/`404` is at least as likely to be a wrong
   base URL, **API version**, path or payload shape as a permissions problem. Consult the vendor's current
   API reference before declaring an access blocker.
5. **Settle platform/locale scope here**, against the real application — not from the design or a default.
   A surface that has no locale switch cannot be given a localisation sweep.
6. Ask for everything still missing **in one batch**, naming each value and where it comes from.

**Outputs:** `prerequisites.md` in the story folder — every category marked **have / ask / not-applicable**,
each "have" backed by the call that proved it.

**Exit gate**
- Every category is explicitly resolved; none silently skipped.
- Every access "have" is backed by a successful live call.
- Everything missing has been asked for in one batch.
- Scope (platforms × locales) is stated as a fact about the application under test.
- Nothing is labelled "blocked" that the operator was not asked about.

---

# Phase 1 — Requirements Analysis

**Purpose:** fully understand what the story must deliver and constrain the QA effort before any test is designed.

### Inputs
- The Jira story (description, comments, attachments, linked tickets).
- Acceptance Criteria (AC).
- The existing implementation/behavior of the affected area.
- Architecture constraints (dependencies, permissions, data prerequisites, platform limits).

### Activities
1. **Jira Story analysis** — extract the business objective, functional and non-functional requirements, dependencies, and risks. **Comments may override or invalidate the original AC — always analyze them.**
2. **Acceptance Criteria analysis** — restate each AC as an atomic, testable statement. Flag any AC that is ambiguous, untestable, or missing.
3. **Existing implementation review** — determine current behavior so "expected vs actual" is grounded, and identify regression surface.
4. **Architecture constraints** — record prerequisites (roles, seeded data, feature flags, environment), platform differences, and anything that limits how a case can be executed.
5. **Clarify** — if scope, business logic, edge cases, validations, permissions, state transitions, or test data are not fully pinned down, **stop and ask**. Do not proceed on ambiguity.

### Outputs / Artifacts
- Requirements summary (objective, functional/non-functional, dependencies, risks, missing requirements).
- **AC map:** each AC → testable statement → intended verification.
- Impact & constraints note (impacted areas, regression areas, prerequisites).

### Exit gate ✅
- [ ] Business objective and every AC are understood and testable.
- [ ] Comments reconciled against the AC.
- [ ] Constraints, prerequisites, and regression surface recorded.
- [ ] All ambiguities resolved (scope locked).

---

# Phase 2 — Figma Analysis

**Purpose:** turn the design into the **expected side** of visual validation — a stable, machine-comparable definition of each screen.

### Inputs
- The story's Figma link (file key + node ids are **per story**, taken from the design URL).
- The requirements/AC from Phase 1.

### Activities
1. **Export frames** — export each relevant design frame (one image per screen, per locale/platform variant). EN and AR are **different frames** — export both.
2. **Structured extraction** — extract each frame's structure: text content, element bounds, colors, fonts, spacing. This yields the expected component data used by the deterministic layers.
3. **Expected components** — curate the meaningful components per screen (identity, role, expected copy, required?, order, cardinality, and — where available — bounds/styles). Prefer the application's **real test-ids** as component identities so matching is exact. Extraction may *seed* this; curation makes it reliable.
4. **Validation profile** — choose/define the comparison profile for the screen: mode (design-conformance / regression / hybrid), which layers apply, and tolerances (pixel, colour, font, spacing).
5. **Register the screen** — record a stable **`screenId`** mapped to its design frame (per variant) + expected components + validation profile. `screenId` is semantic and **never changes** once used.

### Outputs / Artifacts
- Exported design frames (per variant).
- Structured design extraction (per frame).
- **Screen Registry entries** (`screenId` → frame + expected components + profile), unique and validated.

### Exit gate ✅
- [ ] Frames exported for every in-scope screen and locale.
- [ ] Expected components defined for the target screens (identities = real test-ids where possible).
- [ ] A validation profile is assigned to each screen.
- [ ] Registry entries are unique and pass validation (no duplicate ids, no dangling profile references).

> **Note:** If a screen is not registered, it still runs — but pairing falls back to a heuristic and it may become a coverage gap. Register **highest-traffic screens first**; coverage grows incrementally.

---

# Phase 3 — Test Design

**Purpose:** design coverage that is complete, risk-ranked, and executable — and **agree it before
development**, not after.

> **Phase 3 runs pre-development (clarified 2026-08-09).** Its inputs (AC map, screens, impact,
> clarifications) all exist before implementation, so the whole phase — including case generation, the
> review gate and the import into test management — belongs to the shift-left workflow. Post-development,
> Phase 3's artifacts are **reconciled against what was built** (3.6), never regenerated from scratch.

### Inputs
- The AC map + constraints (Phase 1).
- The screens + expected components (Phase 2).
- *(When it ran)* the **Exploratory Analysis** notes (3.0).

### 3.0 Exploratory Analysis (conditional, before design)
Explore the **current** application when doing so will change the cases: ambiguous requirements or design
states, undocumented existing flows, dependency/reachability questions, suspected edge cases, colliding
upcoming scope, or an impacted area nobody has looked at. It improves **observability of the upcoming
change**; it produces no verdicts and files no defects (nothing has been delivered to be wrong). Its
output feeds case generation. **Skipping is a stated decision with a reason — never a silent omission.**

### 3.0a Decompose the requirement before designing cases

Two decompositions precede case writing. Both are **judgement exercised deliberately**, and both are
bounded by the design principle at the end of this section — the goal is intentional coverage, **not**
a Cartesian product.

**(a) An AC is not one assertion just because it has one id.** An AC may carry several atomic
requirements — most commonly `if X → Y, otherwise → Z`, but also several states, conditions or
transitions under one sentence. Where an AC carries more than one, **decompose it into clause ids in the
requirements artifact** (`AC-5.1`, `AC-5.2`, …). This needs no new coverage model: `testcase-lint`
already parses decimal ids, so each clause becomes independently traceable and the existing
`uncovered-ac` error enforces that **every clause has a case**.

`testcase-lint` emits a **warning** (`ac-possible-multi-clause`) when an AC's own wording contains a
clause indicator (`otherwise`, `unless`, `except`, `but`, `however`, …) and it has not been decomposed.
That is a **signal asking for a clause-level decision — never a semantic model**: a hit does not prove
the AC is multi-clause, and the absence of one does not prove it is not. Resolve it either by
decomposing or by recording, in `coverage-notes.md`, why one id is enough.

**The AC tag remains exactly as it is.** `ac:AC-5` is still mandatory and still traced. What changes is
that **a tag is no longer read as proof that the AC is fully covered.**

**(b) Reason about coverage at four levels, not one:**

```
AC → atomic clause/requirement → relevant state → relevant route/transition → expected behaviour + visual expectation
```

**States and routes are different questions, and a route can break what a state test proves.** For
stateful UI, ask explicitly:

> *"What are the meaningful ways the system can reach this state, and can behaviour differ depending on
> how we got there?"*

Routes worth considering (story-dependent — take what applies, not the list): fresh load · apply a
filter/mode · remove it **with** the submit action · remove it **without** it · navigate away and
return · browser Back · enabled → disabled and disabled → enabled transitions · a value changed
in-session versus loaded from the server.

> **Motivating failure — B10-59278.** On the card panel the perks list re-queries only on **Search**, so
> `Category → All` **with** Search and `Category → All` **without** Search are genuinely different
> routes into the same *displayed* state. Three routes were tested; the fourth held the defect. The
> automated suite touched the Category filter in only two ways across all 18 tests — read as `"All"` on
> a fresh load, or set to a category — and **never set it back to `"All"`**, so the state was unreachable
> by construction rather than merely untested.

**Design principle — intelligent coverage, not combinatorial explosion.** Enumerate only the clauses,
states and routes the requirement actually makes meaningful; a state nothing distinguishes and a route
that cannot alter behaviour are not coverage, they are padding. If enumerating honestly produces a large
matrix, that is information about the requirement's risk — take it to the review gate, do not silently
prune it *(and if you do prune, that is a **coverage-changing decision**, see Principles)*.

### Activities
1. **High-Level Scenarios (HLS)** — enumerate the highest-risk coverage as a concise, risk-ranked outline: happy paths, negatives, edge cases, state transitions, validations, navigation, permissions, localization, error handling, and regression risks. Consolidate — do not pad.
2. **Functional test cases** — expand HLS into granular, step-by-step cases. **Every step has its own expected result.** Never combine actions; navigation/validation/verification are explicit steps. Cover the ACs, functional requirements, validation rules, error states, empty states, in-scope localization, permissions/state transitions, the **regression coverage identified in Phase 1's impact note**, and whatever the exploratory analysis surfaced.
3. **Edge cases** — boundary values, empty/maximum states, slow/interrupted flows, locale-specific rendering (RTL), and derived-field logic.
4. **Negative cases** — invalid input, unauthorized access, missing prerequisites, failure/error states, and cancellation paths.
5. **Map cases to screens** — tag each case with the `screenId`(s) it exercises, so visual validation and functional execution share identity. Classify each case **automatable / not-automatable**.
6. **Review the cases (mandatory gate)** — before anything is committed to test management, verify: no
   duplicates · no unrelated cases · no missing AC coverage **(at clause level, per 3.0a)** · correct
   expected results · correct granularity · correct categorization · correct automatable classification ·
   justified regression coverage · format conformance · **upstream coverage changes challenged and
   ratified**. **Revise and re-review until every check passes, then obtain explicit approval.** Only
   approved cases are imported. The tenth check exists because *"do the cases implement the
   clarification?"* is not a sufficient question — see Principles, *Coverage-changing decisions*.
7. **Import the approved cases** into test management and verify the import.

### 3.6 Reconciliation (post-development)
When execution, exploratory testing or the delivered implementation shows the approved suite must change,
**reconcile** it: add missing cases, update existing ones, remove obsolete ones, split/merge, mark
obsolete, adjust expected results, add newly-discovered regression cases. Every delta carries an
**authority** (an AC, a design element, or a recorded clarification) and evidence, is **logged**, and goes
back through the review + approval gate before the test-management system is synced. *"The application
does X"* is not an authority — that is a defect candidate (Phase 4's defect-grounding rule).

### Outputs / Artifacts
- *(Conditional)* Exploratory analysis notes.
- HLS (risk-ranked).
- Functional test cases (granular, expected-result-per-step).
- Edge-case and negative-case sets.
- Case → `screenId` mapping; automatable/manual classification.
- **Test-case review record** (checklist verdicts, revisions, AC-coverage table) + the approval.
- Test-management import record.
- *(Post-development)* the reconciliation log.

### Exit gate ✅
- [ ] Every AC — **and every atomic clause of a multi-clause AC (3.0a)** — is covered by at least one case.
- [ ] The meaningful **states and routes** for each requirement are covered, or their omission is a recorded coverage change.
- [ ] **No coverage-changing decision is left unratified** (`qa-cli.js coverage-change list`).
- [ ] Happy, edge, and negative paths are represented.
- [ ] Each case is executable and has expected results per step.
- [ ] Cases are mapped to `screenId`s and classified automatable/manual.
- [ ] **The review checklist passes on every item, and the cases are explicitly approved.**
- [ ] **Only approved cases are imported, and the import is verified.**
- [ ] *(Post-development)* every suite change is justified, logged, re-approved, and synced.

---

# Phase 4 — Test Execution

**Purpose:** execute the designed cases against the live system and capture evidence, across every applicable interface and combo.

### Scope
Execute across the applicable surfaces:
- **API** — service/contract behavior behind the UI.
- **Web** — the web application (per supported browser/locale).
- **Mobile** — iOS and Android, EN and AR (the four-combo default).

> **Manual execution comes FIRST — before any automation is written (operator instruction 2026-08-20, standing).**
> Once the test cases are **approved** (Phase 3 §6), the approved suite is executed **by hand** and each case
> gets a recorded verdict. Only then is automation generated, and it encodes behaviour that is already
> understood. The reasons: a story must be *proven to work* before effort is spent encoding it; an automated
> test written against unverified behaviour tends to enshrine whatever the app currently does; and a manual
> pass surfaces the interaction traps (auto-dismissing toasts, shifting column indices, filter state that
> survives navigation) that otherwise appear as automation flakiness.
>
> **This does not reorder the recorded artifacts.** `automation` is still recorded before `execution` —
> `PHASE_DEPS = { execution: 'automation' }` in `qa-cli.js` is a real gate and is **not** bypassed. The
> manual pass is written to `execution-reports/manual-execution.md` as it happens, automation follows, and
> the automated results are then appended before `execution` is recorded. That gate exists because on
> **B10-56717** the phases were reordered and automation fell off the end of the run entirely; manual-first
> satisfies the QA requirement without reopening that hole.

### Activities
0. **Manual execution of the approved suite** — work every approved case step by step by hand, recording
   **pass / fail / blocked / skipped** per case with evidence, *before* automation exists. Cases the operator
   excluded from automation are executed here too — *excluded from automation is not excluded from testing*.
1. **Prepare state** — provision prerequisites (roles, data, flags) from Phase 1; execute only against the intended environment.
2. **API execution** — verify status codes, payloads, contracts, and side effects for the flows under test.
3. **Web execution** — drive each case step-by-step; compare live result to the expected result; **capture a screenshot per screen state**.
4. **Mobile execution** — run each case on iOS and Android for each locale; capture a screenshot per screen state.
5. **Record outcomes** — mark each case **pass / fail / blocked / skipped** with the precise reason, and attach evidence (screenshots, and a short recording for multi-step/state defects).
6. **Defect grounding** — a finding becomes a **defect** only if it violates a specific AC, design element, or rule; is not test data; and reproduces. Otherwise record it as an observation.

### Outputs / Artifacts
- Execution results per combo (pass/fail/blocked/skipped + reasons).
- Screenshots per screen state (named so each maps to its `screenId`).
- Candidate defects (grounded, reproducible).

### Exit gate ✅
- [ ] **The approved suite was executed MANUALLY first, with a per-case verdict recorded, before automation was written.**
- [ ] Every case executed on every applicable combo (or explicitly marked blocked with reason).
- [ ] A screenshot captured per screen state.
- [ ] Outcomes and grounded defects recorded.

---

# Phase 5 — Visual Testing

**Purpose:** validate that each actual screen matches its expected design — **deterministically first, AI only on the residual** — and produce a visual report.

> **Executor paths:** the platform pyramid engine (legacy) is operated per [`visual-testing/OPERATIONS_MANUAL.md`](visual-testing/OPERATIONS_MANUAL.md). When **Claude Code** performs this phase directly (the primary path), follow the operator playbook [`visual-testing/CLAUDE_CODE_OPERATOR.md`](visual-testing/CLAUDE_CODE_OPERATOR.md) — it operationalizes this phase (dynamic-vs-defect exclusion rules, finding schema, annotated evidence, Design-Bug output). This methodology stays authoritative on any conflict.

### Inputs
- Screenshots captured during Test Execution (Phase 4).
- Exported design frames + Screen Registry entries (expected components + validation profile) from Phase 2.

### 5.1 Generate the Evidence Manifest
Produce one manifest **row per captured screen**, carrying:
`screenId` · platform · locale · screenshot path · (optional) test-case id · (optional) structured-dump path.
The manifest is the **producer-agnostic contract**: it does not care whether capture came from web, mobile, or any framework. It is what links the actual evidence to its screen identity.

### 5.2 Generate Structured Dumps
For each screen, capture a **structured dump** of the *actual* rendered UI:
- **Web** — the accessibility/DOM structure (roles, names, hierarchy, and where available bounds/styles).
- **Mobile** — the platform UI hierarchy / page source (ids, labels, text, bounds).
- **Unstructured surfaces** (canvas/image/native-drawn) — fall back to OCR only where no structured data exists.
Reference each dump from its manifest row. **A screen with no structured dump becomes a residual** (deterministic layers cannot evaluate it).

### 5.3 Run the Validation Pyramid
For each screen, pair the expected design frame with the actual screenshot (**by `screenId`** — deterministic; heuristic only when unregistered; abstain to a coverage gap when no confident pair exists). Then run the deterministic layers:

| Layer | Checks | Typical severity |
|---|---|---|
| **L1 Identity** | correct frame ↔ screenshot pairing | coverage-gap if unpaired |
| **L2 Component Tree** | required components present, once, in the right order/nesting | missing/duplicate = major; order/hierarchy = minor |
| **L3 Visibility** | required components actually visible (non-zero) | major |
| **L4 Layout** | position/size within tolerance | by magnitude (major/minor) |
| **L5 Text / Copy** | visible copy exactly matches expected | major |
| **L6 Styles / Tokens** | colour/font/size within tolerance | by magnitude (major/minor) |
| **L7 Pixel** | advisory whole-image difference (only when sizes match) | info (advisory) |

Layers run cheapest/most-structural first; a component flagged missing at L2 is not re-flagged downstream.

> **L5 copy severity sub-class:** a **pure casing / whitespace / punctuation-spacing** difference (e.g. `Card Perks` vs `Card perks`, `ID*` vs `ID *`, `Insert Arabic Text Here` vs `Insert Arabic text here`) is **minor**. A difference that changes a **word, meaning, number, or localized string** is **major**. Missing/empty required copy remains **major**.

### 5.4 Run Residual AI (only when required)
Invoke AI **only** for screens the deterministic layers could not fully evaluate — no structured dump, no expected data, or an unstructured surface — plus an optional small audit sample of clean screens. A fully-evaluated screen consumes **zero** AI. AI findings are labelled as AI-sourced.

### 5.5 Produce deterministic findings
Each finding records: layer, category/dimension, **severity** (critical/major/minor/info — derived by rule), the affected component **and, when identifiable, the design token that is the root cause** (a color/typography/spacing/etc. token — not just the component it surfaced on), **expected vs actual**, a self-explaining difference description, a root-cause-level recommendation, and its sources (AC / design frame). Recurring findings that share a root cause (component or token) are grouped so reviewers fix the shared component/token once.

### 5.6 Produce the visual report
Assemble a visual report: per-screen verdict (pass / minor / major / no-frame / coverage-gap), findings by severity and category, recurring-pattern summary, coverage gaps (listed separately, non-penalizing), and an expected-vs-actual view per screen.

### 5.7 Rejecting a finding does not close the requirement

**Disproving a specific *claim* proves nothing about the underlying visual *requirement*.** A finding is
an observation plus a claim about it; the claim can be wrong for reasons that leave the requirement
entirely unexamined — a wrong colour measurement, a stale or below-the-fold capture, the wrong fixture,
the wrong route into the state, a browser-context artifact, or simply insufficient evidence.

So a rejection is **never** recorded as *"the requirement is satisfied"*. It records six things — **what
was disproved · what remains unresolved · why it was rejected · the evidence used · who owns the surviving
question · whether further validation is required.** The field labels and their exact contents are defined
once, in [`visual-testing/CLAUDE_CODE_OPERATOR.md`](visual-testing/CLAUDE_CODE_OPERATOR.md) §7.3; this
section owns the **rule**, that section owns the **shape**.

If the surviving question is *"is this requirement actually met?"*, the requirement stays **open**, not
passed. If it is closed instead, that is a **coverage-changing decision** (Principles) and needs
ratification like any other.

> **Motivating failure — B10-57764 V-01.** The finding claimed the disabled checkbox rendered `#AA0082`
> magenta. That claim was false — the build paints `#B0B0B0` — and it was rejected on gate checks 3/4
> with a mechanism that was also unsound. But its **substance** — *this is not the dimmed state the
> design specifies* — was never re-tested against the design, and the rejection was read by every later
> phase as *settled*. It was true, and became **B10-59276**.


### Outputs / Artifacts
- Evidence Manifest · Structured dumps · Visual findings · Visual report · **rejection records (§5.7)**.

### Exit gate ✅
- [ ] A manifest row exists for every captured screen (with identity).
- [ ] Structured dumps captured where the surface supports them.
- [ ] Validation Pyramid run for every in-scope screen.
- [ ] Residual AI invoked only where deterministic evaluation was impossible.
- [ ] Deterministic findings + visual report produced; coverage gaps listed.

---

# Phase 6 — QA Summary

**Purpose:** a single, decision-ready summary of the story's quality.

### Inputs
- Execution results (Phase 4) + visual findings/report (Phase 5) + coverage mapping (Phases 2–3).

### Contents
1. **Functional Results** — cases run vs passed/failed/blocked per combo (API/Web/Mobile), and grounded defects with severity.
2. **Visual Results** — per-screen verdicts, findings by severity/category, recurring patterns, and coverage gaps.
3. **Coverage** — AC coverage (every AC → case(s) → result), screen coverage (registered vs residual vs coverage-gap), and combo coverage (which of the four combos were validated).
4. **Risks** — untested/blocked areas, regression exposure, environment or data limitations, and any coverage gaps that matter.
5. **Story Health & Review Confidence** — a deterministic, evidence-derived quality rollup (e.g. requirements/coverage/execution/visual/defects/traceability dimensions) plus a confidence signal for how well-evidenced the verdict itself is — the same evidence always yields the same score.
6. **Recommendation** — a clear, root-cause-level verdict: **Pass / Pass-with-risks / Fail**, with the specific blockers and the fastest path to green.

### Outputs / Artifacts
- The QA Summary (the story's canonical QA record).

### Exit gate ✅
- [ ] Functional + visual results consolidated.
- [ ] Coverage quantified (AC, screen, combo).
- [ ] Risks stated.
- [ ] Story Health / Review Confidence rolled up.
- [ ] A single, justified recommendation given.

---

## Execution modes (same process, any operator)

This process is **operator-agnostic**. The phases, artifacts, and gates are identical whether run by:

| Mode | How the phases are carried out |
|---|---|
| **Manual** | A QA engineer performs each phase by hand, producing the artifacts and checking the gates. |
| **Claude Code** | An AI operator drives the phases, emitting the same artifacts; deterministic phases are reproducible, AI is confined to residual visual judgement and clarification. |
| **Any orchestration system** | A future system automates the phases; because artifacts (manifest, dumps, findings) are producer-agnostic contracts, any producer can satisfy them. |

The **artifacts are the interface** between phases — not any specific tool. A phase is complete when its artifacts exist and its gate passes, regardless of who produced them.

---

## Definition of Done (whole story)

- [ ] Requirements understood; scope locked (Phase 1 gate).
- [ ] Screens registered with expected components + profile (Phase 2 gate).
- [ ] Coverage designed: HLS + cases + edge + negative, mapped to screens — **reviewed, approved, imported** (Phase 3 gate).
- [ ] Executed across all applicable combos with evidence (Phase 4 gate).
- [ ] Visual validation run deterministic-first with a report; residual AI only where required (Phase 5 gate).
- [ ] QA Summary produced — Story Health/Review Confidence rolled up, with a clear recommendation (Phase 6 gate).

---

*Canonical QA process. Test-design depth and business rules: `docs/ai/**`. Deterministic visual-engine operation (registry authoring, structured extraction, shadow/cutover): the Visual Testing docs under `docs/ai/visual-testing/` and `docs/ai/screens/`.*
