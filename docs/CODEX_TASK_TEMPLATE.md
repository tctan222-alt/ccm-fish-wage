# Codex Task Template

Use this template for future CCM Fishery ERP Codex tasks.

## Objective

Describe the exact outcome requested.

## Repository

`tctan222-alt/ccm-fish-wage`

Start from the latest `main` branch.

## Scope

Allowed files or areas:

- List approved paths.

Forbidden files or areas:

- List paths Codex must not modify.

## Business-rule constraints

- State whether wage, purchase, weighing, settlement, worker, authentication, or Firestore rules may change.
- If rules may change, describe the exact intended rule change.
- If rules may not change, say so explicitly.

## Implementation requirements

- List required behavior.
- List required documentation.
- List required tests.

## Validation

Run and report:

- `node --check eslint.config.js`
- `npm run typecheck`
- `npm run lint`
- `npm test -- --run`
- `npm run build`

For docs-only tasks, run and report:

- `git diff --check`
- `git diff --stat`

## Deployment

State whether deployment is forbidden, prepared only, or explicitly authorized. Production deployment requires owner approval in the current task.

## Pull request

Commit message:

`Describe the focused change`

Pull request title:

`Describe the focused change`

Final report must include changed files, validation results, commit SHA, PR status, and any remaining owner intervention.
