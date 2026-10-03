# Priority 8: Daily wage details and print

## Existing behavior and scope

`TodaySummaryPage` already uses `loadDailyWageData()` to load the selected work date from `fishHeadWageEntries` and the existing void audit collection. It groups active entries by worker and sums the stored wage amounts as integer cents. P8 retains those reads, grouping and totals, `voidWageEntry()`, and the existing database. There is no new summary document or wage calculation path.

The original page has only English labels and no print action. It accepts a date-shaped URL parameter without checking whether the date exists, does not persist later date changes, and can retain the previous day's records while the next day loads. The wage-entry navigation incorrectly calls its daily-summary link “工钱录入”.

## Daily view and compatibility

- The primary title is “切鱼头工钱每日明细”, with “Daily Details” as a secondary screen label.
- `/daily?date=YYYY-MM-DD` is the canonical entry; `/today` remains connected to the same component. The Fish Head Wage link carries its currently selected work date. `/monthly` remains unchanged.
- The date query is checked against the existing business-date parser. Date selection updates the URL so refresh retains the choice; invalid dates do not reach the daily query. Work dates display as DD/MM/YYYY; entry times use Asia/Kuala_Lumpur.
- Each worker retains basket count, total kilograms and stored wage subtotal. Every basket includes its sequence, kilograms, stored RM/kg rate, stored wage and recording time. Grand totals are derived from the same active entries, not saved separately.
- Loading, empty, query error and retry remain distinct; the previous date is not available for printing during a new load. Old asynchronous responses are discarded.
- Void history remains available on screen. Chinese reason labels keep the existing English reason values in audit writes. No hard deletion, new audit semantics, monthly closing or payment changes.

## Print

The button calls `window.print()` synchronously from its click handler. No PDF library, popup, iframe, timer, paid service or backend is introduced.

The print-only report uses the same worker groups, basket renderer and subtotal/grand-total values as the screen. It has no `<details>` containers, so every basket is rendered regardless of screen expansion. It is hidden from the screen/accessibility tree and shown by the scoped print stylesheet; no separate totals are recalculated or persisted.

The formal print includes CCM Fishery, the Chinese title, DD/MM/YYYY, all active workers and baskets, worker subtotals and the grand total. Navigation, date controls, refresh, print, void actions, modal, audit history and transient feedback are excluded. The existing global print rules already hide sign-out and Back controls.

The named A4 page applies only to this report. Headers stay with following content, table headers can repeat, rows/subtotals avoid splitting, and long worker tables can continue onto another page. Screen basket rows use a compact responsive layout while the print view retains a five-column table.

## Local verification

The memory-only local fixture blocks non-local browser requests and does not use production records. Actual Chromium checks at 320/375/390/430px show no page/table overflow, 16px date input text and minimum 44px action targets. With all screen details closed, print media still contains every active basket and excludes screen controls/audit history.

The normal three-basket report prints on one A4 page; the 70-basket report prints on three A4 pages. All 70 stored rates and the independent expected 5,138kg / RM619.56 grand totals remain in the printed content. Page text stays inside the A4 margins; rendered pages have no clipped content or orphaned worker headings. Long tables repeat column headings across pages. These are local viewport and browser print checks, not physical iPhone/AirPrint certification.

The completed local quality gate passes config syntax, typecheck, lint, 725/725 application tests, production build and `git diff --check`. Rules are unchanged; 38/38 Firestore Emulator tests and the 252,010-byte compile/size gate pass (budget 253,952). Existing Fast Refresh and build chunk-size warnings remain. The local fixture, browser outputs and preview server were removed after verification.

## Release boundary

P7 was explicitly authorized and released from clean, synced main `5343a18ad6120e328a21611618f3869c1b399533` using firebase-tools 15.29.0, Hosting only. Production `/`, `/fish-head-settlement`, entry JS/CSS and the settlement-filter chunk returned HTTP 200 and matched local SHA-256 hashes. HTML: `8aebb5a552466b890f0fb1b4a7cbcec8cc2fd9bf5b38a366fb9703015566310b`. No Rules, Functions or other service was deployed and no production business record was written.

P8 is to be merged only after its quality gates and independent Standards/Spec reviews pass. It must not be deployed automatically. Priority 9–10 remain pending.
