# Queue setup safe trial — 2026-10-20

Setup contract: [#59](https://github.com/tctan222-alt/ccm-fish-wage/issues/59).
OWNER-authorized test contract: [#60](https://github.com/tctan222-alt/ccm-fish-wage/issues/60).
This was a manually initiated **real local Codex development run**, not a fired
09:00 scheduler event. Scheduled execution is configured separately; this trial
does not prove a future unattended run has happened.

## Observed discovery and claim

- Started from clean, synced main `015fa674749fdbf323fbf17f7cfc25fa7d60e518`.
- GitHub live open queue contained #60 as the only `codex-ready` Issue.
  Unlabelled #24/#40/#41/#59 and unrelated Draft PRs #32/#36 were left untouched.
- Acquired the shared Git-directory lock as
  `ccm-20261020-safe-trial-60` at `2026-10-20T06:27:19.689Z`.
- A second acquire with `ccm-20261020-competing-run` returned exit 1:
  `Dispatcher lock already exists`; status still showed the original owner.
- The offline planner selected `claim`, issue 60, no PR. Approval was derived
  from the direct OWNER setup/trial request, not inferred from the label.
- Re-read #60 and its empty comment list before recording one claim comment and
  transitioning `codex-ready` → `codex-in-progress`; read-back confirmed it.
- This documentation task uses the same focused branch/PR as the #59 queue
  infrastructure, `chore/issue-59-automation-workflow`. The initial `codex/...`
  name was renamed after GitHub rejected it because remote branch `codex`
  already exists; that existing branch was preserved. No business feature was
  started to consume quota.

## Executable safety checks

The Node queue suite tests real local filesystem locks and pure queue snapshots:
at most one selection, priority, active issue/PR resume, held/unrelated drafts,
stale merged PR labels, missing approval, invalid flags, duplicate IDs,
`owner-decision`, `codex-blocked`, `codex-done`, production release and production
write requests. These protected-action checks are **local fixtures**, not fake
production records or newly opened release requests.

The lock is same-host coordination, not a distributed mutex or a sandbox.
Only one dispatcher is enabled; activating a second host requires a separate
coordination design. The planner cannot prove human approval by itself.

## Schedule and completion evidence

One desktop heartbeat, ID `ccm-erp`, uses the committed reusable prompt and
09:00 daily Malaysia time, with Monday PR closeout in the same run. It was created
paused while configuration was being validated. Enable only after clean review,
PR/main CI and merge verification; verify the stored prompt and schedule.
The computer must remain awake with the desktop app running.

Final PR/head/main CI, merge SHA, activation and lock-release evidence are
recorded on #59/#60 so this document does not predict a future CI or merge result.
The trial must not be marked done if those gates fail.

Production deploy: **NO**. Production data writes/backfill/import/migration:
**NO**. ERP runtime, Firestore Rules and index definitions are unchanged.
