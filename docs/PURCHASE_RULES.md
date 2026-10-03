# Purchase Rules

This document records the purchase-domain rule baseline for future Codex tasks. It is descriptive documentation only and does not change runtime behavior.

## Scope

Purchase workflows include fish purchase entry, weighing, purchase categories, partners, purchase settlement, monthly summaries, and related master data.

## Rule-change policy

- Do not change purchase pricing, weighing, settlement, rounding, lifecycle, or summary rules unless the task explicitly asks for that rule change.
- Preserve existing tests when documenting or refactoring purchase workflows.
- Add or update tests when a future task intentionally changes purchase behavior.
- Keep generated documentation consistent with the current implementation and specs.

## Data integrity expectations

- Operational purchase records should remain auditable.
- Hard deletion should remain prohibited unless the owner approves a clear retention policy change.
- Settlement and monthly-closing behavior should remain traceable to source purchase and weighing records.
- Master data edits should avoid destructive changes to historical records.

## Owner review triggers

Stop and request owner review before changing:

- Purchase price defaults.
- Settlement formulas.
- Weighing record lifecycle rules.
- Firestore access rules for purchase collections.
- Production deployment configuration.

## Completed weighing corrections (owner-confirmed September 2026)

- After completion has synced, the weighing screen and review screen link directly to the source session's settlement. Historical settlements remain viewable after the edit window expires.
- The edit window is seven elapsed days from the **first server completion timestamp**, inclusive of the exact deadline. Reopening and completing again preserve that timestamp and do not restart the window.
- Within the window, an unprocessed completed session can be reopened to correct basket records. Audited metadata corrections, voids and settlement draft edits obey the same deadline. Processed/voided sessions remain locked. Missing completion timestamps fail closed for completed sessions.
- Reopened sessions become read-only at the original deadline, including delayed offline writes. They may still be marked completed without changing weights or restarting the clock.
- Settlement drafts retain source-session ID/revision, use optimistic revision checks and atomically save immutable before/after audit snapshots. Reloading after weight corrections recalculates current quantities and amounts while retaining saved price snapshots.
- No historical-data migration or default-price change is included. Existing unbound drafts are readable; a permitted first edit records their source binding and preserves original creation fields.
- Ship Firestore Rules and Hosting together from CI-passing, merged `main`. Do not deploy just the frontend: the server enforces the deadline independently of the device clock.

## Settlement source identity (owner-confirmed October 2026)

- `sourceSessionId` is the authoritative settlement identity. Lookup queries bound drafts by source ID before legacy tuple lookup. A loaded draft retains its actual runtime `draftId`; that field is excluded from stored draft fields and audit snapshots.
- New drafts use `${productType}_session_${sourceSessionId}`. Date/vessel are mutable source metadata, never new draft identity. Two source sessions with the same vessel/date have separate canonical drafts.
- Existing bound legacy drafts keep their original document ID and creation fields. Unbound legacy drafts may be identified using current/original entry metadata only when every saved source entry belongs to this source/product. A legal save rechecks original entry ownership; Rules additionally require an original entry timestamp predating draft creation. Binding never copies a draft, resets prices or migrates unrelated records.
- An immutable `purchaseSettlementSources` document, keyed by canonical source ID, points to the actual draft ID. The save transaction reads source, actual draft and pointer, then creates the pointer if absent with the draft and audit atomically. It serializes canonical creation and lazy legacy binding; it does not contain a second settlement snapshot.
- A mismatched bound source, ambiguous legacy source, conflicting pointer, or multiple active drafts for one source fails explicitly. Duplicate IDs are reported; no automatic deletion, price merge or takeover is permitted. Stale new clients must reload existing drafts before saving.
- Source date/vessel corrections are reflected on the next legal save, including date/month sort keys. Existing prices, default snapshots and edited-price flags remain; current source weights and existing amount rules recalculate totals. Source/draft revision checks and the original seven-day/processed/voided restrictions remain mandatory.
- Priority 5 + 6 require a separately authorized coordinated Rules + Hosting release after merge. No bulk production migration is included.

## Stable settlement source reads (owner-confirmed October 2026)

- Authoritative settlement data uses `loadStableWeighingBundle()`: server session A, server entries/actions, then server session B. Accept only equal source identity, revision, type, lifecycle, date/vessel and relevant metadata/timestamps; discard the entire attempt on change. At most three attempts, then a clear error with page retry. No stale fallback or empty-state substitution.
- Both direct product routes, legacy source discovery and first-save legacy ownership checks use this loader. Ordinary `loadWeighingBundle()` and offline weighing entry behavior remain unchanged. Firestore server reads can include pending local writes, so document and query metadata must indicate committed server data before acceptance.
- Every supported basket create/update/species change/soft void and source metadata/lifecycle write advances the session revision atomically with entries/audit. Existing Rules enforce this invariant. Standalone sync-conflict actions do not affect source financial data and are not used as legacy identity proof; session-update proof actions are read inside the stable attempt.
- `sourceSessionRevision` comes exclusively from the accepted bundle. The save transaction still rereads the source: a correction after loading rejects the save and requires reload. P5 draft IDs, pointers, saved prices, default snapshots, revisions and creation/audit fields retain their existing protections.
