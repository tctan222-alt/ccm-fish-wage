# Development Log

## 2026-07-28 — v0.3.1 authentication and deployment preparation
- Firebase Authentication state is resolved before the wage route is imported, preventing worker and wage data access before sign-in.
- Email/Password uses Firebase's normal browser persistence. There is intentionally no public registration or password reset.
- Firebase app initialization reuses an existing app during Vite hot reload and tests. The production Web configuration targets `ccm-fishery-os-4490d`; these values are public client identifiers, not credentials.
- Firestore rules allow authenticated worker management without hard deletion and constrain wage creation and soft deletion. Rules still require owner approval and deployment.
- Hosting serves `dist`, rewrites SPA routes, avoids caching `index.html`, and caches fingerprinted assets. Hosting still requires owner deployment.
- Passwords, private keys, service-account JSON, and Firebase Admin credentials must never enter source control.

## 2026-07-28 — v0.3 entry decisions
- Rates and calculated wages use integer cents in the UI and are serialized as exact two-decimal strings in Firestore to avoid binary floating-point display errors.
- Duplicate detection is session-local and begins only after a successful save. It warns for an identical worker, weight, and rate inside five seconds, then permits an explicit second save.
- `dateKey` is generated explicitly in the `Asia/Kuala_Lumpur` time zone rather than using the device's local date.
- Worker reads remain in the single worker service, ordered by the existing `order` field and limited to 20 active workers.
- `fishHeadWageEntries` is the canonical and only collection name for individual Fish Head Cutting Wage records.
- Pull requests and pushes to `main` run dependency installation, typecheck, lint, tests, and the production build under Node.js 20.
- Duplicate detection remains session-local: another device or a refreshed browser session is not considered by the five-second warning.
