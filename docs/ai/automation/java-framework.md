# Java QA Framework (`D:\projects`) — Canonical Reference

> The **primary/native** Breadfast automation framework. Java + Maven + Appium + Selenium + REST-assured + TestNG, run on **BrowserStack** and **LambdaTest HyperExecute**.
> Maven coordinates: `org.breadfast:QA_Framework:1.0-SNAPSHOT`. Location: `D:\projects`.
> This is the single source of truth for environment config — the in-repo Playwright JS framework (`automation/`) reads this framework's `resources/environments/config_testing.properties` via its `PropertiesReader`. See [reusable-components.md](reusable-components.md).

Counts (real, from the tree): **663 `.java` files**, **30 API client classes**, **50 domain model classes**, **~250 page-object (modal) classes across 10 modules**, **~230 test classes across 21 test packages**, **39 role validators**, **17 TestNG suite XMLs**.

---

## 1. Tech stack (from `pom.xml`)

| Concern | Tech / version |
|---|---|
| Language / build | Java **25** (`maven.compiler.source/target=25`), Maven |
| Mobile automation | Appium java-client **10.0.0** (UiAutomator2 / XCUITest) |
| Web automation | Selenium **4.35.0** |
| API testing | REST-assured **5.5.6** |
| Test runner | TestNG **7.11.0** |
| JSON | Jackson **2.19.2** |
| Reporting | Allure **2.30.0** (`allure-maven` 2.16.1, AspectJ weaver 1.9.24) |
| Quality gate | maven-checkstyle-plugin **3.6.0** (`checkstyle.xml` + `checkstyle-suppressions.xml`, runs at `validate`, fails build) |
| Test exec | maven-surefire-plugin **3.5.4** (multi `suiteXmlFile`) |

Surefire default `suiteXmlFiles`: `testng.xml, sanityng.xml, stressng.xml, fintechng.xml, supplychainng.xml, fleetappng.xml, referralsng.xml, mobileng.xml, pricingng.xml`. A `full-tests` profile sets `<groups>smoke</groups>`.

---

## 2. Architecture map

```
D:\projects
├─ pom.xml, checkstyle.xml, checkstyle-suppressions.xml
├─ *.xml (TestNG suites), hyperexecute.yaml, CLAUDE.md (framework's own 130 KB manual)
├─ resources/environments/   ← config_testing, cardServiceConfigs_testing, browserStackConfigs,
│                               webConfig, iPhone_14, Pixel_2 (+ *.example, encryption pub key, ssh key)
└─ src/
   ├─ main/java/
   │  ├─ helpers/      ← apiClients, apiValidator, dataParsers, dataProviders,
   │  │                   factories(+dataFactories,+listeners), mobileTestsExecutionHelpers(android/ios),
   │  │                   rolesValidators, stress, + top-level helper classes
   │  ├─ modals/       ← page objects, grouped by app/portal (see §4)
   │  └─ models/       ← 50 POJO domain models (see §6)
   └─ test/java/
      ├─ base/BaseTest.java   ← ThreadLocal-based shared fixture root
      └─ <module packages>    ← test suites by module (see §8)
```

**Pattern:** Page-Object (`modals`) + REST API clients (`helpers/apiClients`) + POJO `models` parsed by `dataParsers`, all assembled in `BaseTest` via `ThreadLocal<>` for parallel safety. Most API clients `extend BaseHelper` and take a `Configs` in the constructor.

---

## 3. android vs androidNative (and ios vs iosNative)

**This is a build-generation split, not a layout split.**

- `modals/customerApp/android` + `ios` → page objects for the **legacy React Native** customer app build. Driven by BrowserStack app id key `bStackAndroidCustomerAppReactNativeApp` / `bStackIosCustomerAppReactNativeApp`; selected in `MobileDriversFactory` via the `customerAppReactNative` case (`projectName = "CustomerApp - ReactNative Android/iOS"`). Locators tend to be text/xpath based (e.g. `//android.widget.TextView[@text='Explore Breadfast']`).
- `modals/customerApp/androidNative` + `iosNative` → page objects for the **new fully-native rebuild** of the customer app. Driven by `bStackAndroidCustomerAppNativeApp` / `bStackIosCustomerAppNativeApp`; selected via the `customerAppNative` case. Locators use stable accessibility ids / `content-desc` (e.g. `@content-desc='onBoardingScreen_loginOrSignUp_btn'`).

