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
