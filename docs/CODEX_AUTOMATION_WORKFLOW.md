# Cloud development queue

Authority: [Issue #74](https://github.com/tctan222-alt/ccm-fish-wage/issues/74)
updates the execution model established by
[Issue #59](https://github.com/tctan222-alt/ccm-fish-wage/issues/59).
GitHub stores source, approved task contracts, PRs, checks and checkpoints.
**Code merge is not production release.** No personal PC or fixed checkout path
is required for the cloud preparation and validation described here.

## Execution state and handover

The owner has selected a managed cloud development environment. A manually
initiated cloud task has already read source, installed dependencies, tested,
pushed a branch, opened/repaired/reviewed and merged [PR #75](https://github.com/tctan222-alt/ccm-fish-wage/pull/75)
for #73. Its merged main CI is [42227398229](https://github.com/tctan222-alt/ccm-fish-wage/actions/runs/42227398229).
#73 is closed with `codex-done`; its approved QL fallback must not be reimplemented.
The missing ERP Sheet runtime read authorization is documented separately in
[QL_CUSTOMER_PRICES.md](QL_CUSTOMER_PRICES.md).

The former desktop `ccm-erp` heartbeat was configured at 09:00
Asia/Kuala_Lumpur. That historical configuration did **not** migrate with the
repository. On 2026-11-06 the owner confirmed in the cloud conversation that it is disabled,
with no active task or omitted unpushed work; that attestation is recorded in #74.
This resolves the legacy-host handover gate. It is not an independent remote
inspection: absence from a cloud automation list alone would not prove shutdown.
The old computer is not required for future cloud development.

Before enabling **any** cloud coding dispatcher:

1. Record evidence in #74 that the old schedule is disabled, any active run is
   stopped, and dirty/unpushed work is preserved on its authorized branch.
2. Establish one coding worker. Inspect live issue/PR ownership and checkpoints;
   reconcile any other active run instead of starting another worker.
3. Demonstrate the selected cloud trigger can invoke a capable coding environment
   with source, shell, tests and authorized GitHub PR access. Record a real run
   link, permissions, credential source, usage restrictions and cost basis.
4. Verify the current account's supported configuration. A working manual cloud
   task, an environment attachment, a reminder, CI, or a status check alone does
   not demonstrate unattended coding.

The old-host gate is resolved; cloud coding-trigger verification remains open.
Until all gates pass, only separately owner-requested **manual migration
preparation** and read-only status/validation run. Do not launch a second coding
worker or claim a business issue under the old schedule. Keep #74's outstanding
handover/authorization decisions visible; do not mark the entire migration done.

## Cloud setup and available scheduling mechanisms

Use [CODEX_CLOUD_SETUP.md](CODEX_CLOUD_SETUP.md) for portable setup and validation.
The checkout root comes from Git; `.nvmrc` supplies the app Node major. There is
no personal account directory, drive letter, or required persistent local cache.
Cloud tool caches are disposable and source/checkpoints remain in GitHub.

| Mechanism | What it actually does | Current boundary |
| --- | --- | --- |
| Owner-started managed cloud task | Runs source edits, tests and the authorized PR workflow | Demonstrated by #73 / PR #75; current migration preparation is manual |
| Existing GitHub Actions CI | Runs quality and demo Rules checks on PR/main, or manual dispatch | Cloud validation; never a coding executor |
| `CCM queue audit` Actions workflow | Daily 01:00 UTC (09:00 Malaysia) or manual dispatch; GET-only queue inventory in job summary | Read-only: no claims, code, model calls, PR/label changes, merge or release |
| Existing ChatGPT weekly CCM status task | Reports GitHub state and suggested next step | Its saved prompt does not claim to launch Codex; no verified coding environment binding |
| Native cloud Scheduled/Work coding task | Potential subscription-based path | Not configured/proven here; must demonstrate actual execution and pass handover gates first |
| Native GitHub `@codex` coding mention | A non-review PR mention can start a cloud coding chat and push with permission | Documented subscription route; scheduled Actions-bot actor/account linkage and actual coding execution are unverified here |
| Official Codex GitHub Action | Model-based coding on a hosted runner | Its documented API-key path needs separate API billing/credits and an owner-approved cap. Not installed or enabled |

The queue audit's built-in `GITHUB_TOKEN` has only contents/issues/pull-request
read permissions. It does not infer owner approval from labels or issue prose.
Its schedule can be delayed by GitHub; the run summary is status evidence, not a
promise to start development at that minute. Standard hosted runners for this
public repository do not require a new paid coding service. No new API account,
secret, self-hosted runner, paid service or spending commitment is introduced.

Native GitHub coding mentions are an additional possible subscription path, not
just code review. Existing automatic Review does not establish write-capable
coding or a scheduled Actions actor. No official evidence here establishes that
`github-actions[bot]` maps to the owner's ChatGPT account/entitlement; a GitHub API
token alone is not ChatGPT authentication. Verify repository/environment linkage,
trusted actor, branch rights, usage limits and a controlled coding run before
posting scheduled mentions. The read-only audit never posts mentions. GitHub
workflow-recursion rules do not prove how a third-party Codex App handles bots.
Do not copy a personal `auth.json` to this public repository or its Actions: the
official advanced ChatGPT-managed CI authentication route excludes public repos.

The installed `codex cloud list --json --limit 5` returned HTTP 401 during the
migration assessment. Existing shell/GitHub connector access does not imply
native Codex task-management authentication. No login or task submission was
attempted. Do not invent a native Codex task URL; record actual PR and Actions run
URLs and identify this management limitation until a supported account connection
exposes the native task.

Official references checked 2026-11-06:
[Codex Cloud](https://help.openai.com/en/articles/20001545-using-codex-cloud),
[Scheduled Work](https://learn.chatgpt.com/docs/automations?surface=app),
[native GitHub coding tasks](https://learn.chatgpt.com/docs/third-party/github#give-codex-other-tasks),
[Codex GitHub Action](https://learn.chatgpt.com/docs/github-action),
[non-interactive authentication](https://learn.chatgpt.com/docs/non-interactive-mode#authenticate-in-automation),
[separate API billing](https://help.openai.com/en/articles/9039756-managing-billing-for-chatgpt-and-the-api-platform),
[GitHub-hosted runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).
A documented product capability is not evidence that this account has configured it.

## Approval and selection

`codex-ready` means owner-approved, unblocked development; `codex-in-progress`
records a claim; `codex-review` records an authorized PR. `owner-decision`,
`codex-blocked` and `codex-done` override actionable labels. Preserve unrelated
labels. Verify current human approval and known production-risk booleans; a label,
historic backlog, copied text or another agent cannot grant authority.

Read AGENTS.md, this workflow, #59, #74, the actual task and all relevant live
issues/PRs/comments. Fetch all pages, resolve linked merged/closed PRs, and never
repeat merged work because a label is stale. Held Draft PRs **#32/#36** remain
held. Do not promote, resume or merge them. Unlabelled historical work is not an
approved new task.

Resume one authorized active PR/checkpoint first, then at most one eligible issue
by explicit numeric priority and issue number. An issue with unknown ownership,
missing approval, protected production work, or unresolved decision is blocked.
Record a unique run ID, actual cloud run link when exposed, branch/head/PR,
checks and next action on GitHub; immediately re-read ownership before mutation.
GitHub comments/labels are durable checkpoints, **not an atomic distributed lock**.
Do not race two claim writers. If a platform supplies only separate concurrent
workers without shared serialization, unattended mutation remains blocked.

## Offline planner and checkout-local lock

Before editing one checkout, use:

```sh
node scripts/codex-queue.mjs acquire <unique-run-id>
node scripts/codex-queue.mjs status
node scripts/codex-queue.mjs plan <snapshot.json>
node scripts/codex-queue.mjs release <same-run-id>
```

The Git-common-directory lock protects only that checkout and its worktrees.
Separate cloud clones, hosts, Actions jobs and old desktop runs do not share it.
An existing lock means stop, not expire/steal it; preserve all local changes and
release only your own run after its checkpoint. Never reset, clean or auto-stash
another run's work. A lock's age or an offline machine does not prove it is safe.

The planner is offline and does not log in, launch Codex, claim issues, establish
permissions or enforce a production firewall. Snapshots must include explicit
`executionContext` plus `issues` and `pullRequests`:

```json
{
  "executionContext": {
    "mode": "prepare",
    "cloudCodingVerified": false,
    "legacyDispatcherStopped": true,
    "noOtherWorker": true
  },
  "issues": [],
  "pullRequests": []
}
```

This current preparation example returns `prepare` with no selected business
issue. Missing context returns `stop`. `manual` / `scheduled` coding selection
requires all three observations to be true. For `scheduled`, verified coding
means the actual scheduled trigger completed a coding invocation, not manual
Cloud/CI success. The caller must substantiate these facts; toggling JSON flags
is not evidence or authorization. `null` is an unknown observation and blocks.

Issue records retain number/state/labels, verified `ownerApproved`, numeric or
null `priority`, blockers and explicit `productionDeploy:false` /
`productionDataWrites:false`. PR records retain number/state/draft/issueNumber.
The original queue selection, merged-work reconciliation and hold guards remain.
Keep snapshots in ignored scratch storage, with no credentials. Run guard and
audit tests with `node --test scripts/*.node-test.mjs`.

## Review, code merge and production boundary

Work on a focused branch from clean synced main; preserve and continue existing
authorized fixes. Run targeted tests, then full typecheck/lint/app tests/build,
`git diff --check`, independent Standards/Spec review and current-head GitHub CI.
Rules changes require firebase-tools@15.29.0 compile/Emulator tests; always verify
the compiled guard of **253,952 bytes** before code merge, even when unchanged.
Unknown size, red CI, material review or an unresolved decision for that code scope
blocks merge. A preparation PR may describe unresolved activation blockers, but
must not activate a coding worker or claim handover is complete.

Honor holds and drafts; document any permitted Ready transition. Re-read exact
head/base, approval, checks and unresolved threads before merging; obey protection,
pass the expected head SHA, never bypass or force push. After a permitted merge,
fetch/fast-forward main, check clean `main == origin/main`, reviewed-tree/ancestry
and exact main CI. Mark only the completed scope done, preserve remaining #74
handover blockers and stop after the authorized task.

**No production Firebase Hosting, Rules, indexes, Functions or other release. No
production business-data reads/writes, backfill, import, migration, test records,
`firebase init`, Blaze, new paid services, secret commits or access weakening.**
Release and data-change requests require separate exact-scope owner approval;
they cannot inherit approval from merge, CI, queue labels or this migration.
Keep the independent 7-day weighing / 90-day settlement / 30-day Retail windows
and audits. Checkpoint actual quota/auth/sandbox blockers without discarding work
or claiming a fabricated reset/usage balance. Report actual links/results, pending
owner decisions and production operations **NO**.
