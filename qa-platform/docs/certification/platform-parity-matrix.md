# Workstream B — Platform Parity Matrix

> Per-node scoring rubric for certifying that the platform's output matches the canonical AI QA Companion. Extends (does not duplicate) the Definition of Done in [../design/parity-baseline.md](../design/parity-baseline.md). Score once per story, per node; note platform×locale combo where the node is combo-specific (execution, visual, figma).

## Scoring scale (per node)
- **MEETS (2)** — output matches the canonical expectation in substance + format; no reviewer rework needed.
- **PARTIAL (1)** — correct direction but missing detail, format drift, or minor rework needed.
- **MISS (0)** — wrong, absent when required, or would mislead.
- **N/A** — legitimately not applicable (phase disabled, gate auto-passed, no Figma, etc.).

**Node parity score** = Σ MEETS·2 + PARTIAL·1 over applicable mandatory nodes ÷ (2 × applicable mandatory). A node is **Mandatory (M)** for parity unless marked Conditional (C).

## Per-node rubric (score per story)

| # | Node | Kind | M/C | Canonical expectation (what "meets" looks like) | Score | Evidence / notes |
|---|------|------|:---:|-------------------------------------------------|:-----:|------------------|
| 1 | create_workspace | code | M | Per-story folder at repo root with standard subfolders | | |
| 2 | fetch_jira | code | M | Real Jira story + AC + comments fetched | | |
| 3 | parse_instructions | ai | C | Execution instructions compiled to directives (if provided) | | |
| 4 | requirements_analysis | ai | M | STEP 1: objective, functional/non-functional, deps, risks, missing, testability, comment overrides; citations | | |
| 5 | acceptance_criteria | ai | M | AC extracted + testability flags + gaps | | |
| 6 | comments_analysis | ai | M | Comment overrides/clarifications/new requirements captured | | |
| 7 | linked_stories | ai | C | Related tickets/docs identified | | |
| 8 | figma_analysis | ai | C | STEP 2: frames exported + screens/states/validations/gaps/localization | | per combo (EN/AR) |
| 9 | detect_prerequisites | ask | C | Asks ONLY for genuinely-missing, underivable prereqs | | |
| 10 | clarification | ask | C | STEP 3: asks only if genuinely blocking | | |
| 11 | impact_analysis | ai | M | STEP 4: impacted / regression / smoke / automation areas | | |
| 12 | review_requirements | gate | C | M1b human checkpoint (or auto-pass if disabled) | | |
| 13 | generate_hls | ai | M | STEP 5: ≤20, happy/negative/edge/localization; cap resolution correct | | |
| 14 | gate_push_hls | gate | M | HLS pushed to Jira as a **checklist** (never edits AC) | | external write |
| 15 | generate_testcases | ai | M | STEP 6: granular, one action/step, per-step Expected Result | | |
| 16 | review_testcases | gate | C | M1b checkpoint | | |
| 17 | generate_csv | code | M | 24-col BrowserStack CSV, steps render granularly | | |
| 18 | gate_upload_browserstack | gate | M | Import verified: folder count matches, no nested folder | | external write |
| 19 | exploratory_testing | ai | C | Charters (+ live probing for web) | | |
| 20 | review_exploratory | gate | C | checkpoint | | |
| 21 | automation_generation | ai | C | Reuse-before-build; framework-aware specs; story traceable | | |
| 22 | review_automation | gate | C | M1b checkpoint | | |
| 23 | execution | code | M | Real execution (web Playwright / mobile bs_helper); 4-combo scope | | **per combo** |
| 24 | html_report | code | M | HTML report + README index; Phase-2 intelligence sections present | | |
| 25 | review_report | gate | C | checkpoint before bug filing | | |
| 26 | gate_file_bugs | gate | M | Defects → Jira sub-task + ADF, correct severity/priority | | external write |
| 27 | knowledge_update | ai | C | Reusable-knowledge proposals; Knowledge Lint clean | | |

## Combo coverage (score execution/figma/visual per combo)

| Node | web · en-US | web · ar-EG | android · en-US | android · ar-EG | ios · en-US | ios · ar-EG |
|------|:-----------:|:-----------:|:---------------:|:---------------:|:-----------:|:-----------:|
| figma_analysis | | | | | | |
| execution | | | | | | |
| visual_comparison | | | | | | |

## Story roll-up
- **Platform-computed Parity Certification** (score / certification): ______
- **Manual node parity score** (from the rubric): ______ / 100
- **Canonical AC missed:** ______ (target 0)
- **Defect fidelity:** real defects found? ______ · any fabricated? ______ (target: found real, 0 fabricated)
- **Verdict for this story:** MEETS / PARTIAL / MISS

## Cross-story parity summary (fill after the campaign)
| Story | Platform parity | Manual parity | AC missed | Defect fidelity | Verdict |
|-------|:---------------:|:-------------:|:---------:|:---------------:|:-------:|
| B10-56336 (web) | | | | | |
| B10-55570 (web, gates) | | | | | |
| <mobile story> | | | | | |

**Parity gate:** every mandatory node ≥ MEETS on every story · overall platform Parity Certification ≥ 90 on the web baseline probe · 0 canonical AC missed · defect fidelity confirmed.
