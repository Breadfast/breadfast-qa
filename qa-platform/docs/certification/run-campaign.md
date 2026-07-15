# Workstream C — Story Campaign Runbook

> Step-by-step for the QA team to execute the certification corpus on the running platform. Claude scores from the evidence you capture. Corpus (confirmed): **B10-56336** (web) · **B10-55570** (web) · **one mobile story** (iOS+Android, EN+AR).

## 0. Pre-flight (once)
1. **Harden config:** set `SESSION_SECRET`, `SECRETS_ENCRYPTION_KEY`, `DEV_USER_EMAIL` (or real Google OAuth) in the environment.
2. **Start:** `npm run build` → `npm start` (launcher brings up api+worker+web and opens the browser signed in).
3. **Diagnostics:** open **/diagnostics** — resolve every `fail`; for the corpus you need at least: Claude CLI ✓, DB ✓, Jira ✓, BrowserStack ✓, Figma session ✓, Playwright ✓ (web), Java + Android SDK ✓ (mobile story).
4. **Authorize integrations:** Jira, Figma session, BrowserStack creds, Slack OTP (mobile). Confirm each shows configured in Settings/Diagnostics.
5. Record platform commit/version (report footer shows Workflow/Prompts/Platform versions).

## 1. Per-story execution
For each story:
1. **Create story** via the wizard (`/stories/new`): Jira key, platform, locales (`en-US, ar-EG`), app/admin URL (web) or BrowserStack app IDs (mobile), credentials, BrowserStack folder, execution instructions.
2. **Run** it. Drive the lifecycle through the run detail: answer clarifications, approve gates (HLS push, BrowserStack upload, bug filing), submit any credential prompts.
3. **Exercise reliability at least once across the campaign:** pause+resume, cancel+restart, a credential-pause, and a gate rejection→regenerate.
4. **Let it complete** to `html_report` (and `knowledge_update`).

## 2. Evidence to capture (per story)
- **Run id** + wall-clock start/end.
- The generated **HTML report** (has Story Health, Recommendations, Parity, Review Confidence, Visual Intelligence, Activity Timeline, Knowledge Lint).
- **Jira**: HLS checklist posted? bug sub-tasks filed (severity/ADF correct)?
- **BrowserStack**: import verified (folder count, no nested folder, granular steps).
- **Figma**: frames exported for both locales.
- Screenshots/video of any **UX friction**, crash, stuck run, or wrong output.
- Note anything a **senior QA would have done differently** vs the platform's output (this is the parity signal).

## 3. Record results
- Copy [story-evaluation-template.md](./story-evaluation-template.md) → `story-eval-<KEY>.md`; fill sections 1–9.
- Pre-created scorecards: [story-eval-B10-56336.md](./story-eval-B10-56336.md) · [story-eval-B10-55570.md](./story-eval-B10-55570.md) · `story-eval-<mobile>.md`.
- Hand the filled scorecards + report(s) back to Claude → parity scoring ([platform-parity-matrix.md](./platform-parity-matrix.md)) + certification report ([certification-report.md](./certification-report.md)).

## 4. What Claude does with it
- Scores all 27 nodes per story (MEETS/PARTIAL/MISS) + combo grid.
- Diffs B10-56336 against its canonical 20/20 result.
- Rolls up parity + readiness + reliability + integrations + UX + performance → the **Pilot Readiness Recommendation**.

## Tips / known pitfalls (from the platform docs)
- **Arabic locale caps** must be top-level (`appium:language: ar`, `appium:locale: EG`), never in `bstack:options`.
- **Login OTP** from Slack `#testing-otp`; **card OTPs** = last 4 digits of the test phone.
- Coordinate taps for Pay "Get started" (195,540) and activation "Got it" (195,810).
- If Figma REST is rate-limited, the platform falls back (browser export → screenshot); confirm frames landed.