`MobileDriversFactory` switches on app type: supported values are `customerAppReactNative`, `customerAppNative`, `midMileApp`, `fleetApp`. Tests live in matching `src/test/java/customerApp/{android,ios}` (RN) vs `{androidNative,iosNative}` (native) packages. The active native suite (`mobileng.xml`) targets `androidNative` / `iosNative`.

> **Generating new androidNative/iosNative automation?** Use [mobile-native-framework.md](mobile-native-framework.md) — a deep, implementation-level reference (base-class contracts, locator/method conventions, reusable login/OTP/scroll/checkout workflows, and the manual wiring steps into `BaseTest`/`mobileng.xml`) built specifically so new automation fits in without duplicating the existing ~250 page objects / ~230 test classes.

---

## 4. Page-Object (modals) catalog

Base classes: `BaseAndroidScreen`, (iOS equivalent) — each constructor calls `PageFactory.initElements(driver, this)` and exposes a `wait`.

### customerApp — Native build (current) — `modals/customerApp/{androidNative,iosNative}`
| Area | Representative screen classes |
|---|---|
| Onboarding / auth | `*NativeLandingScreen`, `*NativeSkipOnboardingScreen`, `*NativePhoneNumberScreen`, `*NativePhoneCountrySelectionDropdownScreen`, `*NativeCountriesSelectionScreen`, `*NativeOtpVerificationScreen`, `*NativeCreateAccountScreen`, `*NativeRegisterSuccessScreen`, `*NativeChangeCountryModalScreen` |
| Home / shop | `*NativeHomeScreen`, `*NativeCarouselScreen` (Android), `*NativeSupermarketLandingScreen`, `*NativeCollectionDetailsScreen`, `*NativeCategoriesDetailsScreen`/`*NativeCategoryDetailsScreen`, `*NativePromosScreen`, `*NativeRateOrderPopup` |
| Product | `*NativeProductScreen`, `*NativeInternalCustomizedProductScreen`, `IosNativeUpdateCustomizedProductScreen`, `IosNativeRemoveCustomizedItemsScreen`, `*NativeSearchScreen`/`IosNativeSearchForProductsScreen`, `*NativeFavouriteScreen` |
| Cart / checkout | `*NativeCartScreen`, `*NativeCheckoutScreen`, `IosNativeOrderSuccessScreen`, `*NativeOrderDetailsScreen`, `IosNativeAddCardInfoScreen`, `IosNativeSavedCardsScreen` |
| More / account | `*NativeMoreScreen`, `*NativeAccountSettingsScreen`, `*NativePersonalInfoScreen`, `*NativeEmailAddressScreen`, `*Native(Saved)AddressScreen`/`*NativeAddressDetailsScreen`, `IosNativeActivityHistoryScreen`, delete-account screens (`*NativeDeleteAccountScreen`, `*NativeDeleteAccountOTPVerificationScreen`, `IosNativeDeleteSuccessScreen`) |
| Pay / fintech | `IosNativePayScreen`, `AndroidPasscodeScreen` |
| Chatbot | `*NativeChatBotScreen` |
| Food aggregator | `*NativeFoodAggregatorHomeScreen`, `*NativeFoodAggregatorRestaurantDetailsScreen` |

