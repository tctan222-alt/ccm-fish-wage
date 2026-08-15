# CURRENT SYSTEM AUDIT

Audit date: 2026-08-15
Project: CCM Fishery ERP (`ccm-fish-wage`)
Mode: read-only project audit plus this documentation output. No runtime code, Firestore rules, build configuration, or deployment state was intentionally changed.

## 1. Existing Modules and Completion Level

### Authentication and shell

- Status: usable foundation.
- Evidence: `src/App.tsx` gates all routes behind `AuthProvider`; unauthenticated users see `LoginPage`; Firebase Email/Password auth is initialized in `src/firebase.ts`.
- Completion: enough for an internal single-admin MVP, not enough for role-based operations.
- Gaps: no role model, no staff permissions, no public password reset, and no user administration UI.

### Dashboard and department navigation

- Status: partial but usable as a menu.
- Evidence: `DashboardPage` links to fish-head/fish-meal purchase, fish-head wages, ice department vessel links, master data, and CCM admin.
- Completion: navigation exists; it is not a KPI or operations dashboard.
- Gaps: no cross-module business dashboard, no alerts, no daily close status, no approval queue.

### Fish Head Wage

- Status: most complete existing module.
- Evidence: `FishHeadWagePage`, `TodaySummaryPage`, `MonthlySummaryPage`, `WorkerStatementPage`, `WorkersPage`, `services/wages.ts`, `services/monthClosing.ts`, `lib/wage.ts`, `lib/monthClosing.ts`, and multiple tests.
- Completion: daily entry, daily/monthly summaries, worker statements, void audit, month closing, wage payment and reopening logic exist.
- Gaps: uses old `dateKey` ISO month path for some queries while newer business-date fields exist; export is not visible as a formal first-class workflow; month closing exists but is separate from a clear "录入 -> 检查 -> 工资汇总 -> 导出" flow.

### Workers and master data

- Status: usable but mixed with legacy compatibility.
- Evidence: `WorkersPage`, `WorkerFormDialog`, `services/workers.ts`, `lib/masterData.ts`.
- Completion: active/inactive worker lifecycle and fields exist.
- Gaps: legacy `department` and newer `workerDepartment` coexist; worker identity rules are not strongly centralized across modules.

### Fish purchase / weighing

- Status: substantial but not fully settled.
- Evidence: `WeighingEntryPage`, `WeighingSessionsPage`, `WeighingReviewPage`, `PurchaseWeighingPage`, `services/weighing.ts`, `services/weighingOffline.ts`, `lib/weighing.ts`.
- Completion: fish head/fish meal sessions, entries, species/quality grouping, offline operation queue, completion/review, and conversion to purchase receipts exist.
- Gaps: purchase weighing and fish-head wage are separate systems; the relationship between purchased fish head and worker cutting wage is not explicit; processed purchase receipt lifecycle can conflict with direct purchase receipt screens.

### Purchase receipts, settlements, and monthly purchase summaries

- Status: broad implementation, needs boundary review.
- Evidence: `PurchasesPage`, `PurchaseReceiptPage`, `PurchaseSettlementPage`, `PurchaseMonthlyPage`, `PurchaseCategoriesPage`, `PartnersPage`, `services/purchases.ts`, `services/purchaseSettlements.ts`, `lib/purchasing.ts`, `lib/purchaseSettlement.ts`.
- Completion: supplier/partner data, vessels, categories, receipts, lines, payments, voiding, settlement drafts, and monthly summaries exist.
- Gaps: two concepts coexist: formal `purchaseReceipts` and `purchaseSettlementDrafts`; draft settlement status is constrained to draft/review states, not a full confirmed settlement workflow.

### Vessels and vessel trips

- Status: partial operational module.
- Evidence: `VesselsPage`, `VesselTripsPage`, `VesselTripPage`, `VesselWageTemplatesPage`, `services/vesselTrips.ts`, `lib/vesselTrips.ts`.
- Completion: vessel master data, trip lifecycle, crew settlements, crew payments, wage templates, and actions exist.
- Gaps: not connected to fish purchase/weighing flows except through shared vessel master data; needs product decision before keeping in phase one.

### Ice department

- Status: implemented but risky due to rules duplication and legacy migration handling.
- Evidence: `IceDepartmentPage`, `IceVesselPage`, `IceMonthlySettlementPage`, `services/iceWork.ts`, `lib/iceWork.ts`.
- Completion: vessel-based daily records, calculation formulas, confirm/reopen/void actions, monthly settlements, and legacy read conversion exist.
- Gaps: Firestore rules define `iceWorkRecords` twice with conflicting create/update posture; legacy records are read-only and excluded from new monthly totals, so historical reports can surprise users.

