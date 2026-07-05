# Module — Customer App (iOS Native / Android Native)

> The consumer Breadfast app. Living document — expand as stories touch new areas.

## Purpose
The consumer-facing mobile app where users shop and use Breadfast Pay + the Breadfast Card. QA scope on this project centers on **auth**, **Pay home**, and the **card application & activation** journeys, on iOS and Android, in EN and AR.

## Platforms
- iOS Native — iPhone 14 / iOS 18, automation `XCUITest`.
- Android Native — Samsung Galaxy S23 / Android 13, automation `UiAutomator2`.

## Primary user journeys
1. **Auth** — phone OTP login (OTP from Slack `#testing-otp` in test) → home. 6-digit passcode gates sensitive flows.
2. **Pay home** — Wallet Balance, card widget ("Breadfast Card is out!" / "Get started" / "ابدأ الآن"), application/activation stepper, Card Perks list. **All Pay-screen interactions use coordinate taps** (see [../browserstack-process.md](../browserstack-process.md) §4.1).
3. **Card application** (3 steps) — Verify mobile (OTP 1/3) → ID info (name/NID/expiry 2/3) → Complete setup / Create passcode (3/3) → Congratulations.
4. **Pick up** — choose pickup location (map).
5. **Card activation** (2 steps) — BCID entry (1/2) → Set PIN (2/2) → Success → card active.

## Key screens & expected copy
See the full per-screen EN copy table and flow frames in [figma_full_flow_reference.md](../../figma_full_flow_reference.md). Highlights: Pay Home "Breadfast Card is out!"; Card App Intro "Apply for your card"; OTP "Verify your mobile number" (1/3); ID "Enter your ID information" (2/3); Passcode intro "Complete card setup" (3/3); BCID "Activate your card" (1/2); PIN "Set a PIN" (2/2). PIN = 4 dots, passcode = 6 dots.

## Dependencies
- Card Service backend (perks, cashback, card status) — [card-service.md](card-service.md).
- Backend status change `registered → received` is a precondition for activation testing.
- Slack `#testing-otp` for login OTPs.

## Testing considerations
- Full 4-combo coverage (iOS/Android × EN/AR) + Figma comparison per screen.
- Arabic: RTL layout, Arabic-Indic numpad, real Arabic labels, registration button `إنشاء حساب`.
- Custom passcode/PIN keypads; bottom-sheet modals (e.g. balance-moving modal, "Got it" at (195,810)).
- WebView PIN step often fails in BrowserStack — environment limitation, not a bug.

## Regression considerations
Any change to auth, Pay home, or the card flow triggers the regression playbook ([../regression-strategy.md](../regression-strategy.md) §5).

## Automation entry points
Mobile automation is raw WebDriver via [bs_helper.js](../../bs_helper.js) (catalog: [../automation/appium-framework.md](../automation/appium-framework.md)). A formal Appium POM for the native apps does not exist yet — it is a gap to build when native automation is prioritized.

## Java framework assets (`D:\projects`)

The native Java/Appium framework is the primary automation for this module. See [../automation/java-framework.md](../automation/java-framework.md) for the full catalog. **`androidNative`/`iosNative` = current fully-native build; `android`/`ios` = legacy React Native build** (selected in `MobileDriversFactory` via `customerAppNative` vs `customerAppReactNative`).

**Page objects (modals)** — `src/main/java/modals/customerApp/`
- `androidNative/`, `iosNative/` — native build: landing/onboarding, phone+OTP+register, home/carousel/supermarket/collections, product+customization, cart/checkout/order-success, more/account/address/delete-account, pay (`IosNativePayScreen`, `AndroidPasscodeScreen`), `foodAggregator/*`.
- `android/`, `ios/` — RN build: home (`androidHomePage`/`iosHomePage`), checkout, create-address, more screens, Android pay page (`androidPayPage/*`), permission alerts.

**API clients** — `src/main/java/helpers/apiClients/mobileApiClients/`
- `MobileAuthorizationApiClient` (OTP/register/login/user), `OrderApiClient`, `OrderPaymentApiClient`, `CheckoutApiClient`, `AddressApiClient`, `DeleteAccountApiClient`, `ShopsApiClient`, `OptionSetsApiClient`, `MobilePayServicesApiClient`, `foodAggregatorApiClients/*`.

**Models** — `src/main/java/models/`: `User`, `Order`, `OrderPaymentTransactions`, `Address`, `Area`, `Product`, `Category`, `Options`, `OptionSets`, `Shop`, `Coupon`, `Bill`, `Timeslot`, `CustomerAppTestSession`, `CustomerAppShopsTestSession`, `FoodAggregatorTestSession`, `Restaurant`/`RestaurantCatalog`.

**Test suites** — `src/test/java/customerApp/` (123 classes): `androidNative/*`, `iosNative/*` (authentication, homePage, morePage, placingOrder, foodAggregators, regressionSuite), `android/*` & `ios/*` (incl. `chatbot`), `api/*` (create-order/customization/referrals/payments/apple-pay/food-aggregator/shops), `web/*`, `database/*`. Native regression suite: `mobileng.xml`.

**Helpers**: `AndroidNativeTestsExecutionHelper`, `IosNativeTestsExecutionHelper`, `AndroidTestsExecutionHelper`, `IosTestsExecutionHelper`, `mobileTestsExecutionHelpers/{android,ios}/*NativeAggregatorTestsExecutionHelper`; data factories under `factories/dataFactories/customerAppDataFactories/*` and `testSessionsDataFactories/*`.