### customerApp — React Native build (legacy) — `modals/customerApp/{android,ios}`
| Area | Representative screen classes |
|---|---|
| Onboarding / auth | `*LandingScreen`, `*PhoneNumberScreen`, `*CountriesListScreen`, `*CountriesSelectionScreen`, `*OTPVerificationScreen`, `*CreateAccountScreen`, `*RegisterSuccessScreen` |
| Home | `androidHomePage`/`iosHomePage`: `*HomeScreen`, `*AddressSelectionScreen`, `*NowAndTomorrowModal`, `*OpenedBannerModalScreen`, `*Recommendation(s)Screen`, `*ReferralScreen`, `AndroidBusyModalScreen` |
| Product / search | `*CategoryScreen`, `*ProductScreen`, `*SearchScreen`, `AndroidSearchResultScreen`, `*CardSelectionModal` |
| Checkout | `androidCheckoutScreens`/`iosCheckoutScreen`: `*CartScreen`, `*CheckoutScreen`, `*OrderSuccessScreen`, `*OrderDetailsScreen` |
| Address | `androidCreateAddressScreens`/`ios…CreateAddressScreens`: `*CreateAddressScreen`, `*AddressCreateSuccessModal`, `*SetAddressScreen`, manage-address modals (`*MyAddressesScreen`, delete/disabled-location modals) |
| Account settings | `*AccountSettingsScreen/Page`, update personal info + phone-OTP, delete-account flow (`*DeleteAccountScreen`, `*DeleteRequestScreen`, `*VerifyDeleteAccountScreen`, `*DeleteAccountOTPVerificationScreen`) |
| More | `androidMoreScreen`/`iosMoreScreen`: `*MoreScreen`, `*ChooseCountryModal`, `*ChooseLanguageModal`, `*Favorites/FavoritesScreen`, `*FreeCreditScreen`, `*BreadfastRewardsScreen`, `*HelpScreen`, `AndroidTalkToUsScreen`, activity history (`*ActivityHistoryScreen`, `*BillsTabScreen`) |
| Pay (Android) | `androidPayPage`: `AndroidPayScreen`, `AndroidBillingCategoryScreen`, `AndroidProviderScreen`, `AndroidInvoiceSummaryScreen`, `AndroidAddCardInfoScreen`, `AndroidSavedCardScreen`, `AndroidPaymentSuccessScreen` |
| Permissions / alerts | `androidPermissionAlerts/AndroidLocationPermissionAlert`, `iosAlerts/IosLocationPermissionAlert`, `IosNotificationsPermissionsAlert`, `IosTrackingPermissionAlert` |
| Chat | `*ChatbotScreen`, `*FreshChatScreen` |

### Other portals / apps
| Module | Package | Classes |
|---|---|---|
| Card admin panel | `modals/cardsAdminPanel` | `CardAdminPanelLoginPage`, `CardPanelDashboard`, `SearchCardsUsers`, `ViewCardUsersDetails`, `EditCustomerDetailsPage`, `SetCardPinPage`, `PerksPage` (B10-56750, branch `feat/b10-56750-selenium-automation` — perks list + Create Perk form + Section dropdown + Add-section modal; **extended B10-57393** with the rest of the Create-perk form — merchant nested-menu picker, Branches/Cashback-processing/Duration descriptions, coupon code + coupon type, cashback consumption limit + interval, readonly end-date picker, and five whole-form fills with `getEntered*()` readbacks; **the fills take no data arguments** — the perk copy, coupon code and `PerkArtwork` set are POM constants, and the four image slots are filled Cover EN / Cover AR / Logo EN / Logo AR from the set's own EN and AR artwork; **outside-merchant support** added 2026-07-27: `selectOutsideMerchantWithAllBranches()` creates H&M through the picker's `+ Add merchant` dialog when the environment lacks it and reuses it after, and `fillValidOutsideMerchantDiscountPerk()` fills a full third-party Discount/coupon perk under the `General Purchases` section), **`AppPreviewModal`** (B10-57393, branch `2026/sprintQ3.3/B10-57393-mobile-app-preview-for-perk-creation` — the "App preview" modal: device-frame measurement, in-frame scrolling, detail sections, tile isolation, EN/AR preview language + RTL, images, "See more", Save/Cancel/X). *Drift note 2026-07-27: previously listed `MerchantPerkCreatePage`/`GeneralCashbackPerkPage` do not exist in the tree (uncommitted B10-55168-era work, since lost).* |
| Main admin portal | `modals/mainAdminPortal` (17) | `LoginPage`, `GoogleLoginPage`, `HomePage`, `ControlRoomV2AdminPage`, `BannersAdminPage`, `BulkDiscountsAdminPage`, `CollectionsAdminPage`, `CategoriesSortingAdminPage`, `CancellationReasonsAdminPage`, `RecommendationsAdminPage`, `PopUpsAdminPage`, `ScheduledOrdersAdminPage`, `SignatureAdminPage`, `AttendanceAdminPage`, `PlanningCenterAdminPage`, `DevlieryCapacityManagementAdminPage`, `SwitcherPage` |
| Chatbot SDK (web) | `modals/chatbotSdk` | `ChatbotSdkHostPage`, `WebChatbotSdk` |
| RMS dashboards | `modals/rmsDashboards` | `RmsLoginPage`, `RestaurantListPage`, `RestaurantDetailsPage`, `CreateRestaurantFromDashboard` |
| WordPress admin | `modals/wordpressAdmin` (28) | WP content/admin page objects |
| Fleet app (Android) | `modals/fleetApp/android` | `AndroidSplashScreen`, `AndroidSideMenuScreen` |
| Mid-mile app/portal | `modals/midMileApp/android`, `modals/midMilePage` | `AndroidLoginPage`, `AndroidActions`, `OrdersPage` |
| Payment | `modals/Payment` | `ApsCcWebPage` (APS credit-card web page) |