### CCM admin

- Status: placeholder only.
- Evidence: `CcmAdminPage` and dashboard both show "建设中".
- Completion: none beyond navigation.
- Gaps: should not be treated as an implemented module.

## 2. Firebase Collections and Fields

The collections below are derived from service code and Firestore rules. Field lists are implementation-level summaries, not a live database export.

### `workers`

- Main fields: `id`, `name`, `active`, `order`, `workerCode`, `phone`, `department`, `workerDepartment`, `employmentStartDate`, `employmentEndDate`, `notes`, `createdBy`, `createdAt`, `updatedBy`, `updatedAt`, `inactiveBy`, `inactiveAt`.
- Notes: legacy `department` remains for compatibility; canonical future field should be `workerDepartment`.

### `businessPartners`

- Main fields: `partnerCode`, `displayName`, `legalName`, `supplier`, `customer`, `active`, `phone`, `registrationNo`, `paymentTermsDays`, `notes`, audit fields, inactive fields.

### `fishSpecies`

- Main fields: `speciesCode`, `displayName`, `active`, `order`, `notes`, audit fields, inactive fields.
- Used by weighing sessions for fish head categories.

### `purchaseCategories`

- Main fields: `categoryCode`, `displayName`, `active`, `order`, `notes`, audit fields, inactive fields.
- Used by purchase receipt lines.

### `vessels`

- Main fields: `vesselCode`, `displayName`, `defaultSupplierId`, `defaultSupplierNameSnapshot`, `active`, `order`, `notes`, audit fields, inactive fields.
- Used by purchase/weighing, ice department, and vessel trips.

### `fishHeadWageEntries`

- Main fields: `dateKey`, `businessDate`, `dateSortKey`, `monthKey`, `monthSortKey`, `workerId`, `workerName`, `weightKg`, `rateRm`, `wageRm`, `createdBy`, `createdAt`, `updatedAt`, `deleted`.
- Constraints: weight is integer kg from 1 to 300; new writes include canonical business-date fields; hard delete forbidden.
- Risk: `rateRm` and `wageRm` are strings, unlike newer modules that use integer cents.

### `fishHeadWageVoids`

- Main fields: `entryId`, `dateKey`, `workerId`, `workerName`, `weightKg`, `rateRm`, `wageRm`, `voidReason`, `voidedBy`, `voidedAt`.
- Purpose: audit trail for wage entry voids.

### `fishHeadWageMonths/{monthKey}`

- Main fields: `monthKey`, `status`, `closeVersion`, `workerCount`, `basketCount`, `totalWeightKg`, `totalWageCents`, `paidCents`, `closedBy`, `closedAt`, `reopenedBy`, `reopenedAt`, `updatedAt`, `lastActionId`, `closingToken`, `closingBy`, `closingAt`, `statementIds`.
- Subcollections:
  - `statements`: `monthKey`, `closeVersion`, `workerId`, `workerName`, `basketCount`, `totalWeightKg`, `wageCents`, `paidCents`, `rateBreakdown`, `snapshotAt`, `createdBy`, `lastActionId`.
  - `payments`: `monthKey`, `closeVersion`, `workerId`, `workerName`, `statementId`, `amountCents`, `method`, `paymentDate`, `reference`, `note`, `createdBy`, `createdAt`, `voided`, `voidReason`, `voidedBy`, `voidedAt`.
  - `actions`: action audit snapshots.

### `fishHeadWageCloseAttempts`

- Used only to generate lock IDs for month closing attempts.
- No observed persisted business document shape beyond generated IDs.

### `weighingSessions/{sessionId}`

- Main fields: `sessionCode`, `productType`, `weighingDate`, `monthKey`, `dateSortKey`, `monthSortKey`, `externalSlipNo`, `vesselId`, vessel snapshots, `status`, basket/weight totals by product/quality, `processedReceiptId`, `processedReceiptCode`, `notes`, `revision`, `voidReason`, audit fields, `lastActionId`.
- Subcollections:
  - `entries`: `clientEntryId`, `sessionId`, `receiptNoSnapshot`, dates/months, vessel snapshots, `productType`, fish species snapshots, fish meal quality, `entryMode`, `sequenceNo`, `weightGrams`, optional `unitPriceCentsPerKg`, optional `amountCents`, `remark`, recorded/sync/audit fields, `voided`, `voidReason`, `revision`, `lastActionId`.
  - `actions`: action audit records such as create, entry create/update/void, sync conflict, complete, review, process.

