# Fish Head Master adoption — Issue #80

## Source and production boundary

The immutable source is `src/data/qlPrices20261010.json`: 36 QL Foods groups effective 2026-10-10. Its old-price column is **not** a production Master snapshot. The change affects future Fish Head defaults only; historical prices, completed settlements, transaction overrides and other departments are outside the tool's paths.

The browser offers a read-only 36-group comparison, explicit conflict resolution and JSON download. It has no bulk-write implementation. `VITE_APPROVED_QL_MASTER_WRITES` cannot authorize adoption. The downloaded browser comparison is not an executable approval manifest.

`qlSourceRef = ql-foods-2026-10-10|<groupKey>:<method>` preserves immutable aliases and method provenance. Ordinary signed-in clients cannot create, replace or remove this reference; existing ordinary Master editing remains available. Actual adoption uses the official server SDK and an existing, independently verified IAM identity. No Functions, Blaze, new credentials or paid service is introduced.

## Matching and comparison

The operator manifest lists all 36 source groups as create, price update, metadata update or unchanged, with exact existing before-images and proposed after-images. The complete Master snapshot also retains records outside the QL source. Existing IDs, codes, names, order, notes and creation provenance are preserved. All original aliases remain in the immutable source.

- 丁温 / 目孔: trawl RM2.00/kg; bottom RM2.10/kg.
- 青兰: general RM0.90/kg; bottom RM1.10/kg.
- 加晒 and 加西 remain distinct.

A generic alias shared by multiple fishing contexts requires an explicit separate-group selection; it is never silently overwritten. All 36 groups must resolve. Duplicate IDs, codes or source ownership, generated-ID collisions, unknown fields and unresolved mappings stop the whole operation. Missing price fields differ from explicit null, and server timestamps and document versions retain nanoseconds.

## Protected operator workflow

Use Node 20.19+ and the pinned dependencies via `npm ci`. `npm run ql-master -- help` is offline. No command was executed against production during development.

Every production read requires separate OWNER authorization for `fishSpecies` (complete collection, at most 1000 documents) and, for operation status/rollback, the exact `fishSpeciesAdoptions/<manifestHash>` journal. Snapshot files contain business data and must use a restricted, reviewed output location. No other production collection is read by this tool.

1. After read authorization: `npm run ql-master -- snapshot --project ccm-fishery-os-4490d --actor OPERATOR_EMAIL --read-approved --output SNAPSHOT.json`.
2. Offline: `npm run ql-master -- plan --project ccm-fishery-os-4490d --actor OPERATOR_EMAIL --snapshot SNAPSHOT.json --output MANIFEST.json`. Optional `--separate FILE.json` supplies reviewed source-key selections.
3. Review the full manifest, preserved records, exact actor/project, SHA-256 and the new journal document. OWNER must separately approve these specific production creates/field changes and journal write. Code or deployment approval does not authorize them.
4. `npm run ql-master -- apply --project ccm-fishery-os-4490d --actor OPERATOR_EMAIL --manifest MANIFEST.json` only validates offline. Real application additionally requires `--execute --approved-hash MANIFEST_SHA256 --output RECEIPT.json` and existing ADC whose authenticated email exactly matches the manifest. Missing credentials are reported; no login, key creation or client fallback occurs.
5. An authorized `status` command takes the same project/actor/manifest, `--read-approved` and a fresh output path. It reads the authoritative journal and Master consistently. It does not write.

The tool refuses unknown arguments, existing output files, project/actor/hash/action mismatches and production emulator routing. Demo tests require both the exact `demo-ccm-rules` project and an explicit loopback emulator. Never supply production credentials to demo tests.

## Atomicity, retry and rollback

The server SDK reads the entire Master query and operation journal **inside one serializable transaction**, compares every document's exact version/data to the approved snapshot and validates uniqueness before queuing writes. At most 36 changed Master documents plus one journal are committed atomically; unchanged groups are skipped. Complete before/after images are archived in the same transaction. Audit timestamps use the authoritative query read time with nanoseconds, not the operator's local clock. They are audit observation times, not a claim to equal Firestore commit time.

The journal makes retries of an already applied manifest a true zero-write result. A lost network response or local receipt failure is not proof of transaction failure: use authorized status; do not blindly treat it as a failed import. A rolled-back manifest cannot be reapplied; take a fresh snapshot and obtain fresh approval.

Rollback is a separate production change requiring separate approval:

1. After read authorization, `rollback-plan` with `--manifest MANIFEST.json --read-approved --project PROJECT --actor EMAIL --output ROLLBACK.json` checks committed after-images and captures the exact server versions of every changed document.
2. Review the rollback hash and target list. `rollback` remains offline without `--execute`; actual execution needs `--manifest MANIFEST.json --rollback-approval ROLLBACK.json --approved-hash ROLLBACK_HASH --project PROJECT --actor EMAIL --execute --output ROLLBACK_RECEIPT.json`.
3. One transaction rechecks every after-image and version. Any intervening change cancels the entire rollback. Existing documents recover their full previous fields, including originally absent price/reference fields, while recording the rollback actor/time. Newly created records are deactivated and retained, never deleted. Historical references and documents are untouched. The journal is marked rolled back atomically.

The journal is restricted to 900 KiB, below Firestore's document limit. The manifest has the same archive bound. Neither bound increases an existing business capacity threshold.

## Release and verification gates

Existing edit windows (7-day weighing, 90-day settlement, 30-day Retail), monetary rules, vessel premiums and customer-reference calculations remain unchanged. Rules changes only add optional per-line Retail remarks and protect QL source ownership; equivalent string validation is compacted to fit the unchanged compiled-size guard of **253,952 bytes**.

Run typecheck, lint, tests, build, compiled Rules guard and the existing pinned Firebase 15.29.0 demo Emulator CI job. That job includes actual server-SDK adoption, concurrent zero-write repeats, aborted transaction atomicity, history preservation and guarded rollback tests. Unit/CLI tests additionally cover callback retry, lost receipts, exact actor/hash authorization, stale snapshots and nanosecond precision. A local Windows Emulator start failure does not count as a test pass; Linux CI must pass before merge/release.

Deployment remains separate: reviewed CI-passing clean main, exact OWNER-approved commit/resources, required indexes ready, Rules and pointer verification, then Hosting. Hosting/Rules rollback uses the recorded previous release artifacts; data rollback uses the separately approved transaction above. Production Master adoption is never part of an ordinary Hosting deployment.
