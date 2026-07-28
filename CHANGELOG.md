# Changelog

## 0.3.1 — 2026-07-28
- Added persistent Firebase Email/Password authentication, a mobile-first login screen, friendly errors, and sign out; public registration is not available.
- Gated the wage application and its data services behind resolved authentication state.
- Configured the `ccm-fishery-os-4490d` Web client with hot-reload-safe initialization and documented environment variables.
- Prepared authenticated Firestore worker/wage rules and Firebase Hosting for owner-reviewed deployment; no deployment was performed.
- Added mocked authentication tests that never contact live Firebase.

## 0.3.0 — 2026-07-28
- Added the iPhone-first Fish Head Cutting Wage basket entry flow.
- Added fixed and validated custom rates, integer-cent wage calculations, and Firestore snapshots.
- Added five-second possible-duplicate confirmation and rapid-tap protection.
- Added automated unit and interaction coverage for the entry rules.
- Standardized individual wage records on the canonical `fishHeadWageEntries` collection.
- Added Node.js 20 CI quality gates for typecheck, lint, tests, and production builds.
- Added authenticated Firestore rules with active-worker reads, validated wage-entry writes, and no client hard deletes.
