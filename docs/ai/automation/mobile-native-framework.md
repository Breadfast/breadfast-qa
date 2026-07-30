# Mobile Native Automation (`androidNative` / `iosNative`) — Canonical Reference

> **Single source of truth for all NEW Android-native / iOS-native customer-app automation.**
> This is a deep, implementation-level companion to [java-framework.md](java-framework.md) §3/§4 (which
> covers the whole `D:\projects` framework at catalog level). That doc tells you a page object exists;
> **this doc tells you how to write a new one so it fits in exactly like the existing ~250.**
>
> Scope: `D:\projects\src\main\java\modals\customerApp\{androidNative,iosNative}` (page objects) +
> `D:\projects\src\test\java\customerApp\{androidNative,iosNative}` (test classes) + the shared
> infra both depend on (`BaseTest`, `MobileDriversFactory`, `Configs`, `OtpFactory`, data factories).
>
> **Before generating any new Android-native or iOS-native automation: read this doc, then grep the
> existing screen/test packages for something similar. Never duplicate an existing page object,
> helper method, or workflow — extend or reuse it.**

---

## 0. Why `androidNative`/`iosNative` and not `android`/`ios`

Per [java-framework.md](java-framework.md) §3: `android`/`ios` = legacy React Native build (text/xpath
locators); `androidNative`/`iosNative` = the current fully-native rebuild (stable accessibility-id /
content-desc locators). **All new customer-app mobile automation targets the native build** unless a
story is explicitly scoped to the legacy RN app. The active regression suite (`mobileng.xml`) only
runs `androidNative`/`iosNative`.

---

## 1. Base screen classes — the contract every page object inherits

| | Android | iOS |
|---|---|---|
| Class | `modals/BaseAndroidScreen.java` | `modals/BaseIosScreen.java` |
| Extends | `BaseHelper` | `BaseHelper` |
| Driver field | `public AndroidDriver androidDriver;` | `public IOSDriver iosDriver;` |
| Wait field | `public Wait<AndroidDriver> wait;` | `public Wait<IOSDriver> wait;` |
| Wait config | `FluentWait`, 15s timeout, 1s polling, ignores `NoSuchElementException` | same |
| `PageFactory.initElements` | called **inside the base constructor** | **NOT** called in base — every subclass constructor must call it itself |

