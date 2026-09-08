# Retail compact screens and date filters — 2026-09-08

## Query behavior

- **今天 Today** defaults to the current Asia/Kuala_Lumpur business date.
  Selecting Today again refreshes that date from the clock.
- **按周 Week** starts at the current week, Monday through Sunday inclusive.
  Both dates and `周一至周日 Mon–Sun` are visible. Previous/Next Week steps seven
  calendar days, including across month/year boundaries. Switching away and back
  retains the selected week during this page visit.
- **范围 Range** expands From/To date inputs only while selected. Valid changes
  immediately subscribe to that inclusive range. Missing/invalid dates or From
  after To cancel the previous subscription, show an error and issue no new query.
- Queries use the existing numeric `dateSortKey` with `>= from` and `<= to`.
  There is no whole-collection download followed by date filtering. Vendor search
  remains local to the returned range.
- Results sort by business date descending, then creation timestamp descending,
  then ID ascending for ties. There is no new compound index or schema change.
- Cache/confirmed-empty/error states, retry, slow initialization, unsubscription
  and stale callback protection from the previous release are retained.

## Compact UI and fish data

History uses a 44px minimum-height link row: date, vendor, total, chevron. The full
date, vendor and total are in its accessible name; clicking opens the existing
invoice detail. Long vendors wrap without hiding totals.

Only entry/history pages opt into `retail-compact`; the new styling is inside
`@media screen`. Inputs and filters retain 44px touch targets and readable fonts.
The period control remains one row at all four tested widths. Range inputs do
not occupy space in Today or Week.

Fish browsing shows all active Retail Master fish in a scrollable grid: three
columns on small phones and four from 430px. A typed search keeps the existing
substring/exact/prefix ranking and top-eight results. Selection, keyboard/IME,
inline creation and historical snapshots retain their prior behavior.

Every option shows its stored Chinese name, Malay name and suggested RM/kg price.
Missing Malay or price displays `—`; neither hides the fish. Names wrap rather
than being ellipsized. A high price can wrap before `/kg`, without splitting the
unit. Selected fish and keyboard highlight are visually distinct.

`其他 Other` opens the existing quick-add path with a Chinese-name input; Malay
and suggested-price requirements are unchanged. It clears the previous pending
fish choice so it cannot accidentally be added while entering another fish, and
preserves already-added invoice lines. Selection fills the formal names/default
price; changing the current invoice price never writes back to Master Data.

## Before/after measurements

Compared actual baseline `94dfd96` components/CSS against the updated components,
using the same local fixtures (24 active fish, 20 same-day sales), global CSS,
Back/Sign Out controls and initial scroll position. An isolated same-origin frame
provided each specified width with a fixed 844px height. Count only wholly visible
options/rows, excluding picker scroll clipping and overlap with fixed controls.

| Frame width | History before → after | Fish before → after | Grid after |
| --- | --- | --- | --- |
| 320px | 1 → 9 | 1 → 12 | 3 columns |
| 375px | 1 → 9 | 1 → 12 | 3 columns |
| 390px | 2 → 9 | 3 → 12 | 3 columns |
| 430px | 2 → 9 | 3 → 16 | 4 columns |

Desktop scrollbars consumed 15px inside these frames (usable widths 305/360/375/
415px); both versions used identical conditions. Scroll offsets were zero. No
horizontal page overflow occurred. History rows were 44px versus 172px cards;
ordinary fish options were about 66px versus 72–90px rows. Week/Range controls
also passed all four widths with 44px minimum buttons on one row. Long Chinese/
Malay names, missing metadata, 300kg and RM9999.99/kg were checked at 320px.

These are desktop-browser layout measurements with no on-screen keyboard, not
physical iPhone Safari acceptance. Actual first-screen counts depend on Safari
chrome, keyboard, text size, record names and data. No production data was read
or written for measurement. The local fixture harness is ignored under
`node_modules/.cache/retail-density-qa/` and is not bundled into the app.

## Verification and scope

- Full app tests: **433/433 passed**, 43 files (40 added tests).
- Typecheck, lint and build passed. Existing AuthProvider lint warning and bundle
  size warning remain; no warning suppression was added.
- Tests cover Today/Malaysia midnight, week boundaries, leap days, inclusive
  ranges, invalid endpoints, ordering, first-entry/cache/error lifecycle,
  compact invoice links, fish metadata, keyboard selection, Other, and invoice
  price overrides without Master writes.
- Existing Retail calculation, checkout, PDF and print tests passed unchanged
  except page selectors updated for the new history controls/rows.
- Monetary/weight calculations, default price logic, Firestore writes/schema/
  Rules, shared styles, other modules, invoice/print/PDF implementation: unchanged.
- No deployment. This work remains on its own branch for review.

## Changed files

Runtime: `src/pages/RetailSalesPage.tsx`, `src/pages/retailSales.css`,
`src/components/RetailFishPicker.tsx`, `src/services/retailSales.ts`,
`src/lib/retailHistory.ts` (new).

Tests: `src/pages/RetailHistoryPage.test.tsx`, `src/pages/RetailSalesPage.test.tsx`,
`src/services/retailHistoryLoading.test.ts`, `src/components/RetailFishPicker.test.tsx`
(new), `src/lib/retailHistory.test.ts` (new). Documentation: this file.
