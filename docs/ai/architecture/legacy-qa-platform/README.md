# `legacy-qa-platform/` — documents rescued from the deleted `qa-platform/`

The QA Platform (`qa-platform/`, 199 files) was **removed from this repository on 2026-08-10**. It
was a legacy execution engine, deferred since 2026-07-15 and superseded by Claude Code as the primary
execution environment. It had **zero runtime coupling** to the workflow — verified before deletion:
no `require`/`import` anywhere in `automation/`, `qa-workflow/`, `docs/ai/` or `.claude/` reached
into it, exactly as [`qa-artifact-contract.md`](../qa-artifact-contract.md) §"severed 2026-07-26"
and [`ONBOARDING.md`](../../../../ONBOARDING.md) already claimed.

Three documents were still **cited by live docs**, so they were copied here rather than lost:

| File | Cited by | Why kept |
|---|---|---|
| [`adr-002-visual-testing-redesign-rev2.md`](adr-002-visual-testing-redesign-rev2.md) | [ADR-003](../adr-003-visual-conformance-engine-plugin-aligned.md) | ADR-003 **extends and re-homes** it — the L1–L7 validation-pyramid methodology it defines is kept, only its home changed |
| [`adr-002-implementation-plan.md`](adr-002-implementation-plan.md) | ADR-003 | the AIP-002 migration plan ADR-003 builds on |
| [`qa-platform-ARCHITECTURE.md`](qa-platform-ARCHITECTURE.md) | [`execution-engine.md`](../../execution-engine.md) | the Run Lifecycle / Tier 1–Tier 2 split that `execution-engine.md` reasons about |

**These are historical records.** They describe a system that no longer exists in this repo — read
them for the methodology and the design rationale, not as instructions. Anything still in force was
carried into ADR-003 and `docs/ai/execution-engine.md`.

> **Their internal links are dead by design.** These files were written to sit inside
> `qa-platform/`, so relative links in them (`./adr-002-visual-testing-redesign.md`,
> `../../ARCHITECTURE.md`, `./ARCHITECTURE-REVIEW.md`) point at siblings that were not carried
> across — those siblings were superseded, not cited by anything live. The files are reproduced
> verbatim rather than rewritten, so the record stays faithful; follow the table above for the
> live equivalents.

The platform's own history remains in git and on `github.com/Breadfast/qa-platform`.
