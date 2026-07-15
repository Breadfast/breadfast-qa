# Platform Production Readiness & Platform Parity Certification

> The certification kit for deciding whether the Breadfast QA Platform can **replace the manual AI QA Companion** in day-to-day QA work. Outcome: a **Pilot Readiness Recommendation** (Ready / Ready-with-conditions / Not-ready). Opened 2026-07-15. Roadmap paused (Phase 3/4 deferred) pending this certification.

## Objective
Prove — with evidence from real story executions — that the platform delivers the full canonical QA lifecycle at parity with the manual companion, and is stable, reliable, performant, and usable enough for a QA-team pilot.

## Workstreams
| # | Workstream | Owner | Artifact |
|---|-----------|-------|----------|
| A | Production Readiness Audit (static) | Claude | [production-readiness-audit.md](./production-readiness-audit.md) |
| B | Platform Parity Certification (rubric + scoring) | Claude builds · joint scoring | [platform-parity-matrix.md](./platform-parity-matrix.md) |
| C | Real Story Execution Campaign | **QA team runs** · Claude scores | [story-evaluation-template.md](./story-evaluation-template.md) (one per story) |
| D | Certification Report + recommendation | Claude | [certification-report.md](./certification-report.md) |

**Division of labor (agreed):** the QA team executes real stories on the running platform with live integrations; Claude prepares the framework, performs the static audit, and scores/analyzes/reports.

## Methodology
1. **Static audit (A)** — score the platform against a production-readiness rubric from the codebase (done up front).
2. **Story campaign (C)** — execute a representative corpus end-to-end; capture evidence; fill one evaluation scorecard per story.
3. **Parity scoring (B)** — score each of the 27 nodes' actual output against the canonical expectation ([parity-baseline.md](../design/parity-baseline.md)), per platform×locale combo.
4. **Synthesis (D)** — roll everything into the certification report + recommendation.

## Certification corpus (CONFIRMED 2026-07-15)
Cover the parity-critical surface with a small, representative set. Baseline probes are already defined in [parity-baseline.md](../design/parity-baseline.md) §5:
- **B10-56336** — card-service **web** (Edit Customer KYC): real Jira + Figma + Playwright execution + defect fidelity; has a canonical 20/20 result to diff against.
- **B10-55570** — Card Portal Super Card adjustment: external-write gates (HLS push, bug filing) + persistence/traceability ACs + a known defect set.
- **+1 mobile story** (iOS + Android, EN + AR) — to exercise the 4-combo mobile path (BrowserStack, OTP, keypads).
- *(optional +1–2)* a story with **known defects** and a **clean** story, to test both defect fidelity and false-positive discipline.

Target: **≥ 3 stories**, spanning **web + mobile** and **EN + AR**, including at least one with known defects.

## Go / No-Go bar (CONFIRMED 2026-07-15)
A recommendation of **Ready for pilot** requires ALL of:
- **Parity:** every **mandatory** node ≥ "meets" on every attempted story; overall Parity Certification ≥ **90** (`certified`) on the web baseline probe; no canonical AC missed.
- **Completeness:** ≥ 3 stories completed end-to-end (create → report), covering web + mobile + EN + AR.
- **Defects:** **0 Critical / 0 High** open platform defects in the core lifecycle; defect *fidelity* validated (real defects found, no fabricated ones).
- **Reliability:** resume, cancel, gate-approval, and credential-pause flows each proven at least once; no data loss.
- **Integrations:** Jira fetch + HLS push, BrowserStack import, Figma export, Claude CLI, (mobile) BrowserStack execution — each verified.
- **UX:** a tester can drive a full story via the wizard + run detail without reading code; blocking UX issues = none.
- **Performance:** end-to-end within an acceptable envelope (recorded, not a hard threshold for the pilot).

**Ready-with-conditions** = bar met except for enumerated non-blocking items with owners/dates. **Not-ready** = any mandatory-node parity miss, Critical/High defect, or data-loss/reliability failure.

## Status
| Workstream | State |
|---|---|
| A — Readiness Audit | ✅ complete (this kit) |
| B — Parity matrix | ✅ rubric ready · scoring pending live runs |
| C — Story campaign | ⏳ awaiting QA-team executions |
| D — Certification report | ⏳ skeleton ready · fills after C |
