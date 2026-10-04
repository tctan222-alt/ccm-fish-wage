# Settlement lifecycle and recovery

Owner contract: formal fish-head/fish-meal finalization, 90 consecutive days,
local recovery, and independent vessel history search. This supersedes the older
settlement pricing UI's use of the weighing seven-day window.

## Draft, Finalize, Edit, Lock

Keep `purchaseSettlementDrafts` and immutable `purchaseSettlementSources` binding.
Stored statuses: `settlement_draft` (DRAFT), `settlement_finalized` (FINALIZED).
LOCKED is derived at 90 days; no scheduled writes or extra settlement document.

Drafts retain P5/P6 actual document identity, saved snapshots and stable source
revision reads. An audited weighing correction can still reconcile a draft's
date/vessel/weights. Reading does not bind/migrate legacy drafts. Same-vessel,
same-day source IDs remain distinct.

Complete weighing before first finalization. One transaction reads the source,
binding and settlement; rejects stale revisions; writes settlement, new binding
if needed, and action atomically. Concurrent creates/finalizes cannot duplicate
the authoritative document. First finalize uses `serverTimestamp()` and signed-in
UID for `finalizedAt`/`finalizedBy`. A server read confirms the resolved finalized
timestamp; a newer revision during confirmation is reported, with local input kept.

After finalization, creation, first finalization, product/source, vessel/code,
business date and sort keys are immutable. Edit updates paper number, prices/lines,
totals and current source revision; retains finalized status and increments revision.
Viewing retains the saved finalized lines/amounts. Entering Edit explicitly reviews
same-identity source weight corrections. Changed source vessel/date prevents edits
rather than silently relabeling the finalized invoice.

Rules enforce **`request.time < finalizedAt + duration.value(90, 'd')`**.
Exactly 90 days is locked. Client/device time or business date cannot extend it.
UI deadline is advisory, refreshes while open and rechecks on Save; Rules govern.
Reopening never resets the first finalization. Independent windows remain:
**weighing 7 days / settlement 90 days / Retail 30 days**.

Existing nullable-price validation, defaults and integer-cents calculations remain.
Unpriced items are visibly listed, no price guessed; their amounts retain the
existing zero rule. No payments, new accounting ledger or receipt confirmation
workflow is introduced.

## Audit and Rules size

Reuse `purchaseSettlementDrafts/{actualId}/actions/{revision}` with exact
beforeSnapshot/afterSnapshot, performedBy/performedAt, revision and type:
`save_draft`, `finalize`, `edit_after_finalize`. Rules require the correct snapshots,
type, revision and server-time/user atomically. Old actions stay readable/unchanged;
audit/settlement hard deletion remains denied. Draft void protections are retained.

Only settlement Rules were compacted: required property accesses already reject
missing fields; exact valid date/month identity makes the old length/range checks
redundant; optional null uses equivalent Map.get; repeated action validation is
shared. No unrelated permission or **253,952-byte** guard was weakened/changed.

## Local recovery and retry

Versioned browser localStorage key: user + productType + sourceSessionId. Stores
receipt number, raw priceInputs (including temporarily invalid text), reconstructible
lines, source/settlement revisions, vessel/date identity and local update time.
Local data is never an official save or trusted server time. Storage errors are visible.

Reload/return shows **发现未完成草稿**, **恢复草稿 / 放弃草稿**. Never restore
silently. Compare source/product/revisions/date/vessel/code. A mismatch shows
**服务器资料已更新，本机草稿需要重新核对。**, disables restore and presents
local/server paper, weight and price comparison. Record/check old values before
discarding and manually entering reviewed values on the current server data.

Clear only after confirmed server save/finalize/edit or explicit discard. Failure,
offline, timeout and ambiguous result keep local data. Dirty in-page context changes
are blocked until Save/explicit discard. Vessel retry only retries vessels; source
retry only follows read failure and offers recovery after successful read. Validation,
save, vessel, source, clipboard and local-storage errors are separate.

