# Story Evaluation — B10-55570 (web)

> Certification corpus story #2. Fill during/after the run; Claude scores parity. Full section structure: [story-evaluation-template.md](./story-evaluation-template.md).

## Story
- **Jira key:** B10-55570 · **Title:** Card Portal Super Card adjustment (single + bulk)
- **Platform:** web · **Locales:** en-US, ar-EG
- **Run id:** ______ · **Date:** ______ · **Operator:** ______
- **Why chosen:** exercises supercard selection, **external-write gates** (HLS push, bug filing), persistence/traceability ACs, and a **known defect set** (B10-57172 / B10-57173) to test defect fidelity.

## Parity focus (story-specific)
- **External-write gates**: HLS → Jira checklist posted correctly (no AC edit); bugs → Jira sub-tasks with correct severity/ADF.
- Single vs **bulk** supercard adjustment coverage.
- **Known defects B10-57172 / B10-57173** — does the platform surface them (fidelity), without fabricating extras?
- Persistence / traceability ACs mapped to test cases (citations).

## 1. End-to-end completion → 9. Story verdict
*(fill per [story-evaluation-template.md](./story-evaluation-template.md) §1–§9; score all 27 nodes in [platform-parity-matrix.md](./platform-parity-matrix.md))*

- Reached create→report? ______
- HLS push + bug filing gates verified? ______
- **Known defects surfaced (B10-57172/57173)?** ______ · fabricated extras? ______
- Reliability flow exercised here (suggest: gate rejection→regenerate): ______
- Wall-clock / slowest nodes: ______
- Platform defects found: ______
- **Story verdict:** MEETS / PARTIAL / MISS — ______
