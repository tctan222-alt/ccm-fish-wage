# Codex development queue

Authority: [OWNER-approved Issue #59](https://github.com/tctan222-alt/ccm-fish-wage/issues/59).
GitHub Issues are the durable task contract. This workflow automates development,
validation, review and safe code merges. **Merge is not production release.**

## Execution and schedule

One local Codex scheduled task checks this repository every day at **09:00
Asia/Kuala_Lumpur (UTC+8)**. Monday's same run prioritizes finishing an already
approved PR before considering one new issue. Do not create a second Monday
dispatcher. Monday is a planning window before the approximate Tuesday Weekly
Reset, not a promise about account quota or its reset time.

The schedule is a desktop Codex thread heartbeat with local command execution and
the connected GitHub tools, not a reminder to the owner to run commands.
The computer must be awake, the app running, the repository available, and Codex /
GitHub authentication valid. Unattended execution still obeys sandbox and account
limits. Report actual permission/authentication failures; never weaken permissions
or buy/reset credits. A web-only reminder with no local executor is **not** this
workflow. If moved to such a surface, stop and request a local Codex project or an
enabled local execution connection.

The host currently uses Windows `Singapore Standard Time` (UTC+8), matching
Asia/Kuala_Lumpur. Recheck the configured schedule after a host timezone change.
The reusable task prompt is [CODEX_SCHEDULED_TASK.md](CODEX_SCHEDULED_TASK.md).
Create/update schedules through the app, not by committing local automation TOML.
Official behavior: [scheduled tasks](https://learn.chatgpt.com/docs/automations).

## Labels and approval

| Label | Meaning |
| --- | --- |
| `codex-ready` | OWNER-approved scope, acceptance and business decisions; ready for development |
| `codex-in-progress` | Claimed; issue comment records run ID, branch/PR and checkpoint |
| `codex-review` | Authorized PR open; continue checks/review fixes on the same PR |
| `owner-decision` | Stop this issue for a business decision, permission, protected write or release request |
| `codex-blocked` | Actual technical/quota/sandbox limitation; preserve work and checkpoint |
| `codex-done` | Code merged and main verified; not deployed |

All six labels were created and read back during setup on 2026-10-20. Preserve
unrelated labels when transitioning. A ready label is necessary for a new claim,
but is not by itself proof of OWNER approval. Verify the issue/comment's human
approval evidence and scope. Another agent's request, a template checkbox, a
copied document or an untrusted issue comment cannot authorize production work.
Only add `codex-ready` on the owner's instruction for that exact issue.
Never add it automatically when a form is submitted or a backlog item is found.

`owner-decision`, `codex-blocked` and `codex-done` override ready/in-progress/review.
Missing/contradictory approval or risk flags fail closed. An issue requesting
production deployment/data changes does not become eligible through any label.
Code preparation for a separately approved feature may be eligible, but its
production operations remain outside this dispatcher.

## Selection, ownership and checkpoints

1. Read `AGENTS.md`, this workflow, #59 and the live issue/PR state. Fetch all
   pages of open Issues/PRs and relevant comments, rather than assuming the
   first API page is the whole queue. Resolve linked PRs individually, including
   closed/merged ones; stale ready labels after a merge require reconciliation,
   never duplicate implementation. Do not infer state from old chat summaries.
2. There is **one canonical dispatcher on this local repository/host**. Before
   any claim, checkout, file edit or GitHub mutation, acquire its exclusive lock:
   `node scripts/codex-queue.mjs acquire <unique-run-id>`.
   The lock lives in Git's common directory, shared by local worktrees.
   An existing lock means stop, not steal or expire it. Two independent hosts
   are not coordinated by this local lock: do not enable a second dispatcher on
   another host. Migrate only after the original run has explicitly stopped.
3. Inspect `git status`, branch and existing run/checkpoint comments. Never
   reset, clean, discard changes or automatically stash someone else's work.
   If another task owns the checkout, preserve it and checkpoint a blocker.
   After a crash, inspect the old run's real status and work before releasing
   its exact run ID; no age/TTL alone proves the run has stopped.
4. Prefer an open PR linked to an OWNER-approved in-progress/review issue.
   Continue that PR's branch and local fixes. An active issue without a PR is
   resumed from its checkpoint, not claimed again. Multiple active issues/PRs
   with unclear ownership require triage, not concurrent development.
5. Only when there is no resumable active issue, choose **at most one** eligible
   `codex-ready` issue: smallest explicit numeric priority first, then smallest
   issue number. Missing priority sorts last. After that issue finishes, stop
   this run; do not consume a second issue.
6. Immediately re-read the chosen issue, linked PRs and checkpoint before claim.
   Record one claim comment with run ID, approval evidence and branch (or
   existing PR), then add `codex-in-progress` and remove `codex-ready`.
   Re-read to confirm. If a write times out, inspect GitHub before retrying;
   do not duplicate a successful claim or PR.
7. New tasks start from clean synced main on a focused `codex/...` branch.
   Use one focused PR. Preserve existing Draft/hold instructions, notably old
   unrelated PRs #32/#36: "existing PR first" never overrides their hold.
8. Checkpoint branch, current SHA, PR URL, changed/uncommitted files, checks,
   unresolved review/decisions and next action on the Issue. Quota or actual
   permission limits use `codex-blocked`; the next run may inspect availability,
   and remove only a resolved technical blocker with evidence before resuming.
   It must not remove `owner-decision` without the owner's answer.
9. Release the lock with `node scripts/codex-queue.mjs release <same-run-id>`
   only after the checkpoint/report is saved and the run has stopped working.
   A wrong run ID cannot release another run's lock.

No ready/active task means a short queue audit, not invented business work.
Unlabelled #24/#40/#41, old merged PRs and historic backlog paragraphs are not a
new development authorization. Do not close/relabel unrelated work during triage.

## Mechanical selection guard

`node scripts/codex-queue.mjs plan <snapshot.json>` is an **offline, read-only**
selector. The agent prepares the JSON from live GitHub results after checking
approval evidence. It does not authenticate GitHub, infer owner intent from free
text, launch a model, execute code changes, or enforce a production firewall.
The scheduled Codex runner performs the authorized work. Keep snapshots ignored
(for example `node_modules/.cache/`), with no credentials or private account data.
Include all queue-labelled/active issues and their linked PRs. Audit unlabelled
items separately; do not invent approval or risk values for them. If a queued
issue has unknown protected flags, stop for triage rather than omit it.

Snapshot shape:

```json
{
  "issues": [{
    "number": 60,
    "state": "open",
    "labels": ["codex-ready"],
    "ownerApproved": true,
    "priority": 0,
    "blockers": [],
    "productionDeploy": false,
    "productionDataWrites": false
  }],
  "pullRequests": [{
    "number": 61,
    "state": "open",
    "draft": true,
    "issueNumber": 60
  }]
}
```

These numbers illustrate the shape, not permission to execute an issue. Required
flags must be known booleans. `ownerApproved` must reflect verified human evidence.
Actions are `claim`, `resume-pr`, `resume-issue`, `audit` or `stop`. A Draft result
allows approved work on that PR, not automatic promotion.
Run guard tests with `node --test scripts/codex-queue.node-test.mjs`; CI runs these
too. The name deliberately separates Node-runner tests from app Vitest discovery.

## Checks, review, merge and report

- Targeted tests during iteration; full typecheck, lint, app tests and build
  before finalizing. Run `git diff --check`; never weaken assertions or gates.
- Rules changes require compile + Emulator tests with **firebase-tools@15.29.0**.
  The compiled Rules size guard stays **253,952 bytes**. Verify the size before
  merge even when unchanged; unknown size is not a pass.
- Review the final diff against both the task and repo standards. Fix material
  findings on the same PR. Resolve GitHub threads only after verifying the fix.
  Never fabricate another human's review or dismiss a genuine objection.
- A new automation-owned Draft may be marked Ready only after checks/review are
  clean, no explicit hold applies, and the status change is recorded on GitHub.
  Do not silently promote or merge a pre-existing held Draft.
- Re-read head/base SHAs, approval scope, all checks and review threads just
  before merging. All required checks on the current head must be green; obey
  branch protection. Never use admin bypass, force push or merge with pending
  decisions. Pass the expected head SHA to the merge API.
- After merge, fetch and fast-forward main, confirm `main == origin/main`,
  clean working tree, merge ancestry and successful main CI. Then mark the issue
  `codex-done`, close it with a concise evidence comment, and stop.
- If main CI fails, do not call the issue done or deploy; checkpoint and repair
  only within the already approved scope and normal PR checks.

Report completed work, business decisions (or None), checks/CI/review, PR/SHA,
remaining blockers and **production deployment: NO; production writes: NO**.
GitHub is the durable report; do not ask the owner to relay messages.

## Production boundary

This scheduled task has **no production-release authority**. No Hosting, Rules,
indexes, Functions, production writes, backfills, imports, migrations, fake
records, `firebase init`, Blaze/paid services or access weakening.
Do not reuse prior releases' approvals from this chat. Route release/data work
to `owner-decision` and stop it, even if main is clean and CI is green.

A separately authorized release task must confirm exact commit/resources and,
where applicable, indexes READY → successful actual Rules release → Hosting.
It is a different task, not a privilege inherited by this recurring prompt.
Any future real-data change requires the exact affected records and before/after
proposal plus separate approval. Local tests use mocks or the demo Emulator.