### `purchaseReceipts/{receiptId}`

- Main fields: `receiptCode`, `receiptDate`, `monthKey`, `externalSlipNo`, supplier snapshots, vessel snapshots, `status`, line totals, amount/payment totals, `paymentStatus`, `notes`, `duplicateAcknowledged`, `sourceWeighingSessionId`, audit fields, `lastActionId`, confirm/void fields, `lineIds`, `draftVersion`.
- Subcollections:
  - `lines`: `lineNo`, category snapshots, `basketCount`, `weightGrams`, `unitPriceCentsPerKg`, `amountCents`, `notes`, optional weighing source fields.
  - `actions`: immutable purchase action records.
- Risk: draft line deletes are allowed by rules only for draft receipt editing; all other operational hard deletes are forbidden.

### `purchasePayments`

- Main fields: `paymentGroupId`, `receiptId`, `receiptCode`, supplier snapshots, `amountCents`, `method`, `paymentDate`, `reference`, `note`, `createdBy`, `createdAt`, `voided`, `voidReason`, `voidedBy`, `voidedAt`.

### `purchasePaymentGroups`

- Used to generate group IDs for multi-receipt payments.
- No dedicated rule or document shape found for persisted group documents.

### `purchaseSettlementDrafts`

- Main fields inferred from `lib/purchaseSettlement.ts` and services: `productType`, `dateKey`/business date fields, `vesselId`, vessel snapshots, source entries/lines, totals, receipt number, status, revision, audit fields.
- Purpose: review/save draft settlement for fish head or fish meal purchase source entries.
- Risk: naming says "Drafts"; no formal confirmed settlement collection was found.

### `vesselWageTemplates`

- Main fields: `vesselId`, `vesselCode`, `name`, `dayRateCents`, `nightRateCents`, optional captain/crew rates and headcount, `active`, audit fields.

### `vesselTrips/{tripId}`

- Main fields: `tripCode`, vessel snapshots, `departureDate`, `returnDate`, `status`, `incomeCents`, `expenseCents`, `crewWageCents`, `crewAdvanceCents`, `crewPaidCents`, `profitCents`, `notes`, `revision`, `voidReason`, audit/action fields.
- Subcollections:
  - `crew`: worker snapshots, `role`, template, half-day/night counts, rates, gross/advance/paid/balance cents.
  - `actions`: trip action audit records.

### `vesselTripEntries`

- Main fields: `tripId`, entry amount/category fields, void fields, audit fields. Exact shape is defined in `services/vesselTrips.ts`.

### `vesselCrewPayments`

- Main fields: `tripId`, `crewSettlementId`, worker snapshots, `paymentType`, `amountCents`, `method`, `paymentDate`, `reference`, `note`, `voided`, `voidReason`, audit fields.

### `iceWorkRecords/{recordId}`

- Main fields: `workDate`, `dateSortKey`, `monthKey`, `monthSortKey`, vessel snapshots, factory incoming weights/rates/amounts, ice box units/rates/amounts, diesel volume/rates/amounts, hawker sale weights/rates/amounts, direct ice count/rate/amount, plastic bag count/rate/amount, subtotals, `recordTotalCents`, `notes`, `status`, `revision`, audit fields, confirm/reopen/void fields, `lastActionId`.
- Legacy fields: `legacy`, `legacyValues`, and historical quantities/fees may be mapped into read-only legacy records.
- Subcollections:
  - `actions`: immutable ice-work record actions.

### `iceWorkMonthlySettlements/{settlementId}`

- Main fields: `vesselId`, `vesselCodeSnapshot`, `monthKey`, `monthSortKey`, counts/totals by ice-work category, `headmanFeeCents`, `clerkFeeCents`, `finalTotalCents`, `status`, `revision`, source hash/count, calculated/audit/confirm/reopen/void fields, `lastActionId`.
- Subcollections:
  - `actions`: settlement action audit records.

### `iceWorkMonthClosings`

- Mentioned in rules as read-only with create/update/delete false.
- No active service usage found; likely obsolete.

## 3. What to Keep and What to Deprecate

### Keep for phase one

- Fish Head Wage domain calculations in `lib/wage.ts`, especially integer kg validation and fixed/custom rate support.
- Wage persistence and void audit in `services/wages.ts`.
- Worker management, but standardize on `workerDepartment`.
- Month closing snapshot logic in `lib/monthClosing.ts` and `services/monthClosing.ts`, with review before making it part of the new phase-one flow.
- Auth shell and Firebase initialization.
- Existing tests for wage, workers, month closing, back button, and app routing as regression protection.

### Keep but isolate from phase one

