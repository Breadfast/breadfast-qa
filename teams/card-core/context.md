# Card Core (BCard) — team context

verifiedAt: 2026-11-24 · verifiedBy: Claude, migration-mode onboarding from card-core's existing repo knowledge — pending card-core review

> Written by team onboarding (`qa-workflow/skills/team-onboarding`). Every fact carries a confidence tag;
> `node qa-workflow/bin/qa-cli.js knowledge-lint teams/card-core` enforces it. Product rules live in the
> `card`, `payment` and `marketing` domains — this file holds what is specific to the *team's setup*.

## Product
- Breadfast Card (BCard): a Visa card applied for, picked up and activated in the customer app, with perks and cashback. [tester: card-core (migrated from qa-workflow/domains/card/business-rules.md); 2026-11-24]
- The card is used from Breadfast Pay (the in-app wallet); Card stories routinely run through Pay home. [tester: card-core (migrated from qa-workflow/domains/payment/business-rules.md); 2026-11-24]
- Perks are created and featured in the card panel and displayed in the app. [tester: card-core (migrated from qa-workflow/domains/marketing/perks.md); 2026-11-24]

## Surfaces & locale support
- mobile — customer app, iOS + Android × EN + AR (4 combos). [confirmed: doc:CLAUDE.md; 2026-11-24]
- web — card panel: English UI only (no locale switch, `html[lang]` hard `en`); Arabic is content only. [confirmed: doc:qa-workflow/domains/card/card-panel.md; 2026-07-26]
- web — Admin Portal (KYC / customer screens used by Card stories): locale support not recorded. [unknown]
- backend — card service API and its cron jobs. [tester: card-core (migrated from qa-workflow/domains/card/card-service.md); 2026-11-24]

## Environments (URLs only — no credentials)
- Card panel (testing): https://card-panel-testing.breadfast.tech [confirmed: repo:breadfast-qa@2ec856b:automation/config/environments/cardServiceConfigs_testing.js:54; 2026-11-24]
- Card backend (testing): https://card-backend-testing.breadfast.tech [confirmed: repo:breadfast-qa@2ec856b:automation/config/environments/cardServiceConfigs_testing.js:57; 2026-11-24]
- Mobile (WordPress) API (testing): https://new-testing.breadfast.tech [confirmed: repo:breadfast-qa@2ec856b:automation/helpers/CardConfig.js:30; 2026-11-24]
- Payment sandbox (testing): https://payment-sandbox-testing.breadfast.tech [confirmed: repo:breadfast-qa@2ec856b:automation/payment-sandbox/login.js:14; 2026-11-24]
- Production is never used for automated testing. [tester: card-core (migrated from docs/ai/business/breadfast-overview.md); 2026-11-24]

## Architecture
- Card service backend: perk definitions, cron-driven cashback, MID exclusion, card lifecycle status. [tester: card-core (migrated from qa-workflow/domains/card/card-service.md); 2026-11-24]
- Card DB: MySQL `cards_hades_testing`, reachable only through an SSH tunnel. [tester: card-core (migrated from qa-workflow/domains/card/business-rules.md); 2026-11-24]
- Card panel front end is Angular (CoreUI Angular with Angular Material components). [inferred: bundle chunk `webpackChunkcoreui_angular` and `mat-snack-bar-container` seen in card-panel runs; 2026-11-24]
- Card transactions arrive from the card processor (MDP) as advices; the repo simulates them. [inferred: automation/advice-simulator and automation/payment-sandbox exist for this; 2026-11-24]

## Tech stack
- Product source stacks (backend, card panel, mobile apps) are not recorded. [unknown]
- QA automation: the org Java framework (Selenium web, Appium mobile, TestNG, Maven). [confirmed: doc:docs/ai/automation/automation-generation.md; 2026-11-24]
- Legacy in-repo Playwright suite for card-panel/card-service specs. [confirmed: doc:docs/ai/automation/playwright-framework.md; 2026-11-24]

## Repositories
- No product repository is listed yet (`repos.json` is empty), so repository discovery has nothing to read. [unknown]

## Documentation
- Each story's Figma link is on its Jira ticket (file key per story). [confirmed: doc:CLAUDE.md; 2026-11-24]
- Where PRDs and architecture docs live is not recorded. [unknown]

## Test data strategy
- Provision card users per run through the card-service API and delete them after (`CardUserFactory`, `npm run bcard-user`, the card sandbox UI). [tester: card-core (migrated from qa-workflow/domains/card/test-data.md); 2026-11-24]
- Shared mobile test accounts are in the `payment` domain (`test-accounts.md`). [tester: card-core (migrated from docs/ai/business/user-roles.md); 2026-11-24]

## Integrations & dependencies
- Login OTPs come from the Google Chat `#testing-otp` space (org-wide). [confirmed: doc:docs/ai/business/breadfast-overview.md; 2026-11-24]
- Card DB access needs `cardDb*` keys in `credentials.local.js`. [confirmed: repo:breadfast-qa@2ec856b:automation/config/credentials.js; 2026-11-24]
- Card-service test cron trigger needs `cardCronAuthorization` / `cardCronToken`. [confirmed: repo:breadfast-qa@2ec856b:automation/config/credentials.js; 2026-11-24]

## Open questions / unknowns
- Which product repositories (card service backend, card panel front end, customer app iOS/Android) may QA read, and what are their clone URLs? Then fill `repos.json`; each tester grants a local path in `credentials.local.js → repos`.
- Does the Admin Portal (KYC / customer screens) have an Arabic UI?
- Where do the Card PRDs and architecture docs live?
- What are the product source stacks (languages / frameworks) of the card service, the card panel and the apps?
