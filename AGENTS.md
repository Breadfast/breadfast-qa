# AGENTS.md — Breadfast QA Test Companion (pointer)

> This file intentionally holds **no duplicated content**. The single source of truth for the
> Breadfast QA operating manual is **[CLAUDE.md](CLAUDE.md)** (the orchestration layer) plus the
> **[`docs/ai/`](docs/ai/)** knowledge base. Any agent (Codex, Claude, or other) running QA on
> this project must read those, not this file.

## Where everything lives
- **Roles, QA lifecycle, story process, quality gates, governance, quick reference** → [CLAUDE.md](CLAUDE.md)
- **Detailed knowledge** → [`docs/ai/`](docs/ai/):
  - Process: [testing-process](docs/ai/testing-process.md) · [browserstack-process](docs/ai/browserstack-process.md) · [exploratory-testing](docs/ai/exploratory-testing.md) · [regression-strategy](docs/ai/regression-strategy.md) · [bug-reporting](docs/ai/bug-reporting.md) · [release-validation](docs/ai/release-validation.md)
  - Business: [`docs/ai/business/`](docs/ai/business/)
  - Automation: [`docs/ai/automation/`](docs/ai/automation/)
  - Modules: [`docs/ai/modules/`](docs/ai/modules/)

## Why this is a pointer
AGENTS.md was previously a near-verbatim copy of the monolithic CLAUDE.md. Maintaining two full copies caused drift. Per the 2026-06-21 restructure, AGENTS.md is reduced to this pointer so there is exactly one source of truth. Do not re-add operating-manual content here — update CLAUDE.md or the relevant `docs/ai/**` file instead, following the documentation-governance protocol in [CLAUDE.md](CLAUDE.md) §6.
