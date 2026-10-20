# CCM release readiness audit — 20 October 2026

Contract: [Issue #62](https://github.com/tctan222-alt/ccm-fish-wage/issues/62),
authorized by OWNER comment
[6285274289](https://github.com/tctan222-alt/ccm-fish-wage/issues/62#issuecomment-6285274289).
Audited clean, synced main: `678df43f7f4c1b097ee711d2fd17bad099ed61fb`.
This is a local code/test/documentation audit, **not a release approval**.
No production business-data reads or writes, live Firebase checks, deployment,
imports, backfills or migrations were performed.

## Result and evidence boundaries

Local quality gates pass. No new code defect was demonstrated in the examined
PR #58 loading, draft recovery, pricing or query paths. This PR adds this report
only; application code, Rules, indexes and deployment configuration are unchanged.

Issue #62's initial statement that PR #58 was not deployed is stale. Existing
operator release metadata records a successful release on **16 October 2026**:

| Archived evidence | Recorded result |
| --- | --- |
| `git-final-verification.json` | Clean synced main `015fa674749fdbf323fbf17f7cfc25fa7d60e518`; release `SUCCESS`, then `STOPPED` |
| `indexes.json`, 14:22:19 UTC | All five required indexes READY |
| `rules.json`, 14:23:45 UTC | Actual `releases/cloud.firestore` pointer updated at 14:23:24 UTC to ruleset `8a5450f2-90bf-4c75-a6ba-39a693042281`; deployed source matches local Rules |
| `hosting-after-sha256-results.json`, 14:25:09 UTC | Index matches local build; 55/55 assets HTTP 200 and SHA-256 match |

These four files were read from the existing local
`pr58-production-release-2026-10-16` operator archive. Archived business-document
payloads were not read. The recorded entry assets are `index-BNHvrE7V.js` and
`index-CC722Kev.css`; Rules source SHA-256 is
`ec0e631ed0c31ad38784bf09abcad9c1314baf4efb74c5bf705bd034b89df2af`.
These are dated observations, **not a fresh claim about current production**.

Comparing the released commit with the audit base shows no changes to `src/`,
`firestore.rules`, `firestore.indexes.json`, `firebase.json`, `package.json` or
`package-lock.json`. PR #61 adds automation governance/queue infrastructure.
The current local build also emits `index-BNHvrE7V.js`. Thus there is no additional
runtime release justified merely by #61 or this audit documentation.

Historical data coverage and physical iPhone acceptance remain unverified by this
audit. Neither green tests nor READY indexes establishes complete real-data
coverage. Current production state would require a separately scoped live check.

## Fresh local checks

Executed on 20 October with existing installed dependencies and Node's
process-local `NODE_OPTIONS=--no-experimental-webstorage` Windows workaround:

| Check | Result |
| --- | --- |
| `node --check eslint.config.js` | Pass |
| `node --test scripts/codex-queue.node-test.mjs` | 20/20 pass |
| `npm.cmd run typecheck` | Pass |
| `npm.cmd run lint` | Pass; existing two Fast Refresh warnings in AuthProvider/RetailVesselPicker |
| `npm.cmd test -- --run` | 1,079/1,079 pass, 78 files |
| `npm.cmd run build` | Pass; existing large-chunk advisory |
| `npm.cmd run test:rules:size` | Compiler-backed executable-size estimate 253,738 bytes / 253,952-byte CI guard |
| `firebase-tools@15.29.0` Firestore Emulator | Rules compiled and 78/78 tests passed against `demo-ccm-rules` |
| Focused date-audit/query tests | 27/27 pass; included in the full suite |

Rules headroom is **214 bytes** below the unchanged CI guard. The runtime cap is
256,000 bytes; the repository intentionally uses the stricter guard. Do not raise
the guard or treat this estimate as a fresh production Rules release verification.
The pinned local Rules command was:

```powershell
npx.cmd --yes firebase-tools@15.29.0 emulators:exec --only firestore --project demo-ccm-rules "node node_modules/vitest/vitest.mjs run --config vitest.rules.config.ts src/firestore.rules.test.ts"
```

The focused query test invocation initially hit Windows sandbox esbuild
`Access is denied` before running tests. The same command with normal local
permissions passed; no test or assertion was weakened.

## Index and query dependencies

All five declarations in [firestore.indexes.json](../firestore.indexes.json) use
`collectionGroup=weighingSessions`, `queryScope=COLLECTION`; field overrides are
empty. The order below is the exact ordered field sequence:

| Use | Ordered fields |
| --- | --- |
| Vessel-only history | productType ASC, status ASC, vesselId ASC, dateSortKey DESC, __name__ DESC |
| ISO date range | productType ASC, status ASC, weighingDate DESC, __name__ DESC |
| ISO date range + vessel | productType ASC, status ASC, vesselId ASC, weighingDate DESC, __name__ DESC |
| Canonical date/month range | productType ASC, status ASC, monthKey ASC, weighingDate DESC, __name__ DESC |
| Canonical date/month range + vessel | productType ASC, status ASC, vesselId ASC, monthKey ASC, weighingDate DESC, __name__ DESC |

[settlementSearch.ts](../src/services/settlementSearch.ts) always filters product
and status; `all` means `IN [weighing, completed, processed]`, not an omitted
status clause. No additional index is needed for the current code paths.

- Page size is 25. Vessel cursors contain numeric `dateSortKey` plus document
  reference; date cursors contain the exact stored date string plus document
  reference. Pagination is exclusive, and criteria fingerprints prevent cursor
  reuse after filters change.
- Canonical DD/MM/YYYY records are queried per MM/YYYY month; ISO records use
  century-bounded streams. Merged rows sort chronologically with a document-name
  tie-breaker. Each call permits six canonical and two ISO probes, so a partial
  or empty page can have a resumable cursor; it is not proof of no further data.
- Vessel ordering omits records with a missing sort key. Incorrect numeric keys
  misorder rows; noninteger or wrong-type keys may also invalidate cursors.
  Existing Rules still allow the key to be absent.
- Canonical date queries additionally require the correct `monthKey`. The
  date/key helper does not certify monthKey, vessel, status or product coverage.

After separate approval for a current metadata check, an authorized read-only
tool can GET the following endpoint, handling every response page:

```text
https://firestore.googleapis.com/v1/projects/ccm-fishery-os-4490d/databases/(default)/collectionGroups/weighingSessions/indexes
```

Match collection scope and the complete ordered field lists above. Record each
index ID, state and observation time; all five must be `READY`. `CREATING`,
`NEEDS_REPAIR`, missing definitions, failed authentication or incomplete pagination
cannot pass. Existing credentials must remain outside reports/log output.
This procedure was **not executed against production** in this run.

## Deterministic local date-key audit

[settlementDateKeyAudit.ts](../src/lib/settlementDateKeyAudit.ts) is an existing
pure function with no Firestore/network imports or writes. It accepts fish-head
and fish-meal headers, validates canonical and ISO dates, and proposes a numeric
date key only for a real date. Reproduce the committed fixture checks with:

```powershell
$env:NODE_OPTIONS='--no-experimental-webstorage'
npm.cmd test -- --run src/lib/settlementDateKeyAudit.test.ts src/services/settlementSearch.test.ts
```

An additional in-memory invocation of the same source during this audit produced
the following results. These IDs are **synthetic fixtures, not production records
or an approved production correction list**:

| Fixture ID | Product / date | Before | Proposed after | Finding |
| --- | --- | --- | --- | --- |
| fixture-canonical-missing | fish_head / 30/09/2026 | absent | 20260930 | missing |
| fixture-iso-missing | fish_meal / 2026-08-31 | absent | 20260831 | missing |
| fixture-wrong | fish_head / 01/10/2026 | 20260901 | 20261001 | inconsistent |
| fixture-fraction | fish_meal / 01/10/2026 | 20261001.5 | 20261001 | inconsistent |
| fixture-invalid-date | fish_head / 31/02/2026 | absent | null | invalid_date |

A correct 20261001 key and an unrelated product yielded no findings. Input JSON
was unchanged; network calls were zero. An invalid date remains unresolved,
never guessed. The helper's `before:null` for an absent field is a report
representation, not permission to write null.

The TypeScript helper accepts `dateSortKey?: number`; this is not validation of
arbitrary Firestore wire values. A future collector must retain raw presence,
Firestore type, exact value, document ID and updateTime. Flag explicit null,
strings, doubles, maps and noninteger keys separately; never coerce
`"20261001"` with `Number(...)` and report it as valid.

### Future real-data review, not executed or authorized here

1. Obtain separate OWNER approval for production **read-only** header inspection,
   specifying products, fields and project. No basket/detail reads are necessary.
2. Page all approved headers by `__name__ ASC`, using a document-reference cursor
   and consistent readTime. Do not order by `dateSortKey`, which would omit the
   very missing fields being audited. Project only needed identity, product,
   status, vesselId, monthKey, weighingDate and dateSortKey fields, plus read
   metadata. Preserve raw types and report incomplete pages/reads as failures.
3. Report complete counts and exact real IDs with raw before/proposed after,
   including month/date dependencies. Invalid or ambiguous dates need an OWNER
   decision. Do not infer current production findings from the fixtures above.
4. Any correction needs a **second, exact-scope write approval**. Re-read source
   fields, use updateTime preconditions, idempotent changes and an audit/rollback
   manifest. Preserve business dates, amounts, source identity and existing audit.
   Review the actual write path/Rules first: ISO legacy dates cannot be assumed
   compatible with Rules' canonical-date numeric-key expression.

Full vessel-only historical coverage cannot be certified until that approved
audit proves valid keys or an independently approved correction is verified.
This is a data-coverage condition, not proof that production currently has bad
records. See [SETTLEMENT_LIFECYCLE.md](SETTLEMENT_LIFECYCLE.md).

## PR #58 regression assessment

| Area | Local evidence and practical limit |
| --- | --- |
| Loading/error/retry | `PurchaseSettlementPage.loading.test.tsx` covers success, empty/error, read timeout, separate vessel retry, late callbacks, changed source, navigation/Back and storage failure. The 15-second deadline is per wrapped read, not total route duration. |
| Persistent draft | `settlementLocalDrafts.test.ts` and page tests cover user/product/source isolation, revision conflicts, compare-before-remove, failed saves, changed Master defaults, newer drafts from another tab and Back during save. Recovery requires storage still to exist; denied/quota/corrupt storage surfaces an error. |
| Stable source revision | `weighing.stable.test.ts` covers parent/entries/parent consistency, cached/pending writes, bounded retries and weight/species/void races. Settlement service tests preserve saved price/identity across corrected weights. |
| Master versus actual price | Pricing and `weighing.master-price.test.ts` distinguish absent legacy default from explicit null, keep invoice overrides/snapshots, preserve Master price during unrelated edits and avoid touching Retail. Missing price blocks finalization while allowing a draft. |
| Saved invoice viewing | Pricing tests verify finalized snapshots remain viewable without an available Master read; new species load defaults lazily during editing. |
| Atomic writes | Service tests cover source/draft revisions, stable identity guard, immutable first timestamps and atomic invoice/audit failure. |

Aborting a read stops UI consumption of its result, not the underlying Firestore
network request. Save/finalization transactions and post-commit trusted timestamp
reads are outside the page read deadline. These are documented limits, not newly
demonstrated defects. No additional business feature or code fix was introduced.

## Separately approved release and rollback procedure

This automation ends at reviewed code/docs merge. A future release task must:

1. Identify exact approved commit/resources; inspect local changes, fetch, and
   verify clean `main == origin/main`, merge ancestry, current-head CI and review.
   Reassess whether any runtime change actually needs release.
2. Re-run applicable checks and the unchanged Rules guard. Resolve required data
   coverage decisions separately; deployment approval never authorizes migration.
3. For a coordinated release, use `firebase-tools@15.29.0`: publish approved
   indexes → verify every required index READY → publish approved Rules and
   verify the actual `cloud.firestore` release pointer/source → publish Hosting.
   A created ruleset alone is not success. Stop on a failed preceding gate;
   never work around a Rules failure with Hosting-only deployment.
4. Verify released index/Rules metadata and build's exact index/asset SHA-256
   plus HTTP status, then approved authenticated page reads. Do not create
   production test records. Record evidence/time and distinguish machine
   verification from physical iPhone acceptance.
5. If post-release checks fail, stop further publishing and preserve evidence.
   Obtain a separately approved compatible rollback target or focused forward
   fix; do not blindly restore an old Hosting version or old Rules.

**Concrete rollback incompatibility:** before PR #58, `saveFishSpecies()` used
replacement `writeBatch.set()` without preserving `basePriceCentsPerKg`. An old
Hosting build followed by an ordinary Master edit can remove a configured price.
Pre-#58 Rules also excluded that field in `validFishSpecies().hasOnly()`, rejecting
current price-enabled writes. Keep compatible schema support; do not delete
indexes or revert Rules automatically. Rollback verification must establish
Master-field preservation and snapshot compatibility before approval.

## Remaining acceptance and decisions

- No business decision is needed to merge this documentation-only audit.
- Separate approval is needed for live production verification and header audit;
  any release or real-data correction remains a distinct, explicitly scoped task.
- Physical iPhone Safari checks remain open: ordinary/long invoice Print/AirPrint,
  PDF Share → Save to Files / WhatsApp, opening PDF, decimal keyboard/viewport,
  intermittent network and suspend/resume/Back, storage pressure/private mode.
  Desktop/mocked tests do not certify these. Use local fixtures for write-related
  acceptance; production test records remain prohibited.
- Rules size has only 214 bytes of CI headroom. Future edits must pass the pinned
  compiler/Emulator/size gate; this report does not authorize guard relaxation.
- No new runtime release, data import, migration, other backlog work, Functions,
  Blaze, `firebase init` or access weakening is authorized by this report.
