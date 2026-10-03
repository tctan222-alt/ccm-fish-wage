# Fish-head settlement list filters

Owner-confirmed Priority 7, October 2026. This extends the existing `/fish-head-settlement` list; it does not create a second workflow or change settlement calculations.

- Default: completed (待结单) and all dates. An old September completed session remains visible when the current date is in October. A user-selected date range can narrow it; switching back to all dates recovers old pending sessions.
- Status: completed / weighing / processed / all. Voided and non-fish-head sessions are excluded in every mode.
- Today uses the current Malaysia business date, including when an old Today URL is refreshed. Week is Monday through Sunday with previous/next controls. Month covers the entire selected month with previous/next and a month input. UTC calendar arithmetic handles leap years and December–January without local time shifts.
- Custom start/end are inclusive, both required, real dates and start ≤ end. Invalid input displays an error without cards or a misleading empty result.
- Vessel IDs are authoritative. Options use the newest relevant session snapshot for each vessel ID; historical/inactive or removed Master vessels remain selectable. No additional Master Data query is needed.
- Status, date and vessel filters combine. Sort is unchanged: business date DESC, update/creation timestamp DESC, then deterministic session ID. Same-vessel, same-date sessions remain separate rows and links.
- URL query state validates status/mode, anchor/month, start/end and vessel. Malformed mode/status/anchor use safe defaults; malformed custom dates remain an explicit error. Week/month/custom/vessel survive a refresh. Today advances to the actual current date.
- Loading, load failure with retry, invalid filter, default pending empty and filtered empty states are distinct. Failed refresh hides the old dataset. Filters do not affect direct detail URLs, stable source loading or saving.
- Mobile: compact status/date controls, full-width vessel selection, readable date range, ≥44px tap targets. Date inputs stack at ≤440px and use 16px text; wider layouts use two columns. Cards retain their session snapshots, quantities and existing actions.

## Query strategy and scale boundary

This version retains `loadWeighingSessions()` unchanged: one existing collection read on mount or explicit refresh/retry. Filtering, counts and vessel options use that returned dataset; changing filters causes no additional query, and an invalid custom range never starts a query. Business-date filtering intentionally does not trust missing/stale legacy `dateSortKey` fields.

This is a small-dataset compatibility strategy, not a solution for unlimited history. Before routinely operating above roughly 500 sessions or observing slow initial loads, replace the collection scan with a dedicated pending query (no date cutoff), server-side bounded date queries and pagination. That follow-up must first verify legacy sort-key coverage and preserve discoverability of all old pending sessions and historical vessels. Do not silently add a cap or default Today/Month restriction. No production dataset-size claim, migration or index change is made by this PR.

## Validation

Public library and page tests cover date boundaries/navigation, status/vessel combinations, historical snapshots, invalid URL/ranges, empty/error/retry, URL restoration and unchanged direct session routes. Existing P5/P6 integrity tests continue in the full suite. Responsive layout is also inspected in an actual local browser at 320/375/390/430px using memory-only fixtures; this is viewport verification, not a physical iPhone certification.

Final local gate: 702/702 app tests (55 files), 38/38 Rules Emulator tests, Rules compile/size 252,010 bytes, typecheck, lint, build, config syntax and diff checks pass. The default-pending regression failed against the old page before implementation. Standards and Spec reviews have no blockers. Existing AuthProvider Fast Refresh and bundle-size warnings are unchanged.

Browser measurements at all four requested widths: document scroll width equals content width, no overflowing control/card, minimum control height 44px, date text 16px and one date column. Week navigation also fits at every width. The native keyboard date change updates URL and the rendered range; a refresh restores it. No browser console errors were observed. Local fixture files/server are removed after verification and never committed.

P7 does not change Firestore Rules, prices, amount formulas, source identity/revision, weighing entry UX, seven-day rules or fish-meal routes. P7 is not deployed automatically after merge; Priority 8–10 remain separate tasks.
