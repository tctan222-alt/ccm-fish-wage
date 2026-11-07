# CCM ERP production acceptance and release gates

This task continues OWNER-approved Retail #79 and Fish Head Master #80 from main
`c3bb680433b7b2c939f913fdb2f2b4d2d5661518`. Code merge is not production acceptance.
Held PRs #32, #36 and #78 remain outside this release.

## Runtime findings, 7 November 2026

An authenticated, read-only browser inspection of
<https://ccm-fishery-os-4490d.web.app/> found the production entry
`/assets/index-BNHvrE7V.js`. The archived October 16 release documents the same
entry filename. This supports a stale-build diagnosis; it does **not** establish
the exact current Firebase Hosting version, release ID or source commit.
Those require current release metadata and source/hash verification.

Production Retail has the existing invoice-wide remark, date, fish and vessel
controls, but no per-line remark or daily batch-print entry. Master Data has no
QL entry, `/ql-prices` redirects to the dashboard, and Fish Head Master has no
36-group preview. Therefore #79 and #80 must not be described as delivered.
No production save, initialization, import, settlement or test record was made.

| Module | Existing implementation / production observation | Pending acceptance |
|---|---|---|
| Fish Head / Fish Meal | Entry and settlement screens exist and load. Later main changes improve default-price consistency, snapshot recovery and mobile feedback. | Exact deployed version; historical query coverage; approved read-only settlement acceptance. A restored completed session legitimately disables entry controls. |
| Retail | Cash entry, history, receipt/PDF and vessel support exist. This release adds independent line remarks and daily/vessel batch printing, while retaining the Malaysia date and 30-day audited edits. | Local fixture/browser and CI verification are separate from live acceptance after release. |
| Fish Head Master | CRUD/default prices exist. QL source/aliases/context were implemented in #75/#81/#82; this release hardens review and removes the browser bulk writer. | Publish read-only 36-group preview. Actual price adoption remains a separately approved data transaction. |
| Master Data / vessels | Partner, worker, vessel, category and wage-template screens exist. Vessel-trip and settlement workflows are already implemented. | Read-only live routing/data-loading acceptance. Initializers and deactivation are writes, never release checks. |
| Weighing / Purchase | Entry/review, receipt creation, supplier statements and payments exist. This release adds independent loading, retry and stale-callback protection to review/list pages. | Preserve seven-day correction limits and historical audit records; do not create production test receipts. |
| Reports / print | Wage daily/monthly, supplier statement and Retail receipt outputs exist. | Verify published controls; physical device/AirPrint acceptance remains distinct from desktop preview. |
| Ice | Vessel records and monthly totals preview exist. | Formal monthly close is explicitly disabled; no concrete approved completion contract was identified. |
| CCM Admin | Dashboard and page explicitly identify a construction placeholder. | A precise approved administrative-expense contract is still needed; this release does not invent one. |

## Data and compatibility gates

- QL reference sheet old prices are **not** production Master before-images.
  A UI preview/export is not an executable exact snapshot. Use the separately
  approved server snapshot/operator procedure for full field presence,
  nanoseconds and server updateTime.
- Keep all aliases and source groups. 丁温 and 目孔 are RM2.00/kg trawl and
  RM2.10/kg bottom; 青兰 is RM0.90/kg general and RM1.10/kg bottom. These contexts
  cannot be collapsed into a single default. Retain unadopted legacy records.
- No historical settlement, actual transaction price, Retail/Fish Meal Master,
  QL customer price or vessel premium is rewritten by default-price adoption.
- Settlement vessel-only search orders by `dateSortKey`; Firestore omits
  missing keys. Date queries also depend on canonical `monthKey`. Production
  coverage has not been certified. Green fixture tests cannot certify it.
- A separately authorized read-only audit must page `weighingSessions` headers
  by document name, projecting only product/status/vessel/date/month/sort-key
  fields and read/update times. Do not read basket details or order the audit by
  the field being inspected. Report missing/wrong fields; do not backfill.
- Never loosen Firestore permissions, seven-/90-/30-day windows, decimal limits,
  audit requirements or the 253,952-byte compiled Rules guard to pass a check.

## Formal release sequence

1. Obtain current Hosting release/version, previous compatible rollback version,
   Firestore Rules release pointer/source, and all five required index states.
   Current console access requires the account holder to complete Google 2SV.
   Never use exported browser tokens or disable MFA/TLS/network restrictions.
2. Complete the historical header audit under separate read approval. If data
   corrections are required, present exact findings for a separate decision;
   do not claim full historical query coverage or run an automatic migration.
3. Record the exact reviewed, CI-passing merged main SHA and one OWNER release
   approval for project `ccm-fishery-os-4490d`: Hosting, Firestore Rules and only
   the reviewed required indexes. This approval excludes all business-data writes,
   imports, migrations, Functions, paid services and Master adoption.
4. Fetch/fast-forward clean main; verify main equals origin/main and the approved
   SHA. Build with `CCM_RELEASE_COMMIT` set to that SHA. The build refuses dirty
   or mismatched sources and produces `/release.json` with commit and file hashes.
   Verify the compiled Rules guard using pinned firebase-tools 15.29.0.
5. Compare required indexes to current production metadata. Deploy only approved
   missing indexes, if any; wait until **all** required indexes are READY.
6. Publish reviewed Rules, then verify the actual `cloud.firestore` release
   pointer and exact source. Stop on failure; do not continue with Hosting.
7. Publish Hosting from that exact build. Retrieve `/release.json` with fresh
   cache semantics, verify SHA/clean flag and built entry/content hashes against
   the local approved artifact. Capture the actual Hosting release/version.
8. In the authenticated production site, verify route access, visible per-line
   remark controls, preserved manually selected date, saved historical display,
   date/vessel batch preview, both print modes and QL 36-group preview. Production
   writes/test invoices are excluded; use existing authorized records and
   read-only previews. Any real write acceptance needs separate scope approval.

## Rollback

Stop after a failed prerequisite and retain the previous production release.
After Hosting publication, prefer a forward fix or a previously verified,
compatible Hosting version. Capture the version ID before release; an asset name
alone is insufficient. Rollback Hosting first, verify the result, then consider
Rules only if the old Rules accept all current retained fields and preserve
authority. Keep compatible restrictive Rules in place when uncertain. Old Rules
without per-line `remark` support would reject newly saved invoice edits; old
Master replacement writes could remove configured defaults/source references.

Do not delete indexes used by either version. A code/Hosting/Rules rollback never
reverses business data. QL adoption rollback is a separate, explicitly approved
operator transaction bound to the committed after-images/updateTimes; restore old
records precisely and deactivate newly created IDs rather than deleting them.
Retain the operation journal and all historical settlements.
