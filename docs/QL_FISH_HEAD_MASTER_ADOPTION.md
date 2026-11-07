# Fish Head Master adoption from QL Foods — Issue #80

## Scope and source

- Immutable approved source: `src/data/qlPrices20261010.json`, effective 2026-10-10, 36 groups.
- The QL price reference remains an independent buyer-specific module. Owner separately requested copying its new prices to **future Fish Head Master defaults**; historical prices and actual transaction overrides are not rewritten.
- PR #81 is the read-only 36-row preview. This follow-up implements a guarded, explicit 36-row adoption path; it **does not run** that path or authorize a production release.
- `qlSourceRef = ql-foods-2026-10-10|<groupKey>:<method>` is a versioned foreign key. Original aliases, method, source row/date and source price are reconstructed from the immutable approved QL snapshot rather than duplicated as editable arrays in Firestore. This minimizes Firestore Rules size while retaining provenance.

## Approval and release safety

The import is **disabled by default**. The web application exposes no working import button unless a later, separately reviewed release is deliberately built with `VITE_APPROVED_QL_MASTER_WRITES=true`. A production release also needs explicit OWNER authorization of its exact main commit, the Firestore Rules and Hosting resources, and the **specific production Master before/after data change**. Merely merging the feature or passing CI does not provide that authority. Do not publish production Rules without the required approved release sequence. Never put credentials in env flags or source files.

Do **not** use an approval flag in the ordinary CI or production environment. No automatic Sheet-to-Master sync is implemented.

## Preview and resolution

Each source group is identified by version + groupKey + fishing method. Matching preserves existing Fish Species ID, internal code, display name, order and notes. Old Master entries not in the QL source are retained.

When a generic legacy alias maps to multiple QL fishing contexts, it must not be overwritten. The UI allows an explicit **create separate source group** selection, leaving the legacy generic entry unchanged; do not infer it from a shared fish nickname. The following require distinct QL source references:

- 丁温 / 目孔: trawl RM2.00/kg vs bottom RM2.10/kg
- 青兰: general RM0.90/kg vs bottom RM1.10/kg
- 加晒 vs 加西 are not silently merged.

Generated IDs/codes that collide with existing Master entries remain blocked; no force overwrite. The entire batch requires exactly 36 resolved groups. Partial import is forbidden.

## Transaction and rollback

The optional import flow:
1. Requires a signed-in user, the separately enabled release flag, exact confirmation text and an explicit user action.
2. Loads the complete Master from Firestore server, not cache. It compares a stable fingerprint of the reviewed snapshot and aborts if stale.
3. Recomputes and validates the full 36-group plan; unknown selections, ID/source collisions and unresolved mappings abort the batch.
4. Uses one Firestore transaction to read all target documents before writes, verifies their previous identity, metadata and price, then writes all future-default entries atomically with preserved creation provenance.
5. Reloads the Master after success. Failure must not produce partial adoption.

**Before an authorized production use**, the owner must review a real production snapshot outside this implementation exercise (including all conflict resolutions), export/archive before/after documents and explicitly approve exact creates/updates and a reversible rollback. Neither a code merge nor this document constitutes that approval. Rollback must be a separately authorized transaction preserving modified-since and historical-document boundaries; deleting fish species records or rewiring old settlement references is forbidden.

## Known boundaries

- Existing 7-day weighing, 90-day settlement and 30-day Retail edit windows unchanged.
- Saved receipts/settlement documents already contain their own species/price snapshots. The importer does not alter them.
- Existing vessel premium (978/5202) and QL customer-reference calculations unchanged.
- Existing Fish Species records without `qlSourceRef` are valid; legacy manual editing keeps a previously persisted source ref.
- The source code currently recognizes the exact immutable 2026-10-10 QL version. Future versions must be explicitly reviewed and preserved, not silently overwrite this one.
- Enabling the write flag without a separate authorized production release/data change is prohibited.

Testing requires full application CI plus pinned demo Emulator 78+ Rules tests, compiled Rules guard at **253,952 bytes**, exact-head review and an independently checked GitHub merge. No production Firebase operations are performed in PR #82.