---

## 5. API client catalog (`helpers/apiClients`, 30 classes)

Most `extend BaseHelper`, take `Configs` in the constructor, return `models` POJOs or REST-assured `Response`.

### Auth / infra
| Class | Purpose |
|---|---|
| `mobileApiClients/MobileAuthorizationApiClient` | Customer mobile auth: `sendOtpToPhoneNumber`, `verifyOtpRequest`, `registerUserRequest`, `getUserDetails`, `logoutUserRequest` → builds `User` |
| `webApiClients/AdminAuthorizationApiClient` | Admin/RMS auth: `loginAndGetAuthorizationTokens`, `loginAndGetRmsToken`, `getRmsAdminUser/Token`, `callWithRmsRetry` |
| `BrowserstackApiClient` | `postTestResultsToBrowserstack(testcaseIds, status, description)` — test-management sync |
| `SlackApiClient` | `findMessageForOTP(phoneNumber, method)` — fetch login OTP from Slack |
| `YeloApiClient` | Yelo (fleet/dispatch) integration |

### Mobile domain — `mobileApiClients`
| Class | Purpose |
|---|---|
| `OrderApiClient` | Create/cancel/list/sync orders (COD/CC/coupon/tipping/multi-product), Inai callback, order date validation |
| `OrderPaymentApiClient` | Order payment transactions |
| `CheckoutApiClient` | Checkout endpoints |
| `CardServiceApiClient` | **Fintech card service — the ONE client for the whole Card ecosystem, mobile and card admin panel alike** — token, card status, wallet user, passcode/PIN, link/activate/replace card, balance, transaction history, invitation codes, transfers (sender/receiver), card pool, change status, collect card, **and card perks** (read oracles, shape-finders, mark-featured, seed/expire). Every method takes `CardService` last and authenticates with `cardService.getCardServiceToken()`. Do **not** add a second card client or a second card login — the perks split (`CardAdminPanelPerksApiClient`, `loginAndGetJwtToken`) was merged in and deleted on 2026-08-20 |
| `MobilePayServicesApiClient` | Bill-pay / Pay services |
| `AddressApiClient` | Address CRUD |
| `DeleteAccountApiClient` | Account deletion flow |
| `ChatbotApiClient` | `generateChatbotJwt(user)` — chatbot JWT |
| `FreshChatApiClient` | FreshChat conversations/messages |
| `ShopsApiClient`, `OptionSetsApiClient` | Shops + product option sets |
| `KitchenApiClient`, `PickerApiClient`, `StockTakeApiClient`, `MobileWarehousesApiClient` | Ops: kitchen, picker app, stock take, warehouses |
| `FleetAppApiClient`, `MidMileAppApiClient` | Fleet + mid-mile mobile apps |
| `foodAggregatorApiClients/FoodAggregatorCatalogApiClient`, `…/FoodAggregatorRestaurantsApiClient` | Food aggregator catalog + restaurants |