Common helper methods on both base classes (inherited by every screen — call these, don't reinvent):
- `isElementDisplayed(WebElement)` → bool, wraps `wait.until(visibilityOf(...))`, swallows exceptions → `false`. **The universal existence-check idiom** — used as `Assert.assertTrue(screen.isXDisplayed())` everywhere.
- `isElementHidden(WebElement)` → bool, `wait.until(invisibilityOf(...))`, same swallow pattern.
- `enterValueInTextField(WebElement, String)` — click then `sendKeys` (iOS appends `"\n"` to dismiss the keyboard).
- Android also has `hideKeyboardIfDisplayed()`. iOS also has `dismissKeyboardIfDisplayed(IOSDriver)` and `getMaxRetries()` (= 3, used by recursive tap-and-retry patterns — see §3).

**Standard page-object skeleton (copy this for any new screen):**

```java
package modals.customerApp.androidNative[.<subpackage>];   // or iosNative

import io.appium.java_client.android.AndroidDriver;        // or io.appium.java_client.ios.IOSDriver
import modals.BaseAndroidScreen;                            // or modals.BaseIosScreen
import org.openqa.selenium.WebElement;
import org.openqa.selenium.support.FindBy;
import org.openqa.selenium.support.PageFactory;
import org.openqa.selenium.support.ui.ExpectedConditions;

public class AndroidNative<Feature>Screen extends BaseAndroidScreen {   // IosNative<Feature>Screen extends BaseIosScreen
    public AndroidNative<Feature>Screen(AndroidDriver androidDriver) {
        super(androidDriver);
        PageFactory.initElements(androidDriver, this);   // required on iOS too — base ctor doesn't call it
    }
    // @FindBy fields, then public methods
}
```

Add `org.openqa.selenium.By` to imports if using templated/dynamic locators (see §2), and
`java.util.List` for multi-element fields (`List<WebElement>`).

---

## 2. Locator conventions

**Android** — `content-desc` (accessibility id) via plain Selenium `@FindBy(xpath =
"//android.view.View[@content-desc='...']")`. No `@AndroidFindBy`/`AppiumFieldDecorator` used in this
build — vanilla `PageFactory.initElements` works because `@FindBy(xpath=...)` is platform-agnostic.
Content-desc naming convention: `<screen>_<element>_<type>`, e.g. `onBoardingScreen_loginOrSignUp_btn`,
`otpScreen_subHeader_txt`, `checkout_btn`, `promoCode_txtField`, `bottomBar_home_btn`. A handful of
elements use `@FindBy(id = "...")` where a raw RN-leftover id still exists (e.g. `cart_screen_container`).

**iOS** — mixed: `@FindBy(id = "...")` (accessibility id, most common for stable elements),
`@FindBy(name = "...")` (accessibility label), `@FindBy(xpath = "...")` for static text labels,
bilingual OR-conditions, and positional indices. No `iOSNsPredicate`/`iOSClassChain` `@FindBy` in
screen classes (that style lives in `IosTestsExecutionHelper` for one generic lookup helper only).

**Bilingual (EN/AR) elements** — bake both labels into one xpath rather than maintaining two locators:
```java
@FindBy(xpath = "//XCUIElementTypeStaticText[@name='Cart' or @name='السلة']")
```
Use this pattern for any new element whose accessible name is not locale-invariant (i.e. not an
internal test-id like `checkoutScreen_placeOrderBtn`, which is constant across locales).

**Dynamic/templated locators** — declare a plain `String` format field (not `@FindBy`), resolve at
runtime, and wait explicitly:
```java
String categoryCardXpathSelector = "//android.view.View[@content-desc='%s']";
...
WebElement el = wait.until(ExpectedConditions.visibilityOfElementLocated(
    By.xpath(String.format(categoryCardXpathSelector, categoryId))));
```
**Preserve pre-existing typos/quirks verbatim when reusing a selector** — e.g. iOS
`categoryNameSelector = "cateogry_%s_name"` (real typo, matches the live app) and a stray embedded
`"\n"` inside one iOS checkout xpath literal. These are working selectors, not bugs to "fix" without
verifying against the live app.

**Pay/fintech surfaces on Android — Compose reports its nodes as INVISIBLE (durable finding, corrected
2026-07-29).** Android Pay *looks* like an opaque ComposeView with zero locators: with Appium's default
settings the whole content area is one childless `android.view.View` and the page source is ~31 nodes. That
is a **tooling artifact, not an app limitation.** Jetpack Compose marks these nodes invisible, and
UiAutomator2 filters invisible nodes by default. Turn the filter off and the full tree appears:

```java
androidDriver.setSetting(Setting.ALLOW_INVISIBLE_ELEMENTS, true);   // ← the one that matters
androidDriver.setSetting(Setting.IGNORE_UNIMPORTANT_VIEWS, false);  // ← adds the nested TextViews
```

Measured on Samsung Galaxy S23 / Android 13, Pay home, 2026-07-29: defaults **31–35 nodes / 0 perk cards** →
`allowInvisibleElements` alone **72 nodes / 2 perk cards** → both settings **140 nodes / 2 perk cards**, with
`resource-id`, `content-desc` and `text` all populated. **Set these before concluding that any Compose
surface "exposes nothing"** — an entire story's Android coverage was written off on that mistaken premise
(B10-56652), and a bug was filed and retracted over it.

Scope the settings to the screen that needs them (`AndroidNativePayScreen.enableComposeAccessibilityTree()`)
rather than globally in `BaseTest` — `allowInvisibleElements` changes what `findElements` returns everywhere,
so a global flip can silently alter other suites' negative assertions.

**The Pay-access OTP gate is CONDITIONAL — never enter it unconditionally.** After the passcode, Breadfast
Pay challenges for a 4-digit code (= the **last 4 digits of the account's own phone number**, so it is
derived, never fetched from a channel) **only when the device id has changed**. On a device the account has
already been trusted on, the passcode leads straight to Pay home and the screen never appears — an
unconditional `enterOtp` there hangs and then fails. Every BrowserStack session is a new device so the gate
does appear in CI; a re-used local device is where it does not. Use the `...IfDisplayed` convention
(`AndroidNativePayOtpScreen.enterOtpIfDisplayed` / `IosNativePayOtpScreen.enterOtpIfDisplayed`). The same
applies to the "Save card for a faster checkout" interstitial and the "Introducing Breadfast Card" promo —
both are conditional dismissals.

**Nothing on the Pay surface is genuinely opaque — corrected 2026-07-29 (second pass).** An earlier
version of this section said the Android **passcode gate** stayed un-addressable "even with both settings"
and had to be driven by a coordinate keypad map. **That was wrong, and it was wrong for the same reason
twice: the dumps it rested on were captured BEFORE the settings were applied.** With
`allowInvisibleElements` on, the gate exposes 53 nodes and every keypad digit is a clickable
`android.view.ViewGroup` whose `content-desc` is the digit itself
(`evidence/android-en-04-pay-gate.xml`, B10-56652). The Pay-access OTP screen likewise exposes
`Verify your mobile number` and a focused `android.widget.EditText`.

**Check the capture date of any dump before concluding a screen exposes nothing.** The coordinate map that
this false conclusion produced was captured on a 1080x2340 device, and silently missed every key on the
1440x3088 Galaxy S22 Ultra the suite actually runs on — the passcode was never entered and the test failed
15s later on an unrelated-looking wait. Locators are device-independent; coordinates are not. Reach for a
coordinate tap only after re-reading the page source **with the settings applied**.

---

## 3. Synchronization / wait strategy

- Every interaction goes through the shared `wait` field: `wait.until(ExpectedConditions.<visibilityOf
  | invisibilityOf | elementToBeClickable | attributeToBe | visibilityOfElementLocated |
  invisibilityOfElementLocated>(...))`.
- `attributeToBe(element, "enabled", "true")` is the idiom for "wait until this button becomes
  clickable" (used repeatedly in OTP/create-account screens).
- **iOS retry-with-recursion pattern** worth reusing for any "tap and expect navigation" button:
  `IosNativePhoneNumberScreen.pressNextBtn(int retryCounterInitialValue)` clicks, waits for
  invisibility, and on timeout recursively retries up to `getMaxRetries()` (3) before rethrowing.
- **Anti-patterns found — do not copy into new code:**
  - `AndroidPasscodeScreen` — hardcoded `Thread.sleep(2000)` between keypad digit taps.
  - `IosNativeFoodAggregatorHomeScreen.waitForDeliveryFeeToBeVisible()` — `Thread.sleep(500)` inside a
    manual retry loop.
  - Both are isolated, not the house style — the house style is always an explicit `wait.until(...)`.

**Scroll-to-element** — the canonical, heavily reused utility on both platforms:
`AndroidTestsExecutionHelper.scrollUntilACertainElementIsFound(driver, scrollView, direction,
elementSelector)` / `IosTestsExecutionHelper.scrollUntilACertainElementIsFound(driver, direction,
scrollView, elementSelector)`. Auto-detects selector type via a prefix convention (`id=`, `xpath=`,
`content-desc=`/`name=`, `accessibility-id=`), uses `mobile: scrollGesture`/`mobile: scroll` under a
multi-minute hard timeout, and checks edge-partial-visibility so it keeps scrolling even if an element
is technically visible but clipped. **Any new screen needing "scroll until visible" should expose a
`getScrollableContentContainer()` (`By.xpath("//...ScrollView")`) + a selector string, then call this
helper — never reimplement scroll logic in a new page object.**

---

## 4. Method conventions (both platforms)

- **Naming**: verb-first — `press*`/`click*` (actions), `enter*` (text input), `get*` (getters),
  `is*Displayed()`/`is*Hidden()`/`is*Enabled()` (boolean state checks). Nearly every screen has an
  `isPageDisplayed()` "did we land here" method — add one to any new screen.
- **Return types**: **no fluent chaining, ever.** Actions return `void`; queries return
  `boolean`/`String`/`WebElement`. Navigation to the next screen is implicit — the caller (test class
  or execution helper) separately fetches the next screen's `ThreadLocal` from `BaseTest`.
- iOS has some legacy `PascalCase` method names in `IosNativeCheckoutScreen` (`PressScheduleBtn()`) —
  inconsistent with the camelCase house style; **use camelCase for new methods.**

---

## 5. Reusable cross-test workflows — use these, don't rewrite them

Orchestrated by `AndroidNativeTestsExecutionHelper`/`IosNativeTestsExecutionHelper` (each `extends`
the equivalent RN-build helper for shared low-level utilities like scroll-to-element):

1. **Login** — `login(TestData, TestExecutionHelper, <PhoneNumberScreen>, <PhoneCountrySelectionDropdownScreen>, <OtpVerificationScreen>, String phoneCountry)`. Branches on `phoneCountry` (`EG`/`KSA` = local, else foreign via a private `changeCountry`), then delegates to a private `enterPhoneNumberAndOTP`. **This exact call is the single most-reused workflow in the whole native build** — used verbatim in `LoginTests`, `PlaceOrderTests`, `DeleteAccountTests`, food-aggregator tests, etc.
2. **Phone + OTP entry loop** (private `enterPhoneNumberAndOTP`) — enters the phone number, then loops `while (otpScreen.isPageDisplayed())` calling `testExecutionHelper.otpFactory.fetchOtp(testData, method, user)` and entering the OTP until the screen dismisses or fetch throws. **Reuse this poll-until-dismissed pattern for any new OTP-gated screen.**
3. **Marketing A/B-testing guard** — `handleMarketingABTestingForLandingPageIfPresent(landingScreen, phoneNumberScreen, homeScreen, moreScreen, skipOnboardingScreen, mode)`. Called at the **start of nearly every test**, right after country selection and before pressing the auth button — detects an A/B variant that skipped the landing screen and self-heals navigation for `"guest"` vs `"authenticated"` mode (`Assert.fail`s with a descriptive message if it can't recover). **Any new test starting from onboarding/landing must call this.**
4. **Logout** — `logoutAndGoToPhoneInputScreen(driver, homeScreen, moreScreen)` — More tab → scroll to logout → press → assert home → More → Continue (back to phone input).
5. **Add-to-cart → checkout → place-order chain** — a fixed idiom repeated across order tests (not yet extracted into one helper method — do so if you're adding a new place-order test, to avoid the current 5+×-duplicated ~15-line block):
   `HomeScreen → CategoryDetailsScreen.pressSubCategoryById → pressAddToCartBtnByProductId → pressCartBtn → CartScreen.pressGoToCheckoutBtn → CheckoutScreen.press<PaymentMethod> → pressPlaceOrderBtn → OrderDetailsScreen/OrderSuccessScreen.isPageDisplayed()`.
   Android additionally has `handleProductCustomizationIfDisplayed(driver, customizedProductScreen)` for the optional customization sheet after add-to-cart.
6. **Food-aggregator flow** — `<Android|Ios>NativeAggregatorTestsExecutionHelper` (`helpers/mobileTestsExecutionHelpers/{android,ios}/`): home → restaurants entry point → restaurant card → add to cart → cart → checkout → (card or COD) → order success.
7. **Delete-account flow** — More → Account Settings → Delete Account tab → select reason → scroll to + press continue → verify mobile number → OTP via `new OtpFactory(configs).enterOtpInTextField(otpField, testData, "deleteAccount", user)` (a **different** OTP entry path than login — writes directly into a passed `WebElement`) → accept terms → delete → success screen.

**Universal data-setup pattern — prefer this over UI registration for any new test:**
register the user **via API** (`testExecutionHelper.get().registerUsingApi(testData, user)`) and
create the address **via API** (`createAddressUsingApi(warehouse, user)`), then drive only the
flow-under-test through the UI. Every sampled test class does this; only `RegisterTests` itself
exercises registration through the UI.

---

## 6. Test class conventions

- `extends base.BaseTest`; package `customerApp.{androidNative,iosNative}.<featureArea>` (lowercase
  folder: `authentication`, `homePage`, `morePage`, `placingOrder`, `foodAggregators`,
  `regressionSuite`).
- Driver/page-object access is **always** `<field>.get()` — never a raw field — because `BaseTest`
  declares everything `protected static ThreadLocal<T>` for `parallel="methods"` safety.
- `@Test(groups = {...})` — observed groups: `smoke`, `growthsmoke`, `place-order`,
  `aggregators-smoke`, `aggregators-regression`, `mobile-shopping`, `food-aggregator`,
  `delivery-capacity-management`, plus story-id groups (`B10-xxxxx`) elsewhere in the framework.
- Allure `@Tags({@Tag("customer-app-native"), @Tag("android"|"ios"), <feature tags>})` directly above
  `@Test` on every method — always include the platform tag + `customer-app-native`.
- Assertions: plain TestNG `org.testng.Assert` (`assertTrue`/`assertEquals`/`fail`), never
  Hamcrest/AssertJ. **Prefer including a descriptive message** as the 2nd/3rd arg — newer tests do,
  some older ones don't; match the newer style for new code.
- No custom step annotations exist (`@Step` etc.) — reporting granularity comes from Allure's TestNG
  listener plus the `@Tags` above.

---

## 7. Wiring a new screen/test into the framework (mandatory, no auto-discovery)

There is no DI/reflection magic — a new page object or test class must be manually registered:

1. **New page object** → add to `D:\projects\src\test\java\base\BaseTest.java`:
   - Declare `protected static ThreadLocal<NewScreen> newScreen = new ThreadLocal<>();` in the field
     block (androidNative fields cluster ~line 273-311; iosNative ~line 429-469).
   - Initialize it inside `setup()` alongside the other same-platform screens, **after** the driver is
     built: `newScreen.set(new NewScreen(androidDriver.get()));` (Android) or
     `new NewScreen(iosDriver.get())` (iOS) — Android's block is ~line 949-985, iOS's is past 660 by
     the same pattern.
   - Add an import if the new screen lives in a package not already wildcard-imported.
2. **New test class** → add a `<class name="customerApp.androidNative.<package>.<ClassName>"/>` (or
   `iosNative`) entry under the matching `<test name="CustomerAppNative_Android">` /
   `"CustomerAppNative_iOS"` block in `D:\projects\mobileng.xml` — there is no annotation-based
   auto-registration into the suite.

## Naming / folder placement for a new screen

| | Android | iOS |
|---|---|---|
| Class name | `AndroidNative<Feature>Screen` (suffix `Modal`/`Popup` for overlays) | `IosNative<Feature>Screen` |
| Package | `modals.customerApp.androidNative` flat, OR a feature sub-package (`androidNativeHomePage`, `androidNativeCheckoutPage`, `AndroidNativeMoreScreen` + its nested `AndroidNativeAddressManagementScreens`/`AndroidNativeDeleteAccountScreens`, `foodAggregator`) | `modals.customerApp.iosNative` flat, OR `iosNativeHomePage`, `iosNativeMorePage` (+ nested `iosNativeDeleteAccountScreens`), `iosNativeCheckoutPage`, `iosNativePayScreen`, `foodAggregator` |
| Rule of thumb | Sub-package only if 2+ screens already share a feature area; a brand-new isolated screen goes in the existing area's sub-package, a new feature area gets its own new sub-package | Same rule; sub-packaging is not 100% consistent today (e.g. `IosNativeAddCardInfoScreen` sits flat despite being pay-related) — don't over-index on precedent when it's inconsistent, use judgment |

---

## 8. Shared infra new automation plugs into

- **`BaseTest.java`** (`src/test/java/base/BaseTest.java`) — the fixture root. `@BeforeMethod
  setup()` reads `Configs`, applies per-test-tag overrides (`ConfigurationsManagementHelper`), builds
  `TestData`, conditionally builds card/food-aggregator/warehouse test sessions, starts the Appium
  server + builds the platform driver via `MobileDriversFactory` (only if
  `configs.getMobileBuildEnabled() && get<Platform>BuildEnabled()`), then constructs **every** screen
  object for that platform. `@AfterMethod tearDown()` handles recordings, BrowserStack session
  close/reporting, emulator/simulator teardown, DB close, and (prod-env only) phone-number pool reset.
- **`MobileDriversFactory`** (`helpers/factories/MobileDriversFactory.java`) — switches on
  `Configs.getTargetApp()` (a plain string: `"customerAppNative"` selects the native build) to build
  Android/iOS drivers with the right app id/bundle/build-number from `Configs`, and dispatches remote
  provider (BrowserStack/LambdaTest) capability-building via `buildExternalMobileDriverOptions`. Also
  owns local emulator/simulator lifecycle for non-remote runs.
- **`Configs`** (`models/Configs.java`, 435 fields) — the native-mobile-relevant subset: `targetApp`,
  `targetAppBundleId` (iOS), device matrix (`android/iOSDeviceName`, `android/iosPlatformVersion`),
  BrowserStack native app ids/build numbers (`bStack{Android,Ios}CustomerAppNativeAppId`/
  `…BuildNumber`), card/fintech fields (`cardUserMobileNumber`, `defaultCardPasscode`, etc.), card DB
  connection string. **No app-type or locale enum exists** — everything is string-typed with `switch`
  dispatch (`targetApp`, `testCountryCode`, `phoneCountry` params); don't invent an enum, follow the
  string convention.
- **OTP** — `OtpFactory.fetchOtp(testData, method, user)`
  (`helpers/factories/dataFactories/OtpFactory.java`): DB-first (queries
  `bf_phone_otp_verification`, or `bf_usermeta`/`bf_breadfast_customers` for the `"deleteAccount"`
  method, if `testData.getDbConnection()` is set), else falls back to
  `SlackApiClient.findMessageForOTP` (polls Slack search every 2s for up to 30s). **Always call this
  via `testExecutionHelper.get().otpFactory` — never re-implement Slack/DB polling.**
- **Data factories** — `UserDataFactory` (random user/phone/email/national-ID generation, EG/KSA
  phone-company prefixes, production-number pool), `CustomerAppTestSessionFactory` (picks
  category/subcategory/product combos for a given scenario need from the pre-fetched warehouse tree —
  consumed via `TestExecutionHelper.buildCustomerAppWarehousesTestData`, not called directly by tests).
  `CustomerAppTestSession` is deep-copied per test from a suite-level fetch to avoid rebuilding
  category/product data every run.
- **Card/fintech connection points** — `CardServiceApiClient` (always instantiated),
  `EncryptionHelper`/`BCardTestsExecutionHelper` (only when `Configs.isCardServicesTestsEnabled()`),
  a separate card-services DB connection off `Configs.getCardServicesDatabaseConnectionString()`. The
  native Pay page objects (`AndroidPasscodeScreen`, `IosNativePayScreen`) are the UI entry points these
  connect to.

---

## 9. Checklist for generating new androidNative/iosNative automation

1. Grep `modals/customerApp/{androidNative,iosNative}` and the matching test packages for an existing
   screen/test covering the same or an adjacent flow — extend/reuse before writing new.
2. New screen: base-class skeleton (§1), locator convention matching the platform (§2), method-naming
   convention (§4) — no fluent chaining, add `isPageDisplayed()`.
3. Reuse the login/OTP/A-B-guard/scroll/checkout helpers (§5) — do not re-implement any of them.
4. Register the new screen in `BaseTest.java` (ThreadLocal field + init) and the new test class in
   `mobileng.xml` (§7) — both are manual, unregistered code will compile but be `null`/never-run.
5. Tag the test method with TestNG `groups` + Allure `@Tags` matching §6's convention.
6. Prefer API-based user/address setup + UI-only for the flow under test (§5), unless the story is
   specifically about registration/onboarding itself.
7. Flag, don't copy, the known anti-patterns: `Thread.sleep`, PascalCase method names, brittle
   Pay-screen locators — these are pre-existing debt, not the style to extend.
