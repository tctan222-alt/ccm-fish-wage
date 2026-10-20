# AGENTS.md

## Operating Mode

This project uses decision-threshold mode. Minimize user involvement in ordinary technical work.

The GitHub issue or explicit task request is the working contract. Do not ask the user to relay messages between ChatGPT, Codex, GitHub, or CI.

For scheduled development, follow [`docs/CODEX_AUTOMATION_WORKFLOW.md`](docs/CODEX_AUTOMATION_WORKFLOW.md). Only an OWNER-approved, unblocked `codex-ready` Issue is eligible for a new claim. Continue an existing authorized PR first; claim at most one new Issue per run. A historical backlog entry, label added without OWNER authorization, or previous production approval is not permission to start new work or publish it.

Do not ask before:
- Inspecting repository code, history, issues, pull requests, and relevant documentation
- Choosing ordinary implementation details
- Editing code and tests
- Running targeted tests, typecheck, lint, full tests, and build
- Investigating and fixing code, test, build, CI, deployment, or Git errors
- Cleaning temporary files
- Creating a feature/fix/chore branch
- Committing and pushing work to that branch
- Opening or updating a pull request
- Checking CI and deployed production results

Ask the user only when:
1. A business rule has multiple reasonable options and materially affects CCM operations.
2. An action is irreversible or may delete or bulk-change real data.
3. The task involves accounts, passwords, keys, security rules, or opening access permissions.
4. The task involves payment, purchase, external sending, formal publication, or legal responsibility.
5. Required business information cannot reasonably be inferred from the issue, code, Git history, Firestore structure, or relevant project documentation.

Do not ask about ordinary technical choices. If code, tests, CI, deployment, or Git fails, investigate and fix it first. Stop for the user only when a genuine business decision or protected credential/action is required.

## Context Budget Rules

Use the smallest relevant context. Do not reread or summarize the whole repository for every task.

Always start with:
1. This `AGENTS.md`.
2. The current GitHub issue/task.
3. The directly affected code/tests.

Read additional documents only when relevant:
- CCM business boundaries or operating rules -> `CCM_CONTEXT.md`
- Fish-head cutting wage rules -> `FISH_HEAD_WAGE_RULES.md`
- Phase-one scope -> `PHASE_1_SCOPE.md`
- Phase-one acceptance behavior -> `PHASE_1_ACCEPTANCE_TESTS.md`
- Phase-one data model -> `PHASE_1_DATA_MODEL.md`
- Product-level V1 specification -> `SPEC.md`
- Legacy/system archaeology or broad regression investigation -> `CURRENT_SYSTEM_AUDIT.md`
- Historical implementation decisions -> `DEVLOG.md` / `CHANGELOG.md`

Do not read `CURRENT_SYSTEM_AUDIT.md`, `DEVLOG.md`, `CHANGELOG.md`, or every specification by default. Prefer code search, focused file reads, and `git diff` over dumping large files into context.

Do not copy large documentation sections into task reports. Link to the governing file or state only the specific rule used.

## Source of Truth

Priority:
1. Latest confirmed business decision in the current issue/task from the CCM owner
2. `CCM_CONTEXT.md`
3. Relevant task-specific rules such as `FISH_HEAD_WAGE_RULES.md`
4. Relevant phase scope/data/acceptance documents
5. `SPEC.md`
6. Existing application behavior
7. Generic assumptions

If two sources conflict, follow the higher-priority source and fix stale documentation when it is clearly safe to do so.

## Development Workflow

1. Start new work from current `main`; continue an existing authorized task on its linked branch. Inspect and preserve local changes before switching branches. Never reset or discard an unfinished run's work.
2. Never implement normal feature/fix work directly on `main`.
3. Create a focused branch such as `feature/...`, `fix/...`, `hotfix/...`, or `chore/...`.
4. Inspect only the affected area and relevant rules.
5. Implement the smallest complete change that satisfies the acceptance criteria.
6. During iteration, run targeted tests first. Do not repeatedly run the entire suite after every small edit.
7. Before opening or finalizing a PR, run the full quality gate once:
   - `npm ci` when dependencies need installation
   - `npm run typecheck`
   - `npm run lint`
   - `npm test`
   - `npm run build`
8. If Firestore Rules change, also run compile, applicable Emulator tests using `firebase-tools@15.29.0`, and the compiled-size guard before merge. Keep the guard at 253,952 bytes; unknown or failing Rules size blocks merge.
9. Commit and push the branch, then open a PR to `main`.
10. Keep the PR small and describe business outcome, changed scope, verification, deployment impact, and unresolved decisions only.
11. Do not deploy an unmerged feature branch to formal production. Use the local Emulator for previews; Firebase Hosting Preview also requires separate explicit authorization.
12. Merge to `main` only when required checks/CI pass, material review findings are resolved, Rules size is known, and no unresolved OWNER decision remains. Do not silently promote a Draft PR: honor any hold instruction and record its readiness and validation before changing its state.
13. Verify the merged commit, sync clean `main` with `origin/main`, and report code completion. Merge is not a production release.

## Deployment Rules

- Firebase project: `ccm-fishery-os-4490d`.
- Never run `firebase init`.
- Documentation-only changes require no Firebase deployment.
- Scheduled development must never deploy production Hosting, Firestore Rules, indexes, Functions, or any other production resource. A release needs separate, explicit OWNER approval identifying the target commit and resources in a release task; merge, green CI, and `codex-ready` do not grant it.
- Only after that separate approval, release from clean, synced, reviewed, CI-passing `main`. When dependencies require it, use `firebase-tools@15.29.0` in order: indexes → verify all required indexes READY → Rules and actual release pointer verification → Hosting. Stop if a preceding gate fails.
- Production business-data writes, backfills, imports, migrations, and test records are forbidden without separate explicit OWNER approval of exact scope and before/after fields. A deployment approval does not approve data changes.
- Do not introduce Functions, Blaze, paid services, or access/security loosening under the development automation.
- If production deployment requires a missing credential, secret, or permission, do not weaken security or commit credentials. Report that single blocker.
- Never deploy from an unreviewed branch to formal production.

## Fixed Project Rules

- Project directory: `C:\\Users\\tctan\\ccm-fish-wage`
- Preserve all existing usable functionality unless the task explicitly replaces it.
- Use integer cents for monetary amounts.
- Weight must be integer kilograms from 1 to 300 unless a newer confirmed business rule supersedes this.
- Wage records must never be hard deleted.
- Voiding must retain an audit record.
- Historical records must not be silently rewritten when defaults change.
- Preserve the independent 7-day weighing, 90-day settlement, and 30-day Retail edit windows, existing audits, and module data isolation unless the OWNER explicitly approves a business-rule change.
- Typecheck, lint, tests, and build must pass before release.
- Do not commit `node_modules`, `dist`, `.firebase`, `*.tsbuildinfo`, secrets, or temporary scripts.

## Completion Report

After each task, report only:
- What was completed
- Business decisions that need user confirmation, or `None`
- Test/build/CI result
- Deployment result
- Hosting URL when deployment occurred
- Git commit SHA / PR number
- Unresolved issues, or `None`

Do not restate the whole implementation plan or project history in the completion report.
