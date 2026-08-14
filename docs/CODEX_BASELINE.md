# Codex Baseline

This document defines the baseline operating rules for Codex work on the CCM Fishery ERP repository.

## Repository scope

- Start every implementation task from the latest `main` branch.
- Inspect the current code, tests, rules, and documentation before changing files.
- Keep changes focused on the requested scope.
- Treat user-provided scope limits as authoritative.
- Stop and report before modifying files that the task explicitly forbids.

## Default guardrails

- Do not change wage, purchase, weighing, settlement, or Firestore business rules unless the task explicitly asks for that rule change.
- Do not introduce service-account JSON, private keys, passwords, user email addresses, Firebase Admin credentials, or production secrets.
- Do not deploy Firebase Hosting, Firestore rules, Cloud Functions, Cloud Run, App Hosting, or any other production resource from Codex unless the owner explicitly authorizes deployment in the current task.
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
