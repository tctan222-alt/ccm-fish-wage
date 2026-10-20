# Test And Deploy Rules

This repository separates validation from owner-controlled production deployment.

## Quality gates for code changes

Run and fix the requested checks for implementation tasks:

- `node --check eslint.config.js`
- `npm run typecheck`
- `npm run lint`
- `npm test -- --run`
- `npm run build`

Do not disable rules, remove tests, weaken assertions, add broad ignores, or hide failures to make checks pass.

Rules changes also require compile, applicable Rules Emulator tests with `firebase-tools@15.29.0`, and the existing compiled-size guard of **253,952 bytes**. Do not raise the guard. Unknown or failing Rules size, red required CI, unresolved material review, or a pending OWNER business decision blocks merge. Keep an explicit checkpoint if an environment or quota limit prevents verification.

## Docs-only validation

For docs-only work:

- Confirm the diff only contains approved documentation files.
- Run `git diff --check` when a local checkout is available.
- Run `git diff --stat` or an equivalent compare to summarize changed files.
- Do not run production deployment commands.

## Firebase deployment rules

Scheduled development ends at verified code merge; **merged does not mean deployed**. Queue state, a `codex-ready` label, or green CI is never production approval. See [the automation workflow](CODEX_AUTOMATION_WORKFLOW.md).

- Every production deployment requires a separate explicit OWNER release approval identifying the commit and exact resources. This includes Hosting, Firestore Rules, indexes, Functions, and any other production resource.
- Deploy only from clean, synced, reviewed, CI-passing `main`, using `firebase-tools@15.29.0`. For a release requiring all three resources: indexes → verify every required index READY → publish reviewed Rules and verify the actual release pointer → Hosting. Stop if any preceding gate fails; a created ruleset alone does not prove Rules are live.
- Production business-data writes, backfills, imports, migrations, and fake/test records need separate explicit OWNER approval of the exact affected scope and before/after proposal. Release approval alone never authorizes these writes.
- The scheduled developer must stop a release or protected-write request with `owner-decision`; it must not execute it as a normal queue task.
- Never run `firebase init`, introduce Functions/Blaze/paid services, loosen access, or commit credentials as an automation workaround.
- Email/Password authentication must be enabled in the Firebase console by the owner.
- Administrator users must be created out of band.
- Codex must not claim production deployment when a task only prepares configuration or documentation.

## Secrets policy

Never commit:

- Passwords.
- Private keys.
- Service-account JSON.
- Firebase Admin SDK credentials.
- User email addresses.
- Other production secrets.

Firebase Web client configuration is public client configuration, but it should still be documented intentionally and not confused with service-account credentials.
