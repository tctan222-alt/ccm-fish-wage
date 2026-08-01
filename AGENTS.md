# AGENTS.md

## Decision Threshold Mode

This project uses decision threshold mode. The agent should minimize user involvement in non-decision technical work.

Do not ask before doing the following:

- Inspecting the repository and existing code
- Designing the technical implementation
- Editing code and tests
- Running typecheck, tests, and build
- Investigating and fixing errors from code, tests, builds, deployment, or Git conflicts
- Cleaning up temporary files
- Deploying to Firebase
- Running `git add`, `git commit`, and `git push`
- Checking `git status` and deployed production results

Ask the user only when:

1. A business rule has multiple reasonable options and will affect operations.
2. An action is irreversible or may delete or bulk-change real data.
3. The task involves accounts, passwords, keys, security rules, or opening access permissions.
4. The task involves payment, purchase, external sending, formal publication, or legal responsibility.
5. Required information cannot be reasonably inferred from code, Git history, Firestore structure, or existing documentation.

Do not ask about ordinary technical choices. If code, tests, deployment, or Git fails, investigate and fix it first. Stop for the user only when a business decision is genuinely required.

## Fixed Project Rules

- Project directory: `C:\Users\tctan\ccm-fish-wage`
- Firebase project: `ccm-fishery-os-4490d`
- Never run `firebase init`.
- Preserve all existing usable functionality.
- Use integer cents for monetary amounts.
- Weight must be integer kilograms from 1 to 300.
- Wage records must never be hard deleted.
- Voiding must retain an audit record.
- Typecheck, tests, and build must all pass before deployment.
- Deploy Firebase Hosting only when frontend changes are made.
- When Firestore Rules change, deploy both `firestore:rules` and `hosting`.
- Never deploy an unreviewed feature branch to formal production. Formal Firebase deployment must be built from reviewed and merged `main`; use only local Emulator or Hosting Preview for unmerged branches.
- Do not commit `node_modules`, `dist`, `.firebase`, `*.tsbuildinfo`, or temporary scripts.
- After completion, automatically commit and push to `main`.

## Completion Report

After each task, report only:

- What was completed
- Business decisions that need user confirmation
- Test and build results
- Deployment result
- Hosting URL
- Git commit SHA
- Whether any unresolved issues remain
