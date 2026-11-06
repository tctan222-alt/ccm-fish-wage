# QL Foods customer fish-head price reference

Authority: [owner-approved Issue #73](https://github.com/tctan222-alt/ccm-fish-wage/issues/73).
The QL reference is independent of boat purchase defaults, actual settlement
prices, Retail Fish and Fish Meal. The ERP has customer partner records but no
buyer-linked fish-head sale workflow. Purchase receipts bind supplier/vessel;
settlements bind vessel/source session; Retail uses a free-text vendor. None can
safely identify a QL customer transaction. No billing integration is invented.

## Approved reference and browsing

Open **Master Data → QL Foods 鱼头客户价格** or the Fish Department entry.
`/ql-prices` uses the existing authentication gate. Search the original grouped
labels and filter by explicit general / trawl / bottom context. The business date
selects the latest applicable effective version; a date before 2026-10-10 has no
known price. A price here is a customer reference, never a saved actual price.

The bundled snapshot `src/data/qlPrices20261010.json` was checked read-only against
the private source on 2026-11-06: 36 groups, 22 increases, 14 unchanged, every row
old + adjustment = new and review = OK. Effective date: **2026-10-10**.

- Source: https://docs.google.com/spreadsheets/d/1pFm8RuNceQZE4sHdRGS5XEMhqgzMSN7bEriHrIYySxo/edit
- Title: `QL Foods 鱼头价格表 2026-10-10`; tab/range: `Sheet1!A1:E39`.
- Money is parsed as integer cents with at most two decimal places. Invalid
  precision is rejected rather than rounded into a valid source price.
- `qlPriceGroups.json` holds stable group keys and explicit context/alias mappings.
  Reordered source rows retain their identity. Unknown/new labels or contexts
  require review; they cannot silently inherit an existing price.
- 丁温 / 目孔 require choosing trawl (RM2.00) or bottom (RM2.10). 青兰 requires
  choosing general (RM0.90) or bottom (RM1.10). Shorthand `红/乌目林仔` and
  `中/白月仔` remains grouped; no fabricated expansion is used.
- The 978/5202 vessel premium never enters this reference pipeline.

## Future source checks: implemented boundary and current blocker

The ERP does **not** inherit the developer's connected Google Drive credentials.
No ERP Google OAuth client/token provider is configured. The default **检查 QL 更新**
action therefore reports the missing authenticated read connection and keeps the
approved bundled version. There is no background sync, public Sheet export,
secret in the bundle, new server, Functions, Blaze, or paid provider.

`createAuthenticatedQlSheetReader({ getAccessToken })` is the tested read-only
adapter for a separately approved runtime authorization provider. It keeps the
token in memory, reads only the pinned spreadsheet's metadata and bounded values
with GET, omits cookies, refuses redirects, and returns a source envelope through
`validateQlSheet`. A future integration must supply an authorized read-only OAuth
token provider and verify the ERP origin can read the private sheet. This
configuration needs owner authorization; it is not silently added by this PR.
No spreadsheet sharing change is needed or performed by this implementation.

All snapshots enter the **same** `validateQlSheet` pipeline, including the bundled
seed. The envelope contains `source` (spreadsheetId, range, title), `version`,
`effectiveDate`, and the raw `values` from A1:E39. A source reader supplies all 36
rows; the owner does not retype prices. The parser requires the exact source,
matching title/header date, complete approved group/context set, review flags,
valid cents, no duplicates and consistent arithmetic before any preview.
A later date/title produces `ql-foods-YYYY-MM-DD`. Changed content on an existing
version or effective date is blocked for review, preserving the previous version.

## Preview, history and audit

`createQlPriceSync` first checks the entire candidate, then shows before/after
prices and alias/context warnings. Checking never adopts a candidate. An explicit
**仅在本页暂存预览** action appends a validated version and an in-memory before/after
audit. It is a local demonstration, clearly marked **未发布**; refresh/close discards
it. It is not a persistent business audit or production publishing feature.
Repeated identical checks/staging are idempotent. Failed/overlapping requests
preserve prior history and preview; only the newest request may finish. A failed
or pending check cannot stage an old preview. Date/search/method choices are not
overwritten by source responses. Unmount cancels outstanding reads.

Versions append rather than overwrite. Historical documents remain governed by
their business date and saved price snapshot; this module has no document write
path and cannot rewrite invoices, settlements or Master defaults.

## Release boundary

No Firestore schema, Rules, indexes or Firebase configuration changes are required.
No production business-data reads/writes, import, backfill, migration or Firebase
release is performed. Initial production publication and any later persistent
price update require separate owner authorization of exact before/after scope.
Code merge does not make QL prices live in production.