### Web/admin domain — `webApiClients`
| Class | Purpose |
|---|---|
| `ControlRoomV2ApiClient` | Control Room: list warehouses/orders, get/filter orders, pickers app login/status, product stock add, change order status |
| `CatalogProductsApiClient`, `DynamicProductCarouselApiClient` | Catalog products + carousels |
| `CouponsApiClient` | Coupons |
| `InventoryApiClient`, `TransitApiClient` | Inventory + transit |
| `DeliveryCapacityManagementApiClient` | Delivery capacity |
| `PlanningCenterApiClient` | Planning center |
| `PaymentPanelApiClient` | Payment panel |
| `MidMileOrdersApiClient`, `MidMileTrucksApiClient` | Mid-mile orders + trucks |
| `SwitcherApiClient` | Switcher (feature/region) |
| `rmsApiClients/RestaurantsApiClient`, `…/CusinesApiClient` | RMS restaurants + cuisines |

---

## 6. Helper catalog (`helpers/`)

### Top-level helpers
| Class | Purpose |
|---|---|
| `BaseHelper` | Common base (random free-port, date-format conversion, etc.); parent of most API clients |
| `SetUpHelper` | Per-test environment/driver setup |
| `TestExecutionHelper` | Test lifecycle orchestration |
| `ConfigurationsManagementHelper` | `updateConfigsToMatchTestTag(Method)` — mutate `Configs` per test tag |
| `DataHelper` | Test-data assembly/access |
| `EncryptionHelper` | Card-service encryption (uses `cardServiceEncryptionPublicKey.pub`) |
| `AndroidTestsExecutionHelper`, `IosTestsExecutionHelper` | RN-build mobile flow helpers |
| `AndroidNativeTestsExecutionHelper`, `IosNativeTestsExecutionHelper` | Native-build mobile flow helpers |
| `BCardTestsExecutionHelper` | Breadfast card end-to-end flow helper |
| `RestaurantTestsExecutionHelper` | RMS/restaurant flow helper |
| `AppiumMCPHelper` | Appium MCP integration helper |

### Sub-packages
| Package | Contents |
|---|---|
| `factories` | `MobileDriversFactory`, `WebDriversFactory`, `ServerFactory` (Appium server), `DatabaseConnectionFactory`/`Logger`, `WebVideoRecorderFactory`, `RetryAnalyzer`/`RetryListener`, `AllureLogListener`, `TestTypeListeners` |
| `factories/dataFactories` | `UserDataFactory`, `OtpFactory`; `customerAppDataFactories` (Categories/Products/Shops/Warehouses); `fintechDataFactories` (CustomerInfoSheet); `foodAggregatorDataFactories` (BusinessCategories/RestaurantProducts/Restaurants); `testSessionsDataFactories` (ControlRoom/CustomerApp/CustomerAppShops/FoodAggregator/StockTake test-session builders) |
| `factories/listeners` | `BrowserstackSyncListener`, `StressMetricsSuiteListener` |
| `dataParsers` (26) | `BaseDataParser` + per-domain parsers (Address, Area, Batch, BusinessCategory, Categories, Coupon, FleetTrip, FreshChatMessage, OrderPayment, Orders, PaymentCategory/Provider/Service, PlanningCenter, Products, Restaurants, Shop, StockBuckets, Timeslot, Transfer, Trips, Trucks, User, Warehouses) — JSON→`models` POJOs |
| `dataProviders` | TestNG `@DataProvider` sources: `RolesDataProviderSource`, `ThreaderDataProviderSource` (parallel thread counts), `TransferReasonDataProvider`, `UsersChatbotTokensProviderSource` |
| `apiValidator` | `CreateOrderApiValidator`, `GetOrderApiValidator` — response schema/value validation |
| `rolesValidators` (39) | `BaseRolesValidator` + one validator per admin module (Areas, Banners, BulkDiscounts, Cancellation, Categories, Collections, Coupons, Orders, Popups, Posts, Flyers, ScheduledOrders, Signatures, Switcher, PlanningCenter, Recommendations, Referrals, Vodafone, settings groups, …) — RBAC permission assertions |
| `mobileTestsExecutionHelpers/{android,ios}` | `*NativeAggregatorTestsExecutionHelper` — food-aggregator native flow drivers |
| `stress` | `StressLoadQueryFileParser`, `StressMongoOperationsFileParser`, `StressMetricsRecorder` — performance/stress harness |

