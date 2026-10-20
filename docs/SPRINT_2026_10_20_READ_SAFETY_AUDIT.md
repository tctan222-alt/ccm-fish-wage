# Settlement read and Rules safety audit — 20 October 2026

Scope: OWNER-approved [Issue #67](https://github.com/tctan222-alt/ccm-fish-wage/issues/67),
audited from main `90efe3042a05caab0632369d2a5d97acedfb65df`.
All measurements use local fixtures or `demo-ccm-rules`. No production data,
deployment, migration, import or paid service was used.

## Rules

- Pinned CLI: `firebase-tools@15.29.0`, compiler jar v1.22.0.
- Local compiled-size estimate: **253,738 bytes**, unchanged guard **253,952**;
  **214 bytes** remaining below the guard.
- The guard fails closed on missing compiler, compilation failure or oversize.
  Its estimate and calibration limitations remain in [FIRESTORE_RULES_SIZE.md](FIRESTORE_RULES_SIZE.md).
- The complete demo Emulator suite passed **78/78**, including real REST
  projection/cursor queries, source identity, revision/audit immutability and
  edit-window rejection tests.
- Rules were not modified. SHA-256:
  `45aa4a96e4a08749d42e04ee7b2a1bd6dce90e8a694fbdf6c7848ad0178b4ebb`.
- Compilation/Emulator success does not verify a production release pointer.
  There was no release or production Rules inspection in this audit.

## Necessary source reads

`loadStableWeighingBundle` in `src/services/weighing.ts` performs:

1. Server-only session read.
2. Entries and actions queries in parallel.
3. Second server-only session read.

That is four SDK operations per healthy attempt, at most twelve across three
revision-changing attempts. The second parent read, pending-write/cache checks,
field/timestamp comparisons and actions used for legacy proof are consistency
protections, not redundant work. Existing `weighing.stable.test.ts` verifies
read counts, bounded retries and rejection of mixed snapshots.

For a nonempty fish-head source with an existing bound draft, initial detail
loading includes those four operations plus one bound-draft query, one
fish-species query and one vessels query: seven SDK operations. Finalized
viewing skips Master price loading: six. Fish-meal and empty-source paths
also omit Master. Missing legacy bindings require extra guard/canonical/legacy-ID reads;
these detect conflicting identities and preserve saved prices. They remain.

These are SDK/query operation counts, **not billable document-read estimates**.
Collection result sizes, retries and service billing are separate concerns.

## History query bounds

`src/services/settlementSearch.ts` already projects session/header fields:
it does not fetch baskets, actions, species, draft lines or full receipts for
the history list. Each source query returns at most 25 rows. Monetary headers
are joined once per nonempty page, plus one receipt-header batch only when
processed receipts are referenced.

Local synthetic measurements, backed by `settlementSearch.test.ts`:

| Scenario | Session queries | Draft / receipt header queries |
| --- | ---: | ---: |
| Vessel history, 61 records, pages 25/25/11 | 3 | 3 / 0 |
| Mixed ISO/canonical dates, 61 records | 5 | 3 / 0 |
| First 25 recent ISO records in a 2000–2026 range | 2 | 1 / 0 |
| Empty 2000–2026 range, first resumable page | 7 | 0 / 0 |
| 25 processed vessel records | 1 | 1 / 1 |

Sparse date searches retain explicit per-call query budgets and resumable
cursors; newer unchecked months cannot be skipped to display older records.
Vessel mode uses one numeric `dateSortKey` stream, without scanning months.
Join failures must not consume the caller's cursor. Existing tests cover
cross-century/date-format ordering, duplicate detection and retry integrity.

## Narrow fixes

- An all-voided or other-product source could unnecessarily wait for
  `fishSpeciesLoader`, even though the settlement builder excludes every entry.
  Master loading now uses that same active/product predicate. Source and draft
  verification still run; empty results cannot be saved/finalized. A deferred
  Master fixture proves the empty view no longer waits for an irrelevant read.
- A pending next-page request was ignored after criteria replacement/unmount,
  but its controller was not aborted. The page now owns and aborts that request
  during cleanup, while retaining generation, cursor and result guards.
  Deferred-response tests verify cancellation and isolation from the next query.
  Abort does not promise reversal of a server read already executed.

## Remaining boundaries

- `loadPurchaseSettlementSource` still supports a legacy date/vessel fallback
  through `loadWeighingSessions`, which reads the session collection. Current
  production routes use the list and mandatory `:sessionId` detail path instead;
  this dormant compatibility path was not rewritten speculatively.
- Source detail intentionally loads its entries/actions; no claim is made about
  large real-world session latency or production billing without measurement.
- Vessel history requires numeric `dateSortKey`; canonical date search depends
  on the existing canonical `monthKey`. Missing historical keys remain a
  separately approved pre-release data audit/correction concern. This task did
  not inspect or alter production records.
- Rules headroom remains small. No security checks or size thresholds were
  weakened to manufacture additional space.
