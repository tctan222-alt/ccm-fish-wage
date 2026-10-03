# P9 Retail Master Data

Uses the existing `/retail-sales/fish`, `/retail-sales`, `RetailFishPicker`,
`watchRetailFish`, `saveRetailFish`, inline quick-add and `retailFish` collection.
No second fish database, sale migration, hard deletion or production write script.

## Schema and compatibility

`chineseName` is trimmed, required, maximum 100 characters. `malayName` remains
optional (maximum 100); `suggestedPriceCents` is null or positive integer cents,
maximum 1,000,000. `active` is boolean. `aliases` contains at most five trimmed,
case-insensitively deduplicated names of at most 100 characters, excluding the
official name and 黑昌. `sortOrder` is an integer 0–1,000,000.

Old reads default missing aliases to `[]` and sortOrder to `0`, then order by
Chinese name and document ID. Nothing is written on read. New quick-add appends
after the maximum order, uses empty aliases and normal creation audit fields.
Normal updates preserve createdBy/createdAt and update updatedBy/updatedAt.
Rules accept absent new fields for compatibility with the currently deployed
client, but validate both fields when present, including every alias slot.

Search ranks exact official Chinese, exact Malay, exact alias, prefix, contains;
ties use Master order. Alias selection snapshots the official names and price.
Inactive records remain editable and reactivatable, are excluded from sale
selection and prevent duplicate quick-add through their official name/aliases.
Ambiguous exact identities do not silently select a first result on Enter.

Master save checks official/alias collisions against the currently read master
collection (including inactive identities), including official/alias versus
another fish's Malay name. Malay names are not globally unique: two different
fish may share a Malay translation, with explicit selection when search is ambiguous.
This is application validation, not a globally atomic identity reservation for
simultaneous edits on different devices. Each individual write retains the
existing audited Firestore transaction. No new reservation collection was added.

Sale price overrides and existing RetailLine snapshots remain independent of
Master Data. Print, PDF, history, wage and settlement mechanisms are unchanged.

## OWNER dataset status

Searched repository/docs, Retail seed Git history, locally supplied backlog and
task attachments. The only literal existing seed is the three starter records:
甘丰 / kembung / RM6, 马丰 / mabong / RM8, 上过 / kerabu / RM33.
These are not the requested complete OWNER batch. No translation or price has
been inferred from Purchase, Fish Head, the web or model knowledge.

`retailOwnerDataset` is null. `validateRetailOwnerDataset` rejects an absent
batch; it is a pure validator with no Firestore write dependency. The existing
explicit three-starter action remains separate and skips an already-existing
Chinese identity even when its document ID differs. It does not overwrite prices.

Retail Master implementation completed; owner literal dataset source is unavailable, therefore no guessed seed was created.

Literal batch row count and its duplicate/reconciliation report are unavailable.
After OWNER supplies the literal batch, a separate reviewed dry-run must reconcile
existing IDs, report all conflicts, preserve existing audit/history and update
only explicitly supplied fields. Production execution needs separate approval.

## Deprecated name proposal

New official/alias 黑昌 is rejected and never offered in the sale picker.
`planDeprecatedRetailNames` is pure: it proposes `active: false` for a legacy
official 黑昌 and removes 黑昌 aliases, retaining IDs and historical documents.
It performs no reads or writes. Exact production IDs/before/after must be reviewed
and approved separately; no production Master scan/correction was run here.

大乌昌、乌昌、大中乌昌、中乌昌、乌昌仔、小乌昌仔 remain distinct identities;
tests protect their names. They were not synthesized into a guessed seed batch.

## Release boundary

P8 Hosting was released from `ff903b10c8277c869bad8090c9034c85df814e11`.
P9 changes Rules and requires a separately approved Rules-first/Hosting release
after merge. P9 is not deployed. No Functions, Blaze, Firebase init, production
Master or test records. Priority 10 is not started.