---

## 7. Models catalog (`models/`, 50 POJOs)

| Group | Classes |
|---|---|
| Config / session | `Configs` (435 public members — central config object), `TestData`, `ValidationResults`, `CustomerAppTestSession`, `CustomerAppShopsTestSession`, `FoodAggregatorTestSession` |
| Identity / RBAC | `User`, `Role` |
| Ordering | `Order`, `OrderPaymentTransactions`, `Coupon`, `Discount`, `Bill`, `Timeslot` |
| Catalog | `Product`, `Category`, `Options`, `OptionSets`, `Shop` |
| Address / geo | `Address`, `Area` |
| Fintech card | `CardService`, `CardServiceWalletUserReport` (+`…CardDetails`, `…UserDetails`), **`PerkArtwork`** (B10-57393 — the four upload files of one perk: cover EN/AR 1080x1080 + logo EN/AR 240x180; factories per merchant set, lazy absolute-path resolution, fails with the regeneration command when an asset is missing) |
| Payments | `PaymentService`, `PaymentServiceProvider`, `PaymentServiceInputParam`, `PaymentCategory`, `BusinessCategory` |
| Supply chain / ops | `Warehouse`, `Batch`, `BatchLocation`, `StockBuckets`, `Transfer`, `TransferDestinationLocations`, `Trip`, `Truck`, `PlanningCenter` |
| Logistics / fleet | `FleetTrip` |
| Restaurants / aggregator | `Restaurant`, `RestaurantCatalog`, `RestaurantsCuisines`, `RmsRestaurants` |
| Chat | `FreshChatConversation`, `FreshChatMessage` |
| Devices / infra | `AndroidDevice`, `IosDevice`, `AppiumServer`, `TunnelServerConnection` |

---

## 8. Test suites (`src/test/java`, ~230 classes)

All test classes `extend BaseTest`; tests carry TestNG `groups` (e.g. `smoke`, `regression`, `B10-xxxxx`, `card-Hades-Backend-BF-integration`) and may use `dataProvider`.

| Package | Class count | Scope |
|---|---|---|
| `customerApp` | 123 | RN (`android`/`ios`), native (`androidNative`/`iosNative`), `api`, `web`, `database` — auth, home, more, place-order, food aggregator, chatbot, payments, referrals, customization |
| `roles` | 39 | RBAC permission tests per admin module |
| `fleetApp` (+`api`,`android`) | 10 | Login, side menu, pickup/delivery tasks, cash collect, end trip |
| `cardService` (`adminPanel`,`api`) | 6 | `CardAdminPanelTests`, `B10_56750_AddSectionToPerksTests` (branch `feat/b10-56750-selenium-automation`), `B10_57393_AppPreviewModalTests` (20 tests, branch `2026/sprintQ3.3/B10-57393-mobile-app-preview-for-perk-creation`), `CardApiTests`, `CardActivationTests`, `PipelineValidationTests`. *Drift note 2026-07-27: `MidExclusionCapacityTests`/`GeneralCashbackPerkApiTests` no longer exist (uncommitted B10-55168-era work; the stale root `b10-55168-tests.xml` still references one).* |
| `midMileApp` / `midMilePortal` | 4 / 2 | Mid-mile auth, orders, trucks, dashboard |
| `rmsDashboards` / `rms` | 4 / 1 | Restaurant management |
| `mainAdminPortal` (`authentication`,`orders`) | 2 | `LoginTests`, `EditOrderTests` |
| `controlRoom` | 1 | `ControlRoomTests` |
| `Inventory`,`Transit`,`kitchen`,`stockTake`,`pickerApp`,`planningCenter`,`deliveryCapacityManagement`,`switcher`,`pricing` | 1 each | Ops/supply-chain modules |
| `base` | 1 | `BaseTest` (fixture root) |

