# Framework Reference — B10-57806

Reuse map for the generated automation. **All code lives in the Java framework (`D:\projects`)**; this file
is the index so the next story can reuse instead of rebuilding.

---

## 1. Reused — existing assets, not rebuilt

| Asset | Path (framework) | Used for |
|---|---|---|
| `AndroidNativeLandingScreen` | `modals/customerApp/androidNative/` | onboarding / auth entry |
| `AndroidNativePhoneNumberScreen` | same | phone entry |
| `AndroidNativeOtpVerificationScreen` | same | login OTP |
| `AndroidNativeCountriesSelectionScreen` | same | country gate |
| `AndroidNativeHomeScreen` | `androidNativeHomePage/` | home + `pressPayBtn()` |
| `AndroidNativePayScreen` | `androidNativePayScreen/` | Pay home, `enableComposeAccessibilityTree()` |
| **`AndroidNativePayOtpScreen`** | same | **also serves the card-application OTP (step 1 of 3)** — same markers, same code source |
| `androidNativeTestsExecutionHelper.login(...)` | `helpers/` | the standard login composition |
| `testExecutionHelper.buildRandomUserObject / registerUsingApi` | `helpers/TestExecutionHelper.java` | fresh account per test |
| `CardServiceApiClient` — `getCardServiceToken`, `generateInvitationCodeBatch`, `exportInvitationCode`, `consumeInvitationCode` | `helpers/apiClients/mobileApiClients/` | invitation-code precondition **only** |
| `UserDataFactory.generateRandomEgyptianNationalID` | `helpers/factories/dataFactories/` | Luhn-valid unused NID |

**Deliberately NOT reused:** `BCardTestsExecutionHelper.createBCardInvitedCardUser(...)`. It bundles the
invitation chain **with `createCardUser`**, which submits the National ID and expiry over the API and is
exactly what flips the card to `Pending` — using it would skip the screen under test. The three
invitation-code calls are composed inline instead ([[reuse-existing-flows]]).

## 2. Built — new classes and their public surface

### `helpers.factories.dataFactories.IdExpiryDateFactory`
```java
static LocalDate deviceToday(HasDeviceTime driver)     // getDeviceTime() -> the handset's local day
static LocalDate threshold(LocalDate today)            // today + 2 calendar months, month-end clamped
static LocalDate wellInside(LocalDate today)           // +1 month
static LocalDate boundaryMinus1(LocalDate today)       // threshold - 1 day   (must warn)
static LocalDate boundaryExact(LocalDate today)        // threshold           (DISPUTED - observe only)
static LocalDate boundaryPlus1(LocalDate today)        // threshold + 1 day   (must not warn)
static LocalDate farFuture(LocalDate today)            // +2 years
static LocalDate expiresToday(LocalDate today)
static LocalDate alreadyExpired(LocalDate today)       // -1 month (no AC - observe only)
static boolean   isMonthEndClampObservable(LocalDate today)
static String    toKeypadDigits(LocalDate date)        // ddMMyyyy  - what is typed
static String    toDisplayedValue(LocalDate date)      // dd / MM / yyyy - what is rendered
```
Reusable by any story that touches an expiry-date rule. `LocalDate.plusMonths` supplies month-end clamping.

### `modals.customerApp.androidNative.androidNativePayScreen.AndroidNativeCardIdInfoScreen`
```java
boolean isPageDisplayed() / isPageHidden() / isStepIndicatorOnStepTwo()
void    enterIdentityDetails(String arabicFirstName, String arabicRemainingName, String nationalId)
void    enterExpiryDate(LocalDate expiryDate)   // types + WAITS for the rendered value (clear() can no-op)
String  getEnteredExpiryDate()
List<String> getEnteredValues()                 // all four, for data-preservation assertions
boolean isArabicNameValidationErrorDisplayed()  // "Enter your name in arabic"
boolean isSubmitEnabled() ; void tapSubmit()
```

### `…AndroidNativeIdNearExpiryModal`
```java
boolean isDisplayed() / isHidden() / areBothActionsDisplayed()
String  getTitle() / getBody()
List<String> getActionLabels()                  // primary first, then secondary
void    tapContinue() / tapGoBack()
void    dismissBySwipingDown() / dismissByTappingOutside()
```

### `…AndroidNativeCardSetupIntroScreen`
```java
boolean isPageDisplayed() / isStepIndicatorOnStepThree() ; void tapNext()
```

### `…AndroidNativeCardApplicationIntroScreen`
```java
boolean isPageDisplayed() ; void tapNext()
```

### Additive edits to shared classes
- `AndroidNativePayScreen`: `isCardApplicationApplyBtnDisplayed()`, `pressCardApplicationApplyBtn()`.
- `BaseTest`: 4 new ThreadLocals + initialisation.
- `IosNativeHomeScreen`: `pressPayBtn()` — **repairing a pre-existing break inherited from B10-56711**, see
  [`conformance-review.md`](conformance-review.md) §5.

## 3. Navigation notes (per case)

Every test reaches the same point via `@BeforeMethod`:

```
API : registerUsingApi -> card-service token -> generate/export/consume invitation code -> STOP
UI  : landing -> country -> auth -> login (OTP via Google Chat)
      -> home -> Pay tab -> enableComposeAccessibilityTree()
      -> Apply -> "Apply for your card" -> Next
      -> step 1/3 OTP (last 4 digits of the phone)
      -> step 2/3 "Enter your ID information" -> fill names + National ID
```

The test body then sets only the **expiry date** and asserts. This keeps the API to the invitation code
alone; every behaviour any AC describes is exercised through the client (operator instruction 2026-07-30).

## 4. Traps encoded in the code, so they are not rediscovered

| Trap | Where it is handled |
|---|---|
| Pay/Compose nodes are invisible to UiAutomator2 until the accessibility tree is enabled | `enableComposeAccessibilityTree()` before any Pay assertion |
| `content-desc` test ids are **localized** (`Submit`/`إرسال`, `Continue`/`متابعة`, `Go back`/`الرجوع`, `Apply`/`قدّم الطلب`, `Next`/`التالي`) | every locator matches both spellings |
| The four ID inputs expose no `content-desc` | addressed positionally; labels are siblings, not parents |
| `clear()` can silently no-op, so writes concatenate | `enterExpiryDate` waits for the rendered value |
| A reused National ID bounces Submit back to 2/3 with no error | fresh Luhn-valid id per test |
| The bottom bar has 3 tabs out-of-zone and 5 in-zone | never tap Pay by coordinate; use the test id |
| `-DsuiteXmlFile=` is ignored by this pom | run with `-Dsurefire.suiteXmlFiles=` |

## 5. Open items for the next run

1. **Execute the suite** — never run; card-service is 502.
2. **First probe when it returns:** `boundaryExact`. While the day-of-month exceeds the target month's
   length (e.g. 31 Jul → 30 Sep) it also distinguishes a correct month-end clamp from naive overflow.
3. **iOS mirror class** — not written. iOS input needs the framework's `setValue` path; the raw W3C calls
   used during exploration were unreliable (`clear` no-op, `/element/active` unsupported).
4. **Set `automation_status`** on the 16 automated BrowserStack cases once they have actually run green.
