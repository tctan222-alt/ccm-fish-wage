# Wage Rules

This document records the wage-domain rule baseline for future Codex tasks. It is descriptive documentation only and does not change runtime behavior.

## Scope

Wage workflows include Fish Head Wage entry, worker management, worker statements, wage persistence, and related Firestore records.

## Rule-change policy

- Do not change wage calculation business rules unless the task explicitly asks for that rule change.
- Do not alter the fast wage-entry workflow in unrelated tasks.
- Preserve existing wage tests when making docs-only or infrastructure changes.
- Add or update focused tests when a future task intentionally changes wage behavior.

## Current operating expectations

- Wage entry should remain iPhone-first and fast for repetitive daily use.
- Worker data must not be exposed to unauthenticated users.
- Wage entries should remain auditable.
- Hard deletion of wage records should remain prohibited unless the owner approves a clear retention policy change.

## Owner review triggers

Stop and request owner review before changing:

- Weight, rate, wage, rounding, or total calculation behavior.
- Worker lifecycle rules.
- Wage entry deletion or correction behavior.
- Firestore access rules for wage or worker collections.
- Authentication behavior that changes who can see wage or worker data.
