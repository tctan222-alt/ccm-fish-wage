# Development Log

## 2026-07-28 — v0.3 entry decisions
- Rates and calculated wages use integer cents in the UI and are serialized as exact two-decimal strings in Firestore to avoid binary floating-point display errors.
- Duplicate detection is session-local and begins only after a successful save. It warns for an identical worker, weight, and rate inside five seconds, then permits an explicit second save.
- `dateKey` is generated explicitly in the `Asia/Kuala_Lumpur` time zone rather than using the device's local date.
- Worker reads remain in the single worker service, ordered by the existing `order` field and limited to 20 active workers.
- `fishHeadWageEntries` is the canonical and only collection name for individual Fish Head Cutting Wage records.
- Pull requests and pushes to `main` run dependency installation, typecheck, lint, tests, and the production build under Node.js 20.
- Duplicate detection remains session-local: another device or a refreshed browser session is not considered by the five-second warning.
