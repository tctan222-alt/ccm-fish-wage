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
