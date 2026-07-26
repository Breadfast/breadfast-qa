# Claude Code Execution Engine — Architecture Requirements

> **Status:** Target architecture for the future Claude Code-based execution engine. Not yet built as
> a distinct system — Claude Code already satisfies most of this naturally when a story's QA Process
> is run as one continuous session (see §2). This doc exists so the requirement is recorded and
> deliberately preserved as the execution engine matures, not lost as an implicit assumption.
> **Relationship to other docs:** [`QA_PROCESS.md`](QA_PROCESS.md) defines *what* each phase produces
> and *when* it's complete, tool-agnostically. This doc defines *how the execution environment itself*
> (Claude Code, specifically) must behave to run that process correctly — session/browser lifecycle,
> not methodology. It never redefines a phase's inputs/outputs/gates.
> **Relationship to the QA Platform:** the QA Platform (`qa-platform/`) is now a legacy execution
> engine (maintenance/certification/bug-fix only — see `CLAUDE.md`). It solves session continuity with
> a different, lighter-weight mechanism (Tier 1 below) suited to its own architecture. That is
> **complete and sufficient for the QA Platform** and is not being redesigned. The requirement below is
> for Claude Code as primary executor going forward — it is not a mandate to backport into the QA
> Platform.

---

## 1. The requirement

For a story's QA Process execution, the execution engine must:

1. **Own one persistent browser/app session per Jira story**, spanning every phase that touches the
   live application (typically Phase 2 design comparison, Phase 4 execution, Phase 5 visual testing).
2. **Reuse that same session across phases** — not create a new browser/app session per phase or per
   step.
3. **Preserve, across the whole story, without re-establishing it:**
   - authentication (the tester is logged in once, for the whole story)
   - cookies
   - local storage
   - in-memory runtime state (SPA store, open sockets, whatever the app holds in memory)
   - current navigation/route
4. **Isolate sessions per story.** Each story's session is independent; a session must never be shared
   across two different stories, concurrently or sequentially.

This is a stronger requirement than "persist and restore auth" (that's the QA Platform's Tier 1,
below) — it means the browser is never actually closed and reopened between phases; the same live
process carries the story from Phase 1 through Phase 6.

## 2. Why this is (mostly) already achievable, not a new subsystem

The QA Platform needed a workaround (Tier 1) because of a specific architectural choice: its worker
executes each of the 27 lifecycle nodes as an **independent headless `claude -p` subprocess
invocation** (`packages/engine/src/claude-runner.ts`). Each of those invocations gets its own fresh MCP
client connection, and therefore its own fresh Playwright-driven browser — there is no continuity
between them unless something explicitly persists and restores state, which is exactly what
`appSessionCredsStep()`/`appSessionSaveStep()` (`qa-platform/apps/worker/src/nodes.ts`) do.

Claude Code, running a story's QA Process **as one continuous session/task**, does not have that
problem by construction: an MCP server (Playwright MCP) holds its browser open for the lifetime of the
client connection, not per tool call or per phase. As long as one continuous Claude Code
session/conversation drives Phase 1 through Phase 6 for a story — rather than the work being chunked
into separate per-phase invocations the way the QA Platform's worker does — the browser session is
already continuous, for free, with no additional session-management code required.

**The actual requirement, restated concretely:** run a story's whole QA Process in one Claude Code
session, not as N independent per-phase sessions. Isolation per story falls out naturally too — a
session is scoped to whatever story it was started for; never resume or reuse one story's session for
a different story.

## 3. Design cautions for whoever builds/formalizes this

- **Sub-delegation risk.** If the execution engine ever delegates a phase to a sub-agent (e.g. a
  `Task`-style spawn) rather than continuing inline, verify whether that sub-agent gets its own MCP
  connection (its own browser) or inherits the parent's. If it's the former, sub-delegating a
  browser-touching phase silently breaks this requirement the same way the QA Platform's per-node
  subprocess architecture does. Prefer running browser-touching phases inline in the main session;
  reserve sub-agents for phases that don't touch the live app.
- **Long-running-session limits.** A single session spanning all six phases of a story may be a long
  task. Verify this against any session/context-length practicalities before treating it as free —
  the requirement is architectural intent, not a claim that no engineering is needed at scale.
- **Crash/resume.** The QA Platform's Run Lifecycle Management (pause/resume/restart, see
  `qa-platform/ARCHITECTURE.md`) exists because a headless worker run can be paused for hours/days and
  resumed on a different machine. A future Claude Code execution engine that wants equivalent
  resilience (resume a story's QA Process after an interruption) will need to decide how — or
  whether — a persistent browser session survives that, since a genuinely continuous browser process
  cannot trivially "resume" the way a stateless, DB-rebuilt prompt can. This doc does not resolve that;
  it flags it as an open question for whoever designs the resume story.

## 4. Non-goals

- This is **not** a requirement to make the QA Platform's worker spawn a standalone long-lived
  Playwright MCP server. That was considered and explicitly rejected as over-engineering a platform
  being moved away from — see the Tier 1/Tier 2 split in `qa-platform/ARCHITECTURE.md`'s Run Lifecycle
  Management section.
- This is **not** a new methodology requirement. `QA_PROCESS.md`'s phases, artifacts, and gates are
  unchanged; this doc only constrains how the *execution environment* carries state between them.
