# User-flow navigation UX cleanup

Baseline: `b492c6a0eabf3b9179b6c19e248135711454b72c`. Development only: no deploy, Rules/index changes, production data reads/writes or new business features.

## Unsaved business data

The old BackButton marked every document input/change dirty, including query controls; it also missed keypad-only wages. `DirtyStateProvider` now aggregates explicit form registrations via `useUnsavedChanges(boolean)` and `useUnsavedForm(initiallyLoadedValue)`. Each registration cleans up on unmount. Reverting to the baseline or successfully saving clears that form only; a nested Master save cannot clear a separate invoice draft. Registration updates before paint, avoiding a stale warning immediately after checkout.

Coverage: Retail draft/editor/Master/quick-add; purchase receipt and quick-add; settlement receipt number/prices; weighing unconfirmed basket/header and edit dialogs; wage keypad and basket list; worker/partner/vessel/category/species Master; ice entry; payment/reopening forms. Dates used as list filters, vessel/status/search filters, pagination and history never opt in. Saved/local queued weighing baskets are already retained in the local store; only currently unconfirmed data warns.

Frozen Vessel Trip and template source/services stay byte-for-byte unchanged. A shared opt-in navigation boundary preserves protection for their existing native business forms, excluding all controls outside forms. It does not alter their business actions. Native form reset/removal clears its registration.

Beforeunload, Home, Logout and internal links remain guarded. A capture-phase popstate guard intercepts a cancelled browser Back before BrowserRouter unmounts the draft, restores the prior history index and preserves the current values. An approved Back is confirmed once. Ordinary router links and asynchronous Logout do not permanently waive protection for a still-mounted form.

## Direct-link fallback

`src/lib/navigationParent.ts` maps settlement details to their list; Retail invoice to history, edit to invoice, fish/history to Retail; statement to monthly; receipt/new/monthly to purchases; ice monthly to vessel; weighing review to session and session/new to weighing; Master children to Master. Wage, daily/today/monthly and purchase entry return to Fish Department. Purchase and frozen Trip indexes return to CCM Admin; departments/Admin/Master return to Dashboard. Existing history is preferred whenever available.

## Mobile and print

One `.authenticated-layout` outside all authenticated routes reserves 44px Back height + 16px gap + `env(safe-area-inset-bottom)` below 500px. Back itself uses an 8px gap plus the safe area. There is no new per-page padding; the old special weighing bottom override is removed. Print hides Back and removes the shared reservation.

Local browser viewport checks at 320/375/390/430 × 844 on actual Retail entry, 25-record Retail history, Dashboard and monthly components with local fixture services: document width stayed within viewport width. At page end all last actions remained above Back (Back top 792px; last-action bottoms 629–719px). Shared reservation computed to 60px when safe-area is zero. The CSS contract test separately protects nonzero safe-area inclusion and print behavior. This is Chromium viewport verification; physical iPhone safe-area/Print/AirPrint acceptance is not claimed. No production services are used by the fixture.

## Dashboard, monthly and continuous Retail entry

Dashboard ice-vessel state explicitly distinguishes loading, ready-empty, ready-with-links and error with Retry. The ice department link remains available on failure; stale/unmounted requests are ignored.

Monthly order: month selector → overview → worker summaries → daily all-worker summaries → exact-cents reconciliation → closing/reopening administration → void history. Chinese-first labels include month, workers/work days/baskets/kg/wage/voids, loading/errors, refresh, navigation, daily-detail entry, and closing management. Integer-cent aggregation, snapshots, reconciliation and backend closing actions remain unchanged. Normal monthly view still has no payment/remark controls.

Next Vendor keeps the working business date and vessel; clears vendor, lines, remark, selected fish/search/weight/price and errors. New date/vessel choices remain editable. Pending checkout ID, replay, uncertain-result recovery, numbering, 30-day edits, audit, and Print/PDF/Share mechanisms are unchanged.

The separate `UX-AUDIT` section in `ERP_MASTER_BACKLOG.md` records new out-of-scope findings without implementation.
