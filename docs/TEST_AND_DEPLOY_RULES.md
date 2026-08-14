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

## Docs-only validation

For docs-only work:

- Confirm the diff only contains approved documentation files.
- Run `git diff --check` when a local checkout is available.
- Run `git diff --stat` or an equivalent compare to summarize changed files.
- Do not run production deployment commands.

## Firebase deployment rules

Owner approval is required before any production deployment.

- Firestore rules must be reviewed before deployment.
- Firebase Hosting deployment must be initiated by the owner or explicitly authorized by the owner.
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
