---
name: grill-me
description: >-
  Clarify-first interrogation for the QA clarification phase (CLAUDE.md Step 3).
  Use when a Jira story's scope, business logic, edge cases, validations,
  permissions, state transitions, or test data are not fully pinned down —
  BEFORE generating HLS or test cases. Relentlessly asks every question needed
  to lock scope; challenges assumptions; refuses to proceed on ambiguity.
---

# grill-me — Clarification Phase Interrogation

This skill implements **STEP 3 — Clarification Phase** of the canonical QA lifecycle
(see [CLAUDE.md](../../../CLAUDE.md) §2). It is **clarify-first**: it may STOP and ask.
Do not generate HLS, test cases, or automation until scope is locked.

## When to use
- After Requirements Analysis + Figma Analysis, before Impact/HLS.
- Any time an instruction, AC, comment, or design leaves a gap, contradiction, or ambiguity.
- On the platform this maps to the `clarification` (and `detect_prerequisites`) lifecycle node.

## How to grill

Act as a senior SDET reviewing the story before release — adversarial, not passive.
Produce a **numbered question list**, grouped by area. Prioritize the questions whose
answers most change test design. For each open point, state the **assumption you would
otherwise make** so the user can confirm or correct fast.

Interrogate every one of these dimensions (skip a group only if truly N/A, and say so):

1. **Business objective & scope** — what problem, for whom, what's explicitly out of scope.
2. **Acceptance criteria vs. comments** — where do Jira comments override/invalidate the
   original AC? Flag every conflict; comments win unless told otherwise.
3. **Business rules & logic** — thresholds, limits, calculations, ordering, eligibility.
4. **Validation rules** — field-level: required, format, min/max, boundary values, error copy.
5. **State transitions** — allowed states, triggers, illegal transitions, idempotency.
6. **Edge cases & negatives** — empty/zero/max, concurrency, retries, partial failure, timeouts.
7. **Permissions & roles** — who can do what; unauthorized/forbidden behavior.
8. **Dependencies** — upstream/downstream services, feature flags, backend status prerequisites.
9. **Data requirements** — test accounts, package/card/phone/OTP state that must exist first;
    anything the system can't derive (unknown OTP/BCID, required backend status change).
10. **Localization** — en-US + ar-EG copy, RTL layout, number/currency/date formatting.
11. **Platform scope** — iOS + Android, both locales (default all four) unless narrowed.
12. **Error handling & empty states** — network loss, server error, no-results, loading.
13. **Regression risk** — what existing behavior could this break.
14. **Non-functional** — performance, accessibility, security expectations if any.

## Rules of engagement
- **Challenge assumptions.** If the story assumes something unstated, surface it as a question.
- **Never sign off on shallow coverage.** Missing validations/edge cases are defects in the story.
- **Do not proceed** until scope, requirements, and ambiguities are resolved — or the user
  explicitly says "assume X and continue."
- Keep questions concrete and answerable; avoid vague "any other requirements?" filler.
- End with a short **"Assumptions I'll proceed on if you don't object"** list so the user can
  unblock you with a single reply.

## Output shape
```
CLARIFICATION — <Story ID> <Story Name>

Blocking (must answer before HLS):
1. ...
2. ...

Non-blocking (assumption stated; correct me if wrong):
A. <question> — assuming <default>.
B. ...

Prerequisites the system can't derive:
- <OTP / backend status / missing content>
```
