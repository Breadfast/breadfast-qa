# Module — Customer App (iOS Native / Android Native)

> The consumer Breadfast app — **org-wide**: every team that tests it shares this page. Product-specific
> journeys and quirks (each product's own screens and flows) live in each team's **domain** and reach a session only
> through its knowledge plan (`node qa-workflow/bin/qa-cli.js knowledge`).

## Purpose
The consumer-facing mobile app where users shop and use Breadfast's in-app services, on iOS and Android, in EN and AR.

## Platforms
- iOS Native — iPhone 14 / iOS 18, automation `XCUITest`.
- Android Native — Samsung Galaxy S23 / Android 13, automation `UiAutomator2`.

## Shared journeys
1. **Auth** — phone OTP login → home. In test the login OTP arrives in the **Google Chat `#testing-otp`** space;
   the framework's `OtpFactory` reads it (`GoogleChatApiClient.findMessageForOTP`).
   `[outdated: the Slack #testing-otp channel — silent since 2026-06-24, retired]`.
   A 6-digit passcode gates sensitive flows.

## Testing considerations
- Default mobile scope: iOS + Android × EN + AR (4 combos) unless the story narrows it (org rule, CLAUDE.md).
- Arabic: RTL layout, Arabic-Indic numpad, real Arabic labels, registration button `إنشاء حساب` (no `ال`).
- Arabic run caps: `appium:language: ar`, `appium:locale: EG` — top-level, never in `bstack:options`.
- Custom keypads and bottom-sheet modals are common; product-specific taps are in your domain's mobile flows.

## Automation entry points
Mobile automation is raw WebDriver via [bs_helper.js](../../../bs_helper.js) (catalog: [../automation/appium-framework.md](../automation/appium-framework.md)). A formal Appium POM for the native apps does not exist yet — it is a gap to build when native automation is prioritized.

## Java framework assets (`QA_FRAMEWORK_PATH`)

The native Java/Appium framework is the primary automation for this module. See [../automation/java-framework.md](../automation/java-framework.md) for the full catalog. **`androidNative`/`iosNative` = current fully-native build; `android`/`ios` = legacy React Native build** (selected in `MobileDriversFactory` via `customerAppNative` vs `customerAppReactNative`).

**Page objects (modals)** — `src/main/java/modals/customerApp/`
- `androidNative/`, `iosNative/` — native build: landing/onboarding, phone+OTP+register, home/carousel/supermarket/collections, product+customization, cart/checkout/order-success, more/account/address/delete-account, pay (`IosNativePayScreen`, `AndroidPasscodeScreen`), `foodAggregator/*`.
- `android/`, `ios/` — RN build: home (`androidHomePage`/`iosHomePage`), checkout, create-address, more screens, Android pay page (`androidPayPage/*`), permission alerts.

**API clients** — `src/main/java/helpers/apiClients/mobileApiClients/`
- `MobileAuthorizationApiClient` (OTP/register/login/user), `OrderApiClient`, `OrderPaymentApiClient`, `CheckoutApiClient`, `AddressApiClient`, `DeleteAccountApiClient`, `ShopsApiClient`, `OptionSetsApiClient`, `MobilePayServicesApiClient`, `foodAggregatorApiClients/*`.

**Models** — `src/main/java/models/`: `User`, `Order`, `OrderPaymentTransactions`, `Address`, `Area`, `Product`, `Category`, `Options`, `OptionSets`, `Shop`, `Coupon`, `Bill`, `Timeslot`, `CustomerAppTestSession`, `CustomerAppShopsTestSession`, `FoodAggregatorTestSession`, `Restaurant`/`RestaurantCatalog`.

**Test suites** — `src/test/java/customerApp/` (123 classes): `androidNative/*`, `iosNative/*` (authentication, homePage, morePage, placingOrder, foodAggregators, regressionSuite), `android/*` & `ios/*` (incl. `chatbot`), `api/*` (create-order/customization/referrals/payments/apple-pay/food-aggregator/shops), `web/*`, `database/*`. Native regression suite: `mobileng.xml`.

**Helpers**: `AndroidNativeTestsExecutionHelper`, `IosNativeTestsExecutionHelper`, `AndroidTestsExecutionHelper`, `IosTestsExecutionHelper`, `mobileTestsExecutionHelpers/{android,ios}/*NativeAggregatorTestsExecutionHelper`; data factories under `factories/dataFactories/customerAppDataFactories/*` and `testSessionsDataFactories/*`.
