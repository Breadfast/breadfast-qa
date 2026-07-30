# Shared-config changes made for the B10-56717 automation run — and what to do with each

`D:\projects` is a **shared** framework checkout. Every value below was changed to get a mobile test to
run at all. Backups were taken to `/tmp` (volatile), so the authoritative record is this file.
Recorded 2026-07-29.

| # | File | Key | Original | Changed to | Disposition |
|---|---|---|---|---|---|
| 1 | `resources/environments/config_testing.properties` | `targetApp` | `customerAppReactNative` | `customerAppNative` | **REVERT** — a per-run switch. `Configs` offers no `-D` override, so a native run cannot avoid editing this file. Worth adding an override. |
| 2 | `resources/environments/cardServiceConfigs_testing.properties` | `cardUserMobileNumber` | `+201131528282` | `+201064507660` | **DECIDE** — `+201131528282` reached the login OTP but its Pay flow was never verified; `+201064507660` is the account this story's four manual combos were validated on and is confirmed `Active` via `/wallet_users/allWallets`. Both have Active wallets. |
| 3 | `resources/environments/browserStackConfigs.properties` | `bStackIosCustomerAppNativeApp` | *(empty)* | `bs://30248a9811450c98323ef9860d13a287231109ac` | **KEEP** — operator-supplied iOS build. While empty, iOS native was **unrunnable**: the payload carried `buildName: null` and BrowserStack rejected it outright, after which the factory fell back to a local Appium session needing `xcrun` (macOS only). |
| 4 | `resources/environments/browserStackConfigs.properties` | `bStackIosCustomerAppNativeAppBuildNumber` | *(empty)* | `B10-56717-ios-native` | **KEEP or relabel** — it is only a BrowserStack `buildName`/`sessionName` label, but it must be non-null or the session is rejected. Give it whatever the team's iOS build number actually is. |
| 5 | `resources/environments/browserStackConfigs.properties` | `androidDeviceName` / `androidPlatformVersion` | `Samsung Galaxy S22 Ultra` / `12.0` | *(briefly S23 / 13.0)* | **ALREADY REVERTED** — the app does **not launch** on S23/13 through the framework (`Activity name '.com.breadfast.main.MainActivity' … cannot be launched`), though it launches fine on the S22 Ultra and fine on an S23 via a raw Appium session that sets no `appActivity`. See `framework-reference.md` §1.0 F-4. |

## Restore commands

```bash
cd D:\projects
git diff --stat resources/environments/                    # see exactly what is still changed
git checkout -- resources/environments/config_testing.properties            # reverts #1
git checkout -- resources/environments/cardServiceConfigs_testing.properties # reverts #2
# leave browserStackConfigs.properties if keeping #3/#4; otherwise:
# git checkout -- resources/environments/browserStackConfigs.properties
```

## Code changes (NOT config) that should be reviewed and kept

These are in tracked source on the story branch and fix defects that affect the whole estate:

| File | Change |
|---|---|
| `helpers/apiClients/GoogleChatApiClient.java` | login-OTP guard `> 1` → `!isEmpty()` (F-1) — blocked every login-OTP test on cold start |
| `modals/.../AndroidNativePayScreen.java` | added `getOnScreenIdentifiersForDiagnostics()` so a failing assertion carries the live tree |
| `modals/.../AndroidNativeCardPerksListScreen.java`, `IosNativeCardPerksListScreen.java` | +4 methods each (`pressSectionTab`, `sectionHeaderIsDisplayed`, `getPerkCardTitle`, `getPerkCardSubheader`) |
| `helpers/apiClients/webApiClients/CardAdminPanelPerksApiClient.java` | read side: `listSections`, `listPerks`, `getSectionIdsWithActivePerksInExpectedOrder`, `getActivePerkIdsAssignedToASection`, `getPerkSubheaderEn` |
| `base/BaseTest.java` | `cardAdminPanelPerksApiClient` — import, `ThreadLocal`, **and `.set(...)`** |
| `b10-56717-tests.xml`, `b10-56717-android-only.xml` | story suites; the `-Dsurefire.suiteXmlFiles=` correction (F-2) is documented in both, and in `b10-56652-tests.xml` |

**Nothing has been committed or pushed.** The branch
`2026/sprintQ3.3/B10-56717-perks-list-screen-redesign` exists in both repos with these as working-tree
changes, so a `git diff` review comes before any commit.
