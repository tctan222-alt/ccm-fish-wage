# Changelog

## 0.3.0 — 2026-07-28
- Added the iPhone-first Fish Head Cutting Wage basket entry flow.
- Added fixed and validated custom rates, integer-cent wage calculations, and Firestore snapshots.
- Added five-second possible-duplicate confirmation and rapid-tap protection.
- Added automated unit and interaction coverage for the entry rules.
- Standardized individual wage records on the canonical `fishHeadWageEntries` collection.
- Added Node.js 20 CI quality gates for typecheck, lint, tests, and production builds.
- Added authenticated Firestore rules with active-worker reads, validated wage-entry writes, and no client hard deletes.
