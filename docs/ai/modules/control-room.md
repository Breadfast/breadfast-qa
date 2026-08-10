# Module — Control Room (internal back-office)

> Internal admin/back-office portal with role-based permissions. Living document — thin until more stories land. Expand from real tickets only.

## Purpose
Web-based internal portal used by Breadfast staff to operate the business. Role-based access control (RBAC) governs which actions each role can perform. QA focus: that each role can do **only** what its permissions allow.

## Confirmed scope (from tickets)
- **B10-5303** — "Analyst / Senior Marketeer ... has access to print invoice when it should not have." Confirms: (a) Analyst and Senior Marketeer roles exist; (b) print-invoice is a permission-gated action; (c) RBAC enforcement (negative permission testing) is in scope.
- Admin portal login was exercised in mobile-session helper scripts (`b55294_admin_*`) `(details unconfirmed — verify before relying)`.

## Roles
See [../business/user-roles.md](../business/user-roles.md). Confirmed: Analyst, Senior Marketeer. Others unconfirmed.

## Testing considerations
- **Permission matrix testing**: for each role, assert allowed actions work AND disallowed actions are absent/blocked (e.g. no "Print Invoice" for Analyst/Senior Marketeer if not permitted).
- Web story process applies (explore → exploratory notes → automate with Playwright → execute → report). See CLAUDE.md "Web Story Process".

## Dependencies / APIs / data
`(unconfirmed — populate when a Control Room story is tested with the framework)`.

## Automation entry points
Playwright framework ([../automation/playwright-framework.md](../automation/playwright-framework.md)); reuse [LoginPage.js](../../../automation/pages/LoginPage.js) and [BasePage.js](../../../automation/pages/BasePage.js) as the starting POM. New Control Room page objects to be created as stories require — search existing assets first ([../automation/reusable-components.md](../automation/reusable-components.md)).

## Java framework assets (`D:\projects`)

See [../automation/java-framework.md](../automation/java-framework.md) for the full catalog.

**API client** — `helpers/apiClients/webApiClients/ControlRoomV2ApiClient`: list warehouses, get warehouse by name, list/get/filter active orders by warehouse+date, pickers-app login + user status, product log-stock + `addStockToProduct`, `changeOrderStatus`. Admin auth via `webApiClients/AdminAuthorizationApiClient` (`loginAndGetAuthorizationTokens`).

**Page objects (modals)** — `src/main/java/modals/mainAdminPortal/` (17): `LoginPage`, `GoogleLoginPage`, `HomePage`, `ControlRoomV2AdminPage`, plus admin pages (Banners, BulkDiscounts, Collections, CategoriesSorting, CancellationReasons, Recommendations, PopUps, ScheduledOrders, Signature, Attendance, PlanningCenter, DeliveryCapacityManagement, Switcher).

**Models** — `Warehouse`, `Order`, `User`, `Role`, `ControlRoomTestSession` (`testSessionsDataFactories/ControlRoomTestSessionFactory`).

**Role validators (RBAC)** — `helpers/rolesValidators/` (39 classes, `BaseRolesValidator` + per-module). Data source: `dataProviders/RolesDataProviderSource`.

**Test suites** — `src/test/java/controlRoom/ControlRoomTests`, `mainAdminPortal/authentication/LoginTests`, `mainAdminPortal/orders/EditOrderTests`, `roles/*` (39 classes). Grouped under `supplychainng.xml` (supply-demand) and `masterng.xml`.