Dirty tracking includes the complete line snapshot, including weight/basket-only
corrections. Explicit discard restores all baseline lines/prices/paper and exits
finalized Edit mode. Once tracked, a local draft stays synchronized even when input
returns to baseline. An unreadable local record blocks editing/autosave until explicit
retry/discard; it is not overwritten. Save success removes only the exact submitted
stored snapshot, preserving newer local input written by another page during the save.

## Complete weighing

Unconfirmed kg, any remark (including a hidden total-weight meal remark), unfinished
date or edited paper number blocks both opening and submitting Complete. Save the
basket or explicitly clear current input first. Clear restores saved paper/date,
clears current kg/remark; never deletes committed baskets or IndexedDB queue.
No discard-and-complete shortcut.

## Independent search and legacy compatibility

- `mode=date`: existing Today/Week/Month/custom range, optional vessel/source status,
  bounded ISO/canonical compatibility query retained.
- `mode=vessel`: required vessel, no dates/month probes. One projected server query
  per page: productType + vesselId + source-status equality/IN; order
  `dateSortKey DESC, __name__ DESC`; limit 25; numeric date/full-reference cursor.
- Optional source status remains all / weighing / completed / legacy processed.
  Settlement Draft/Finalized/Locked is separately displayed per row. A batched
  projected settlement header join (and bounded legacy receipt header batch) avoids
  N+1 details. Never eagerly fetch lines, entries, species or actions. Formal saved
  totals remain visible after source revision change; stale draft amounts are unknown.
- URL preserves mode/preset/range/vessel/status and validated same-module detail
  return link. Refresh/Back re-queries first page with those criteria; transient
  loaded pages/cursors are not persisted as authoritative data.
- Historical inactive vessels are selectable; head/meal remain isolated.
- `processed` = **旧版采购单 Legacy processed**: old flow generated a draft purchase
  receipt; its separate confirmation remains unchanged. It does not prove FINALIZED.
  No historical reclassification, re-numbering, migration or data writes.

## Mandatory future release preflight — Owner confirmed

Do not release vessel search as complete historical coverage until this gate.
Old records may lack dateSortKey; ordering by it excludes them. DD/MM/YYYY string
order is not chronological across years. Owner approved a future release prerequisite,
not production writes in this task.

1. Future authorized agent pages projected weighingSession headers only (e.g. 100)
   ordered by **__name__**, document-reference cursor; select productType,
   weighingDate/dateSortKey. Do not order by dateSortKey during the audit or it omits
   the documents under inspection. Use existing authenticated read access; log no tokens.
2. Inspect each page with pure/read-only `auditSettlementDateKeys()`, collecting exact
   IDs, date, before/expected key. Invalid dates need manual review.
3. Present exact before/after and obtain separate production backfill authorization.
   Preserve dates/IDs, amounts/revisions/audit; recheck each record before a separately
   reviewed idempotent correction. This task has no production write/migration tool.
4. Verify zero missing/inconsistent keys. Establish the new index and wait READY.
5. Under future release approval, deploy reviewed main Rules before Hosting.

Four existing weighingDate indexes still serve date queries but cannot sort numeric
dates across years. Add only one minimal index: weighingSessions(productType ASC,
status ASC, vesselId ASC, dateSortKey DESC, __name__ DESC). All-status uses IN,
so no duplicate no-status index. Definition only, not deployed.

## Validation and release boundary

Full diff/typecheck/lint/app tests/build, Rules Emulator using firebase-tools 15.29.0,
fixed size guard. This Windows host's Node 26 experimental Web Storage conflicts
with jsdom; local browser tests use process-only NODE_OPTIONS=--no-experimental-webstorage.
CI browser uses Node 20 and Rules uses Node 22; no permanent machine setting changed.

Local validation: 1001/1001 app tests, 74/74 Rules tests; typecheck, lint and build
passed. Compiled Rules: 253,695 / 253,952 bytes. Local browser fixtures exercised
reload/recovery/finalization and vessel search at 320/375/390/430px without whole-page
horizontal overflow or console errors. These are not production or physical iPhone checks.

No production deploy/writes/import/migration, Rules/index deployment, Functions,
Blaze or firebase init. Reviewed CI-green merge → sync clean main → STOP.
