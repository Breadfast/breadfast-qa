---
name: exploratory-testing
description: Exploratory work in both directions — pre-development ANALYSIS of existing behaviour to ground test design (conditional, qa-shift-left), and post-development charter-based TESTING of the delivered build (qa-implementation-validation). Inline (drives the app).
metadata:
  type: task
  version: 2.1
  phase: Exploratory Analysis (shift-left) / Exploratory Testing (validation)
  workflow: [qa-shift-left, qa-implementation-validation]
  runsAs: inline
  consumes:
    sources: []
    artifacts: [requirements, figma-analysis, impact]
    domains: []
  produces:
    artifacts: [exploratory-notes]
  methodology: docs/ai/exploratory-testing.md
---

# exploratory-testing (task skill)

> Thin wrapper. The **how** is in [`docs/ai/exploratory-testing.md`](../../../docs/ai/exploratory-testing.md)
> (charters, failure-pattern heuristics, fragile flows, timing). Do not re-inline methodology.

Two modes, one skill. The technique is identical; the **object** differs: pre-development you explore the
**current** application to understand what the change lands on; post-development you explore the
**delivered** change itself.

---

## Mode A — Exploratory Analysis (in `qa-shift-left`) — **conditional**

**Purpose:** improve observability and understanding of the *upcoming* change so the generated cases are
grounded in how the application actually behaves. It is **not** an execution pass and produces no verdicts.

### Run it when it will change the test cases
Trigger on any of:
- story behaviour is clear on paper but its **interaction with existing behaviour** is not;
- **requirements ambiguity** survived clarification, or the answer is observable in the app;
- **Figma states are ambiguous** — which state is default, what an empty/error frame corresponds to;
- the story touches **existing flows** whose real steps, guards or entry points are undocumented;
- **dependencies** (other services, feature flags, seeded data) determine what is reachable;
- **edge cases** are suspected but unconfirmed;
- **upcoming scope** in the same area could collide;
- the **impact analysis flagged an area** whose current behaviour nobody has looked at.

### Skip it — and say so — when
the change is isolated and well-specified, the area was explored on a recent story, or nothing is
deployed to explore. Record the decision + reason in `prerequisites.md`; **skipping is a stated choice,
never a silent omission.** `exploratory-notes` is a conditional artifact: absent, it is not reconciled;
present, it is (see `dag.js` `BASELINE_OPTIONAL`).

### Also charter the ASSUMPTIONS, not only the unknowns

Mode A's job is not only to understand the story — it is the **one phase positioned to falsify an
assumption before it becomes coverage**. Charter these explicitly whenever they are in play:

- **state differences and state transitions** — does behaviour actually differ per state?
- **conditional UI** — what makes a control appear, enable, dim, or disappear?
- **route-dependent behaviour** — can the same displayed state be reached in more than one way, and do
  those ways differ? (fresh load · apply · un-apply **with** the submit action · un-apply **without** it ·
  navigate away and back · Back button)
- **visual differences between states** — measure them, do not assume them
- **Figma states that look identical in one configuration but differ in another**
- **any requirement declared "not visually testable"**, or **converted from visual to behavioural
  validation** — re-derive that conclusion against the real state matrix

**For a visual requirement, inspect the relevant state combinations before concluding no visual oracle
exists.** Build the matrix (e.g. checked/unchecked × enabled/disabled) and read **every cell**. Never
generalise a finding from one state to the whole requirement — that generalisation is precisely what
[`QA_PROCESS.md`](../../../docs/ai/QA_PROCESS.md) *Coverage-changing decisions* exists to catch, and if
you do conclude a reduction, record it there rather than asserting it in a note.

### Steps
1. Derive charters from the open questions above — one charter per question, each with what it would
   change about the test cases if answered.
2. Explore the **current** build. Capture what is *there*: real flows, states, guards, copy, test-ids,
   data prerequisites, timing, platform differences.
3. Write `evidence/exploratory-notes.md`: per charter — question, what was observed, evidence
   (screenshot/dump), and **the test-design implication** (cases to add, an expectation to correct, a
   scope assumption to drop).
4. Feed it into `test-design` Phase B. **An observation that *narrows* the plan — "this state does not
   differ", "this is not testable", "one case covers both" — is a coverage-changing decision: record it
   with `qa-cli.js coverage-change add … --source exploratory`, naming in `--scope-checked` the states
   and routes you actually inspected.** An observation with no test-design implication is a note, not a
   finding — and **an observation is never a defect here**: nothing has been delivered to be wrong.
   Anything that looks like a pre-existing bug goes to the operator as an observation, not to Jira.

---

## Mode B — Exploratory Testing (in `qa-implementation-validation`)

**Purpose:** surface risks in the **delivered** build that scripted cases would miss.

### Steps
1. Derive charters from impact/regression areas, figma gaps, and the shift-left charters that stayed open.
2. Explore; log observations, anomalies, and candidate defects with repro notes.
3. Append to `evidence/exploratory-notes.md` under a dated **Post-Development** section — never overwrite
   the shift-left analysis; the two are read together.
4. Route findings: coverage change → `test-design` **Phase C** (reconciliation) · grounded defect →
   `defect-reporting` (via the Defect Grounding Gate, `docs/ai/bug-reporting.md` §1.1).

## Recording (both modes)
```
node qa-workflow/bin/qa-cli.js record "<storyDir>" exploratory-notes \
     --path evidence/exploratory-notes.md --generator exploratory-testing@2.1 \
     --derive-artifacts requirements,figma-analysis,impact
```
Returns `{ artifactPath, mode, charters, findings, testDesignImplications }` (compact).
