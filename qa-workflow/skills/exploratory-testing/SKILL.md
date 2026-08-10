---
name: exploratory-testing
description: Exploratory work in both directions — pre-development ANALYSIS of existing behaviour to ground test design (conditional, qa-shift-left), and post-development charter-based TESTING of the delivered build (qa-implementation-validation). Inline (drives the app).
metadata:
  type: task
  version: 2.0
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

### Steps
1. Derive charters from the open questions above — one charter per question, each with what it would
   change about the test cases if answered.
2. Explore the **current** build. Capture what is *there*: real flows, states, guards, copy, test-ids,
   data prerequisites, timing, platform differences.
3. Write `evidence/exploratory-notes.md`: per charter — question, what was observed, evidence
   (screenshot/dump), and **the test-design implication** (cases to add, an expectation to correct, a
   scope assumption to drop).
4. Feed it into `test-design` Phase B. An observation with no test-design implication is a note, not a
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
     --path evidence/exploratory-notes.md --generator exploratory-testing@2.0 \
     --derive-artifacts requirements,figma-analysis,impact
```
Returns `{ artifactPath, mode, charters, findings, testDesignImplications }` (compact).
