# <Team> — team context

verifiedAt: YYYY-MM-DD · verifiedBy: <name>

> Written by team onboarding (`qa-workflow/skills/team-onboarding`). Every fact ends with ONE confidence tag:
> `[confirmed: repo:<id>@<sha>:<path>[:line]; <date>]` · `[confirmed: doc:<url-or-path>; <date>]` ·
> `[confirmed: jira:<KEY>; <date>]` · `[inferred: <evidence>; <date>]` · `[tester: <name>; <date>]` ·
> `[unknown]` · `[outdated: <superseded by>; <date>]`. Check with
> `node qa-workflow/bin/qa-cli.js knowledge-lint teams/<team>`. No secrets — name keys, never values.

## Product
- <what the product is and does> [tester: <name>; YYYY-MM-DD]

## Surfaces & locale support
- <web | mobile | backend — which UI languages each surface really has> [tester: <name>; YYYY-MM-DD]

## Environments (URLs only — no credentials)
- <env>: <url> [tester: <name>; YYYY-MM-DD]

## Architecture
- <services / apps and how they talk> [unknown]

## Tech stack
- <languages / frameworks per repo> [unknown]

## Repositories
- <see repos.json; grants are per person in credentials.local.js → repos> [unknown]

## Documentation
- <PRDs, architecture docs, API specs — where they live> [unknown]

## Test data strategy
- <how test records/users are created and cleaned up> [unknown]

## Integrations & dependencies
- <OTP, payment providers, queues, third parties> [unknown]

## Open questions / unknowns
- <one question per [unknown] fact above>