- Weighing/purchase modules, because they are useful but represent a separate purchasing workflow.
- Purchase receipt/payment/monthly modules, pending a business decision on whether fish-head purchase is part of phase one.
- Ice department modules, pending rules cleanup and legacy policy.
- Vessel trips and crew wages, pending a business decision on whether this belongs in a later phase.

### Deprecate or freeze

- `CcmAdminPage` as an unfinished placeholder.
- `iceWorkMonthClosings`, unless a real current workflow still uses it.
- `purchasePaymentGroups` as an implicit ID generator unless a persisted group aggregate is designed.
- Legacy `department` as a canonical worker field; retain only for compatibility.
- String money storage in new wage writes should be avoided in future schema; keep old records readable.

### Do not delete yet

- Do not remove purchase, weighing, vessel, or ice modules until live data and business workflow ownership are confirmed.
- Do not hard-delete any Firestore records. Current rules and project rules correctly prohibit operational hard deletes except limited draft line cleanup.

## 4. Duplicate, Confusing, or Conflicting Code

- Firestore rules contain duplicate `match /iceWorkRecords/{recordId}` blocks. One block denies create/update; a later block allows create/update with validation and actions. This is the highest-priority rules cleanup item before relying on ice-work writes.
- `dateKey` formats are mixed. Wage still uses ISO `YYYY-MM-DD` for queries and UI date inputs, while newer helpers introduce Malaysia `DD/MM/YYYY`, `dateSortKey`, `monthKey`, and `monthSortKey`.
- Money types are mixed. Wage entries store `rateRm` and `wageRm` as strings; newer modules store `amountCents`, `unitPriceCentsPerKg`, and other integer-cent fields.
- Fish-head wage and fish-head purchase are independent modules with overlapping business names. The system does not show a clear handoff from purchased/processed fish head to worker cutting wage.
- Master data is shared across modules without explicit boundaries. `vessels` is used by purchase, weighing, ice, and vessel trip workflows; changes can affect unrelated screens.
- `purchaseReceipts` and `purchaseSettlementDrafts` overlap conceptually. A future system should decide whether settlement drafts become receipts, attach to receipts, or become their own confirmed settlement records.
- `lib/*` domain modules and `services/*` persistence modules are a good pattern, but some domain imports occur at file bottoms or across domains, making boundaries harder to read.
- Tests show broad coverage, but page-level workflows are many and not organized by feature directory.

## 5. Existing Data Migration Risks

- Wage records have legacy fields and new derived date fields. Migrating `dateKey`, `businessDate`, `monthKey`, and sort keys must preserve old reports and avoid duplicate month membership.
- Wage money stored as strings cannot be blindly converted to cents without checking decimal precision and historical custom rates.
- Worker `department` and `workerDepartment` must be reconciled carefully; old fish-head workers may only have `department: 'fish_head'`.
- Ice legacy records are deliberately excluded from new monthly calculations. Any migration that starts recalculating them can change historical balances.
- Ice fixed monthly fees moved to monthly settlements. Old record-level `headmanFeeCents` and `clerkFeeCents` need a non-duplicating migration policy.
- Purchase receipts contain nested `lines` subcollections and action logs. Moving receipt lines to a different shape risks breaking totals, payments, and void audit.
- Weighing sessions can be processed into purchase receipts. Reprocessing or migration must protect `processedReceiptId` and receipt source links.
- Vessel IDs sometimes use generated IDs and sometimes default vessel codes. ID normalization can break references from ice, weighing, purchase, and trips.
- Firestore rules enforce shapes. Bulk migrations must be run through an owner-approved admin path or rules-aware staged writes.

## 6. Suggested New System Directory and Module Boundaries

Recommended direction: keep the existing code until phase-one acceptance is rebuilt or proven, but stop adding new features into the flat `pages/services/lib` shape.

Suggested structure:

```text
src/
  app/
    App.tsx
    routes.tsx
    auth/
    firebase/
  shared/
    components/
    date/
    money/
    firestore/
    validation/
  modules/
    fish-head-wage/
      domain/
      data/
      pages/
      components/
      tests/
      README.md
    workers/
      domain/
      data/
      pages/
      components/
    purchase/
      domain/
      data/
      pages/
    weighing/
      domain/
      data/
      pages/
      offline/
    ice-work/
      domain/
      data/
      pages/
    vessels/
      domain/
      data/
      pages/
    vessel-trips/
      domain/
      data/
      pages/
  firestore/
    rules/
    indexes/
```

Boundary rules:

- `fish-head-wage` owns cutting wage entry, review, wage summaries, statements, payments, month close/reopen, void audit, and exports.
- `workers` owns worker identity/lifecycle only. Other modules snapshot worker names but do not own worker edits.
- `purchase` owns supplier receipts, settlements, payments, and categories.
- `weighing` owns field weighing sessions and offline sync. It may produce purchase source data but should not own receipts.
- `ice-work` owns ice work records and monthly settlements only.
- `vessels` owns vessel master data only. Trips, ice, weighing, and purchase should snapshot vessel fields.
- `shared` may contain primitive UI, date, money, and Firestore utilities only. It should not contain business formulas.

## 7. Phase One Acceptance Criteria: Fish Head Wage

Phase one should be limited to: fish-head cutting wage "录入 -> 检查 -> 工资汇总 -> 导出".

### Scope

- Included: workers, wage entries, void audit, daily review, monthly wage summary, worker wage statement, export.
- Excluded: purchase receipts, fish/fish-meal weighing, vessel trips, ice work, CCM admin, supplier settlements, production deployment decisions.

### Data rules

- Weight must be integer kilograms from 1 to 300.
- Money must use integer cents in new phase-one internal/domain calculations.
- Existing `rateRm`/`wageRm` string records must remain readable.
- Wage records must never be hard deleted.
- Voiding must retain an audit record with entry snapshot, reason, user, and timestamp.
- Each saved entry must have date, month, worker, worker snapshot, weight, rate, wage, creator, created time, and non-deleted/deleted status.

### Entry acceptance

- User can choose business date.
- User can select active fish-head cutting workers only.
- User can enter repeated basket weights quickly on mobile.
- User can choose fixed rates 0.12, 0.15, 0.18 and support an approved custom rate if current business rules allow it.
- User cannot save invalid weights, empty worker, invalid rate, or zero/negative wage.
- Saving multiple entries is atomic enough that partial UI failure does not silently show success.
- After save, entries appear in that date's review/summary.

### Check/review acceptance

- User can view all active and voided entries for a selected date.
- Daily totals show basket count, total kg, and total wage.
- Totals by worker are visible.
- User can void an incorrect entry only with a reason.
- Voided entries disappear from active totals and remain visible in audit/history.
- Date/month conversion is consistent for Malaysia business dates.

### Wage summary acceptance

- User can select a month and see all active wage entries in that month.
- Summary groups by worker and shows basket count, total kg, total wage, paid amount, and balance.
- Rate breakdown is visible or exportable for 0.12/0.15/0.18/custom rates.
- Closed-month snapshots do not change when old daily entries are edited later unless the month is explicitly reopened and reclosed.
- Reopen is blocked when payments exist, unless payments are voided first.

### Export acceptance

- User can export daily and monthly wage summaries.
- Export includes business date/month, worker, basket count, kg, wage cents/RM, rate breakdown, void exclusion, and generated timestamp.
- Export output must match on-screen totals.
- Export must not mutate Firestore data.
- File naming should include module, date/month, and generation date.

### Test acceptance

- Unit tests cover weight/rate/wage calculation.
- Unit tests cover date/month conversion.
- Unit tests cover monthly grouping, closing snapshot, payment, payment void, and reopen rules.
- Page tests cover entry, invalid entry rejection, daily review, void, monthly summary, and export action.
- Firestore rules tests cover authenticated reads/writes, unauthenticated denial, no hard deletes, valid wage entry shape, legacy compatibility, and void audit creation.
- `npm.cmd test`, `npm.cmd run typecheck`, and `npm.cmd run build` must pass before any deployment.

## Read-Only Checks Run

- Repository inspection:
  - `rg --files`
  - `git status --short --branch`
  - targeted `Get-Content` reads for app routes, Firebase setup, services, domain libraries, docs, and Firestore rules
  - targeted `rg` reads for collection usage, rule matches, legacy compatibility, and placeholders
- Test check:
  - `npm.cmd test`
  - Result: failed with 1 failing test and 292 passing tests.
  - Failing test: `src/App.test.tsx > authentication gate > shows the dashboard when authenticated instead of opening fish-head wages`.
  - Failure summary: test expected heading `CCM 首页`; rendered DOM only contained `退出登录` and `返回`, so the authenticated dashboard route did not appear during that test run.
- Worktree check:
  - `git status --short`
  - Result: only `CURRENT_SYSTEM_AUDIT.md` is untracked/added by this audit task.
- Not run:
  - `npm.cmd run typecheck` and `npm.cmd run build` were not run because the request asked for read-only checks and this repository has existing `*.tsbuildinfo`/`dist` outputs that those commands may update.
- Deployment:
  - Not run.
