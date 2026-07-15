# Workstream C — Per-Story Evaluation Scorecard (template)

> Copy this file to `story-eval-<JIRA_KEY>.md` for each story in the campaign. The QA team runs the story on the platform; fill the observations; Claude scores parity (Workstream B) and synthesizes.

## Story
- **Jira key:** ______  · **Title:** ______
- **Platform:** web / mobile / cross-platform  · **Locales:** en-US / ar-EG
- **Run id:** ______ · **Date:** ______ · **Operator:** ______
- **Why chosen (parity probe):** ______

## 1. End-to-end completion
- Reached: create_workspace → … → knowledge_update? **Yes / No** (stopped at ______, why ______)
- Nodes skipped (and why): ______
- External writes performed: HLS→Jira ☐ · CSV→BrowserStack ☐ · Bugs→Jira ☐

## 2. Output quality vs manual companion (per key node)
| Node | Meets/Partial/Miss | Notes (what differed from a senior QA's manual output) |
|------|:---:|---|
| requirements_analysis | | |
| acceptance_criteria + comments | | |
| figma_analysis | | |
| impact_analysis | | |
| generate_hls | | |
| generate_testcases | | |
| execution (per combo) | | |
| defects (fidelity) | | |
| html_report | | |
*(Full 27-node scoring goes in [platform-parity-matrix.md](./platform-parity-matrix.md).)*

## 3. Platform-2 intelligence spot-check
- Story Health score + does it reflect reality? ______
- Review Confidence + reductions accurate? ______
- Recommendations actionable / root-cause / no noise? ______
- Visual findings correct (component/token, patterns)? ______
- Citations resolve + explain panel accurate? ______
- Activity timeline complete + correct durations? ______
- Knowledge Lint verdicts sensible? ______

## 4. Reliability
- Resume after pause/gate worked? ______
- Cancel/stop worked cleanly (no corruption)? ______
- Credential pause → submit → resume worked? ______
- Any crash / stuck run / data loss? ______

## 5. Integrations
- Jira fetch correct (AC + comments)? ______
- Figma export (both locales)? ______
- BrowserStack import verified (count, no nested folder)? ______
- Mobile execution on BrowserStack (OTP, keypads)? ______
- Claude CLI stable across nodes? ______

## 6. UX
- Could a tester drive it via wizard + run detail without reading code? ______
- Confusing / blocking UX moments: ______
- Gate/clarification/credential prompts clear? ______

## 7. Performance
- Wall-clock end-to-end: ______ · Slowest node(s): ______ (from Activity Timeline)
- Token/cost (from LLM Request Log), if reviewed: ______

## 8. Defects found in the PLATFORM (not the story)
| # | Severity | Node/area | Description | Repro |
|---|:--------:|-----------|-------------|-------|
| | | | | |

## 9. Story verdict
**MEETS / PARTIAL / MISS** — rationale: ______