### TestNG suite XMLs (root)
| Suite | Runs |
|---|---|
| `testng.xml` | Smoke set: admin login, card admin panel, control room, create-order API, RN Android login |
| `mobileng.xml` | Native mobile regression — `androidNative` + `iosNative` customer-app suites (auth, home, more, place-order, food aggregator, regression) |
| `sanityng.xml` | Place-order + customization order API sanity (COD/CC/coupon/tipping/wallet) |
| `regressionng.xml` | Order regression entry |
| `fintechng.xml` | Payment regression + card admin panel + card API + card activation |
| `stressng.xml` | Create-order perf, chatbot SDK/API perf, DB stress-load queries |
| `supplychainng.xml` | ops / logistics / inventory / supply-demand groupings (picker, capacity, transit, fleet, stock take, planning center, control room, mid-mile) |
| `fleetappng.xml` | Fleet app API flow |
| `referralsng.xml` | `ReferralsTests` |
| `pricingng.xml` | `ProductPricingModuleTests` |
| `masterng.xml` | Master grouping — all top-level packages by `package name="*.*"` |
| `b10-55168-tests.xml` | Story-specific suite |
| `hyperexecute.yaml` | LambdaTest HyperExecute config: `runson: linux`, `autosplit: true`, `retryOnFailure: true`, dynamic Maven `testDiscovery` (`mvn test-compile`), `testRunnerCommand: mvn test`; uploads surefire-reports / allure-results / test-output |

---

## 9. Configuration (`resources/environments`)

Live files end `_testing.properties` / `.properties`; `.example` files are the templates. **All secret values redacted below — only key NAMES are documented.**

| File | Configures | Key names (secrets `<redacted>`) |
|---|---|---|
| `config_testing.properties` | Master config — credentials, base URLs, run/build toggles, test data | `testEmail`, `testPassword=<redacted>`, `testCountryCode`, `testMobileNumber`, `testMobileCompany`, `testCreditCard=<redacted>`, `testExpDate`, `testCVC=<redacted>`, `secondaryTestCreditCard=<redacted>`/`secondaryTestExpDate`/`secondaryTestCVC=<redacted>`, `webRunMode`, `mobileRunMode`, `gridURL`, `internalAPIToken=<redacted>`, `baseURL`, `controlRoomBaseURL`, `billingServicesBaseURL`, `midMileBaseURL`, `cardServicesBaseURL`, `cardServicesAdminPanelBaseURL`, `pickerServicesBaseURL`, `logisticsBaseURL`, `orderServiceBaseURL`, `ngrokAuthToken=<redacted>`, `slackApiBaseURL`, `slackApiToken=<redacted>`, build toggles (`webBuildEnabled`, `mobileBuildEnabled`, `webhookBuildEnabled`, `androidBuildEnabled`, `iosBuildEnabled`), `androidDeviceName`, `iosDeviceName`, admin creds (`adminLocalPhoneNumber`, `adminPhoneCountryCode`, `adminPhoneCountry`, `adminGmailAddress`, `adminGmailPassword=<redacted>`, `adminBypassScriptPassword=<redacted>`, `adminReferralCode`), `rolesTestsEnabled`, geo (`testLatitude`, `testLongitude`), `testFpName`/`testFpDate`/`testOrderInfo`, WordPress cookie names (`wpSecCookieName`, `wpLoggedInCookieName`, `wpNodeAuthorizationCookieName`), data-build toggles (`buildMobileCategoriesAndProductsTestData`, `buildWebControlRoomWarehousesAndOrders`, `registerUserUsingApi`, `buildMobileBillingTestData`), `cardServicesTestsEnabled`, `testExecutionVideoRecordingEnabled`, picker/mid-mile creds (`pickerPhoneNumber`, `pickerPhoneCountryCode`, `pickerPassword=<redacted>`, `midMilePhoneNumber`, …) |
| `cardServiceConfigs_testing.properties` | Fintech card-service test data | `adminUserName`, `adminPassword=<redacted>`, `loginMobileSchemeUserName`, `loginMobileSchemePassword=<redacted>`, `cardUserFrontTransactionId`, `cardUserBackTransactionId`, `defaultCardPasscode=<redacted>`, `updatedPasscode=<redacted>`, `cardUserEmail`, `registeredCardUserMpinNumber=<redacted>`, `cardServiceContractNumber`, `cardServiceTypeId`, `cardServiceProductNumber`, `receiverMobileNumber`, `cardUserMobileNumber`, `cardUserNationalId`, `cardUserNationalIdExpiryDate`, `cardUserBcidNumber`, `cardUserLastFourDigits`, `pickupLocationId`, `imagePath` |
| `browserStackConfigs.properties` | BrowserStack creds + app ids + device matrix | `userName`, `accessKey=<redacted>`, `local`, `debug`, `networkLogs`, `selfHeal`, `appiumVersionForAndroidTests`, `appiumVersionForIosTests`, app-id keys per app/platform (`bStackAndroidCustomerAppNativeApp`/`…BuildNumber`, `bStackAndroidCustomerAppReactNativeApp`/`…`, `bStackAndroidMidMileApp`, `bStackAndroidFleetApp`, and iOS equivalents `bStackIos…`), device matrix (`androidPlatformVersion`/`androidDeviceName` ×4, `iosPlatformVersion`/`iosDeviceName` ×4), test-management (`testManagementBaseUrl`, `targetProjectId`, `targetRunId`) |
| `webConfig.properties` | Web browser driver | `browser`, `chromedriver` |
| `iPhone_14.properties` | Local iOS device caps | `platformName`, `appium_platformVersion`, `appium_deviceUDID`, `appium_automationName` |
| `Pixel_2.properties` | Local Android device caps | `platformName`, `appium_platformVersion`, `appium_deviceName`, `appium_automationName` |

