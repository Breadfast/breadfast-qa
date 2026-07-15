# Story Evaluation — B10-56336 (web)

> Certification corpus story #1. Fill during/after the run; Claude scores parity. Full section structure: [story-evaluation-template.md](./story-evaluation-template.md).

## Story
- **Jira key:** B10-56336 · **Title:** Edit Customer KYC fields (card-service web)
- **Platform:** web · **Locales:** en-US, ar-EG
- **Run id:** ______ · **Date:** ______ · **Operator:** ______
- **Why chosen:** canonical parity probe with an **established 20/20 manual result** to diff against; exercises real Jira fetch, Figma, web execution via Playwright, card-user provisioning, and defect fidelity.

## Parity focus (story-specific)
- **Diff against the canonical 20/20** — do the generated test cases + defects match the known-good manual result? List any divergence.
- KYC field-edit validation coverage (positive + negative + edge).
- en-US vs ar-EG (RTL, copy, truncation) in Figma + execution.

## 1. End-to-end completion → 9. Story verdict
*(fill per [story-evaluation-template.md](./story-evaluation-template.md) §1–§9; score all 27 nodes in [platform-parity-matrix.md](./platform-parity-matrix.md))*

- Reached create→report? ______
- **Canonical 20/20 diff:** ______ (matches / divergences: ______)
- Defect fidelity (real found / 0 fabricated): ______
- Reliability flow exercised here: ______
- Wall-clock / slowest nodes: ______
- Platform defects found: ______
- **Story verdict:** MEETS / PARTIAL / MISS — ______
