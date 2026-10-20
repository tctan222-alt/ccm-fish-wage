# Codex Baseline

This document defines the baseline operating rules for Codex work on the CCM Fishery ERP repository.

## Repository scope

- Start new implementation work from the latest `main` branch. Resume an existing authorized task on its linked branch; inspect and preserve any local changes first.
- Inspect the current code, tests, rules, and documentation before changing files.
- Keep changes focused on the requested scope.
- Treat user-provided scope limits as authoritative.
- Stop and report before modifying files that the task explicitly forbids.
- Scheduled runs follow [the automation workflow](CODEX_AUTOMATION_WORKFLOW.md): continue an existing authorized PR first, otherwise claim at most one OWNER-approved, unblocked `codex-ready` Issue. Do not promote stale/unlabelled Issues or old backlog paragraphs into approved work.

## Default guardrails

- Do not change wage, purchase, weighing, settlement, or Firestore business rules unless the task explicitly asks for that rule change.
- Do not introduce service-account JSON, private keys, passwords, user email addresses, Firebase Admin credentials, or production secrets.
- Scheduled development cannot deploy Firebase Hosting, Firestore Rules/indexes, Cloud Functions, Cloud Run, App Hosting, or any other production resource. A separate explicit OWNER release approval must identify the commit and resources; merge and CI success are not deployment approval.
- Do not perform production business-data writes, backfills, imports, migrations, or fake/test records without separate explicit OWNER approval of exact scope and before/after fields. Release approval is not data-write approval.
- Never run `firebase init`, introduce Functions/Blaze/paid services, or loosen access as a workaround.
- Preserve the independent 7-day weighing, 90-day settlement, and 30-day Retail edit windows, audit trails, and module data isolation unless a new OWNER-approved task changes them.
- Do not disable lint rules, delete tests, weaken assertions, or hide failing checks.
- Prefer small commits with reviewable diffs.

## Conflict handling

When a patch conflicts or touches out-of-scope files:

1. Stop the patch.
2. Report the conflicted and out-of-scope files.
3. Restore the worktree to the current branch HEAD when the owner asks for a reset.
4. Restart from a clean branch with only the approved file set.

## Required validation

For code changes, run the repository quality gates requested by the task. For docs-only changes, at minimum verify the diff is limited to documentation paths and run whitespace checks where a local checkout is available.

Rules changes require compile, Emulator tests with `firebase-tools@15.29.0`, and the unchanged 253,952-byte compiled-size guard. Unknown Rules size, red CI, unresolved material review, or pending OWNER decisions block merge. A Draft PR must not be silently promoted; honor its hold instructions and record readiness first. Only a separately approved release may proceed through required indexes READY → Rules successfully published and verified → Hosting.