Also present: `cardServiceEncryptionPublicKey.pub` (card encryption key), `dbSshKey.example` (DB bastion SSH key template), `lambdaTestConfigs.properties.example`, git hook templates (`pre-commit.example`, `pre-push.example`).

---

## 10. Execution

```bash
# Full default suite set (surefire suiteXmlFiles)
mvn test

# A specific suite
mvn test -DsuiteXmlFile=mobileng.xml          # native mobile regression
mvn test -DsuiteXmlFile=fintechng.xml         # card / payments
mvn test -DsuiteXmlFile=sanityng.xml          # order sanity

# By TestNG group
mvn test -Dgroups=smoke

# Allure report
mvn allure:report        # results from ./allure-results
```

- **Java 25** required. **Checkstyle runs at `validate` and fails the build** on violations.
- **BrowserStack:** caps + app ids from `browserStackConfigs.properties`; `MobileDriversFactory` picks app by type (`customerAppReactNative` / `customerAppNative` / `midMileApp` / `fleetApp`). `BrowserstackSyncListener` + `BrowserstackApiClient` push results to test management.
- **HyperExecute (LambdaTest):** `hyperexecute.yaml` — `mvn test-compile` discovery, `mvn test` runner, autosplit across linux nodes, retry on failure.
- **Parallel safety:** all shared state in `BaseTest` is `ThreadLocal<>`.

---

## 11. Relationship to the JS frameworks in `D:\BreadfastQA`

| Framework | Role |
|---|---|
| **This Java framework (`D:\projects`)** | **Primary / native** automation: full mobile (RN + native), web portals, API, DB, stress; runs CI via Maven on BrowserStack + HyperExecute. |
| `automation/` (Playwright JS, in-repo) | Card-perk focused JS suite. Its `PropertiesReader` reads **this framework's** `config_testing.properties` (and card DB/SSH config) as the single source of truth — do not duplicate secrets. |
| `bs_helper.js` | Ad-hoc Node mobile WebDriver layer for manual BrowserStack sessions (`bsReq`, `getSource`, `tap`, `findElement`, screenshots). |

See the "Java framework (`D:\projects`)" row-group in [reusable-components.md](reusable-components.md) for the capability→asset shortcuts.
