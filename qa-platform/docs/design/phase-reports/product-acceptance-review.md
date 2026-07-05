# Product Acceptance Review — Breadfast QA Platform

> 2026-07-05 · Method: drove the live app (api + web, production build) through the Playwright browser as a first-time QA engineer with no prior knowledge. Focus: product quality, not implementation. No changes made.

## Verdict

The platform is **genuinely usable and coherent**. The visual system is consistent across every screen, onboarding + diagnostics are a real strength, and the "clone → set up → run a story" path exists and mostly flows. The gaps are **discoverability and information-architecture polish**, not missing capability. A handful of small fixes would make it feel finished for the team.

## What's strong (keep)

- **Onboarding wizard** — Welcome → Environment (resolved repo/workspace paths + prerequisite checks) → Configure → **Environment Health Report** with a readiness verdict. This directly serves the goal.
- **Diagnostics + Fix Suggestions** — every failing check explains *why*, *how to fix*, and links *where to get it*, with per-check re-test. Excellent.
- **New Story wizard** — Project selector pre-fills defaults; clear 6-step stepper; strong execution-instructions guidance; Review step before Run QA.
- **Framework Registry** — clear purpose statement; register + scan (captures version + git commit).
- **Consistent design language** — sidebar nav, cards, status pills, typography are uniform everywhere.
- **Local-first messaging** — "runs locally, your data stays on your machine" is stated up front.

## Prioritized findings

### 🔴 High
1. **"Knowledge" nav link 404s** — there is no `/knowledge` page; clicking it (or Next.js prefetch on hover) returns 404. A dead item in primary nav is the first broken thing a new user hits. → Build a minimal Knowledge page or remove the nav item until it exists.
2. **Onboarding isn't surfaced on first run** — a fresh sign-in lands on the Dashboard (all zeros), not Setup. "Setup" is just one nav item among nine. The entire clone→setup→run promise depends on the user finding it. → Redirect to `/onboarding` when `onboarding.completed` is false, or show a prominent dashboard banner ("Finish setup").
3. **Framework configuration lives in two places** — Settings → Automation still has *Playwright framework path / Appium framework path / Canonical framework / Repository locations*, now duplicated by the dedicated **Frameworks** page. Two sources of truth → confusion and drift. → Remove the framework fields from Settings (or replace with a link to Frameworks). Single most confusing IA issue.
4. **No per-field help in Settings** — fields are label + input only. A first-timer can't tell "Access key (App Automate)" from "Test Management API token", or where to obtain either. → Add the what/why/where help per field (the Phase-C settings-registry design already specifies this).

### 🟡 Medium
5. **Onboarding "Configure" step is state-blind** — the Jira/BrowserStack/Figma/Frameworks cards are static links; they don't show whether each is already configured (✓/!). The user must jump to the Health Report to learn status. → Show live status on each card.
6. **Two Figma auth mechanisms, no hierarchy** — Settings shows both a "Figma Browser Session" card (primary) and a "Figma → Personal access token" field (fallback) with no indication which to use. → Label primary vs fallback.
7. **Silent error handling** — pages swallow fetch failures (`.catch(() => {})`) and render empty. If the API is down, the user sees "No data" instead of "Couldn't reach the server." → Lightweight error state/toast.
8. **Unwired settings still shown** — several AI/Integrations fields (Slack, DB URL, GitHub, some AI fields) are displayed but not yet consumed. Config that does nothing erodes trust. → Hide or mark "not yet used / advanced."
9. **Test Data "0a 0r 0c"** — the available/reserved/consumed abbreviations are unexplained. → Legend or full words.
10. **No user identity / sign-out in the shell** — the sidebar shows "v0.1 · phase 0" but not who's signed in or how to log out. → Add a user chip + sign out.

### 🟢 Low
11. **Onboarding heading is static** ("Welcome to Breadfast QA" on every step) — only the stepper changes; the h1 doesn't reflect the current step.
12. **Stepper steps aren't clickable** (wizard + onboarding) — only Back/Next; can't jump to a step.
13. **"phase 0" in the sidebar footer** — internal jargon; a QA engineer doesn't need it. → Version only.
14. **Terse empty states** ("No stories yet.") — add a one-line next-step CTA.
15. **Internal terminology in onboarding** — "canonical Companion", "parity", "27-step workflow" may be opaque to a new QA engineer. → One-line plain-language framing or a tiny glossary.
16. **Missing favicon** (404) — cosmetic.
17. **Loading states** — brief empty flashes before data loads; consider skeletons on the data pages.

## Recommendation on sequencing

The High items are small and high-impact for first impressions, but **none block Stage 2 parity validation** (which exercises the execution pipeline, not these pages). Suggested order:
1. Quick win batch: **#1 (dead Knowledge link), #2 (surface onboarding), #3 (dedupe framework config)** — an hour of work, removes the most jarring first-run issues.
2. Then **Stage 2 — Platform Parity validation** (story **B10-56337**).
3. Fold the remaining Medium/Low items into the Phase-C settings work (#4, #6, #8) and a small UX pass.
