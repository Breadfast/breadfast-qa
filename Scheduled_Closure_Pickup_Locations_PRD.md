# **PRD: Scheduled Temporary Closure for Pickup Locations**

| Document status | Draft |
| ----- | ----- |
| **Desired launch** | TBD |
| **Document owner** | Ashrakat Elkhalifa |
| **Designer** | TBD |
| **Engineering Manager** | TBD |
| **Jira** | TBD |

# 🎯 Context & Objective

### Context

Card pickup locations are configured in the portal via Working Hours Slots — days of the week plus an open/close time per slot. Today, there is no way to temporarily close a location outside of a schedule change (e.g., when the assigned agent is absent for a day). The only workaround is for the Operations team to delete the working hours slot to close the location, then manually re-add it once the agent is back.

This manual workaround is error-prone: Operations sometimes forgets to re-add the slot once the closure period ends, leaving a location marked closed for customers even after the agent has returned — blocking pickups that should otherwise be available.

### Objective

Add a scheduled temporary closure option to the portal so Operations can close a pickup location for a defined period (e.g., during an agent's absence), with the location automatically reopening on its original working hours once the scheduled period ends — no manual re-add required.

# 🔴 Problem / Opportunity

* Manual, error-prone workaround: Closing a location today means deleting its working hours slot outright, which loses the original configuration unless someone remembers to recreate it.

* Forgotten re-opening: When Operations forgets to re-add the slot, the location stays incorrectly closed, and customers who should be able to pick up their card at that location can't.

* No visibility into planned closures: There's no way to see, at a glance, that a location is closed temporarily (vs. permanently discontinued) or when it's expected to reopen.

A scheduled closure with automatic reactivation removes the manual re-add step entirely, eliminates the risk of a forgotten reopening, and gives Operations a clear, auditable record of planned closures.

# 🛠️ Proposed Approach

Add a "Schedule Closure" action on each pickup location in the portal (alongside the existing Working Hours Slots section):

* Operations selects a start date/time and end date/time for the closure (or a start time \+ duration).

* Once scheduled, the location is marked closed to customers for the scheduled window, without deleting or modifying the underlying working hours slots configuration.

* A background job automatically reactivates the location the moment the scheduled end time passes, restoring it to its normal working hours — no manual action needed.

* While a closure is scheduled or active, the location's status in the portal clearly shows "Temporarily closed until \[date/time\]" so Operations and other portal users can see it at a glance.

* Operations can edit or cancel a scheduled/active closure early (e.g., if the agent returns sooner than expected), which reopens the location immediately.

* Every closure (scheduled, started, ended, or cancelled) is logged for audit — who scheduled it, for which location, and for what window.

# 📦 Scope

### In Scope

* "Schedule Closure" UI on the pickup location screen: start date/time, end date/time (or duration).

* Automatic reactivation of the location once the scheduled closure period ends, without manual re-add.

* Status indicator showing a location is temporarily closed and its expected reopening time.

* Ability to edit or cancel a scheduled/active closure before it naturally ends.

* Audit log of closure scheduling, activation, and reactivation events.

### Out of Scope

* Permanent closure / discontinuation of a location — the existing delete flow is unchanged for that use case.

* Customer-facing notifications about a temporary closure (e.g., push/SMS) — assumed out of scope unless flagged otherwise.

* Bulk scheduling of closures across multiple locations at once — v1 is single-location scheduling.

* Changes to the existing Working Hours Slots configuration itself (days/open/close time editing is unchanged).

# 📊 Success Metrics

| Goal | Metric | Baseline | Target | Type |
| ----- | ----- | ----- | ----- | ----- |
| Eliminate forgotten reopenings | \# of locations left incorrectly closed past their intended reopen date | Baseline at launch | 0 | Primary |
| Reduce manual Ops effort | \# of manual slot delete/re-add actions performed for temporary closures | Baseline at launch | Near 0 (replaced by scheduled closures) | Primary |
| No regression in location availability data | % of scheduled closures that reactivate at the correct time | Baseline at launch | 100% | Guardrail |

# 🤔 Assumptions & Risks

### Assumptions

* Closures are location-level (all working hours slots for that location), not scoped to a single day-of-week slot within a location.

* A closure is planned in advance with a known start and end time, rather than an open-ended "close until further notice" state.

* The existing working hours slot configuration for a location remains unchanged and simply resumes once a scheduled closure ends.

### Risks

| Risk | Mitigation |
| ----- | ----- |
| **The background job responsible for automatic reactivation fails or is delayed, leaving a location closed past its scheduled end time.** | Add monitoring/alerting on the reactivation job; log every scheduled closure with its expected end time so a missed reactivation is detectable and correctable quickly. |
| **Operations schedules a closure with the wrong dates/times, unintentionally closing a location during active hours.** | Require confirmation before scheduling; show a clear preview of the closure window before saving; allow early cancellation. |
| **Customers show up expecting to pick up their card at a location that is temporarily closed, with no visibility into why.** | Out of scope for v1, but flagged as a likely v1.1 candidate: surface closure status to the customer-facing app/notifications. |

# 📈 Analytics & Tracking

* \# of temporary closures scheduled per month, per location.

* Avg. duration of scheduled closures.

* \# of closures cancelled/edited before their natural end time.

* \# of failed/delayed automatic reactivations (guardrail).

# ❓ Open Questions

| Question | Answer |
| ----- | ----- |
| **What is the target launch date?** | August |
| **Should customers be notified (in-app or otherwise) when a location they might visit is temporarily closed?** | Not in scope |

