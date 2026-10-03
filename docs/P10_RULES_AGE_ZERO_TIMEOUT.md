# P10 Rules age-zero timeout diagnosis

## Scope and finding

Baseline: merged main `29d8a0c74624be31a7f45ca7c78f02577a9bd26b` (PR #52).
The release preflight stopped correctly at 60/61 Rules tests. Its only failure
was the 5,000 ms timeout of `src/firestore.rules.test.ts`:

`Firestore Rules: Retail 30-day numbered protocol > compiles the unchanged expiry expression at a deterministic clock: age 0 seconds`

Classification: **test harness / fixture setup**, not an observed slow Rules
update. Each boundary case uploaded and compiled the entire ruleset inside the
5-second test body. It also created its invoice, groups, counter and audit there.
The original cold isolated case passed at **4,991 ms**; the first isolated case
on the newly started warm Emulator timed out at **5,048 ms**. A single pass was
therefore insufficient evidence of stability.

There was a second reproducible isolation defect: `cleanup()` disposes clients,
but does not clear that project's documents. Ten subsequent isolated invocations
on the same Emulator failed with permission errors from retained group/audit
IDs, rather than timing out. Those failures are not evidence of a slow Rules
path. Clearing only the local demo project's fixtures separated this problem
from compilation overhead.

Temporary stage probes, after clearing the demo fixture, measured:

| Stage (ms) | Probe 1 | Probe 2 | Probe 3 |
| --- | ---: | ---: | ---: |
| Initialize environment / upload and compile Rules | 1,901 | 1,751 | 1,591 |
| Create numbered invoice fixture | 419 | 376 | 363 |
| Read and set deterministic createdAt | 79 | 82 | 55 |
| Authenticated update and Rules assertion | 102 | 96 | 76 |
| Cleanup | 0 | 1 | 0 |

All probes were local; no production latency measurement or production writes
were made. The exact cause of the initial machine-load variation is not proven.
The measurable design defect was compilation/initialization inside each timed
assertion, plus incomplete fixture isolation. All temporary probes were removed.

## Environment and CI comparison

| Item | Local diagnosis | Baseline main Rules CI |
| --- | --- | --- |
| OS | Windows | Ubuntu 24.04 |
| Node | 26.5.1 | 22.23.3 |
| Firebase CLI used for controlled runs | 15.29.0 | 15.29.0 |
| Java / Temurin | 21.0.12+8 | 21.0.12+1 |
| Firestore Emulator | 1.22.0 | 1.22.0 |
| Vitest | 3.2.7 | 3.2.7 |
| Per-test timeout | Default 5,000 ms | Default 5,000 ms |

Baseline CI run: [37111042265](https://github.com/tctan222-alt/ccm-fish-wage/actions/runs/37111042265).
It passed 61/61 in 25.80 seconds; age zero took 2,145 ms. Both environments use
the same Node Rules config, with no setupFiles/globalSetup or concurrent tests.
`emulators:exec` starts the Emulator and waits for readiness before the runner.
No duplicate Emulator or port conflict was observed during controlled diagnosis.

The global local `firebase.cmd` is **15.25.0**. The earlier preflight separately
checked 15.29.0, but then `npm.cmd run test:rules` resolved the global CLI.
Both CLI versions select Emulator 1.22.0; CLI drift alone is not established as
the timeout cause. This diagnosis explicitly selected 15.29.0 for every Emulator
startup. No dependency or global tool was upgraded. The earlier app/Rules gates
ran concurrently; timing measurements here ran without the app gate competing.
Node/OS/load differences are recorded, not assumed to be causal.

## Minimal test-only fix

- Compile the deterministic clock ruleset once in an awaited `beforeAll`,
  matching the existing setup pattern for the unmodified production ruleset.
- Run all six boundary cases against that same compiled environment.
- Await `clearFirestore()` for the boundary demo project before every case.
- Clean up the shared environment in `afterAll`.
- Check the source helper boundaries before substituting the test-only clock.
- Strengthen the existing two-edit regression fixture to begin at day 20,
  retaining all its immutable createdAt, invoice identity, revision and audit
  assertions.

There is no timeout adjustment, sleep, retry-to-pass, skip, only, todo, mock
Rules assertion, business logic change or production `firestore.rules` change.
Compilation remains awaited and can fail the setup hook; it is not bypassed.
The Emulator process is not restarted per boundary case.

## What age zero verifies

Only `now()` calls inside the source `retailEditOpen` helper are substituted with
the deterministic timestamp `2026-10-31T02:00:00Z`; its comparisons and
2,592,000-second duration remain unchanged. The fixture's original `createdAt`
is this timestamp minus the case's age. At age zero the helper clock equals
createdAt, so a valid, authenticated, audited update must succeed. The invoice
is created with the real counter/audit protocol before its deterministic clock
fixture is seeded locally. All other Rules still use actual `request.time`.

The six cases continue to allow ages 0, 86,400, 2,505,600 and 2,591,999 seconds,
and deny 2,592,000 and 2,592,001 seconds. The unmodified production Rules remain
loaded separately and enforce SAVE-time expiry, missing timestamps, immutable
identity, revision, amounts, audits, auth and no-delete behavior. The day-20
two-edit case retains original createdAt on both edits. An editor opened before
expiry cannot save against an expired original timestamp.

## Stability evidence after the fix

Cold isolated case: **passed, 1,052 ms**. Initial warm isolated case:
**passed, 510 ms**.

Ten subsequent isolated invocations, same already-ready Emulator, original
5-second timeout:

| Run | Result | age-zero duration (ms) |
| --- | --- | ---: |
| 1 | pass | 1,530 |
| 2 | pass | 661 |
| 3 | pass | 600 |
| 4 | pass | 534 |
| 5 | pass | 545 |
| 6 | pass | 517 |
| 7 | pass | 526 |
| 8 | pass | 490 |
| 9 | pass | 493 |
| 10 | pass | 484 |

Three consecutive complete suites, each with a fresh Emulator startup:

| Run | Result | Test-file elapsed (s) | Command incl. startup/shutdown (s) | age-zero (ms) |
| --- | --- | ---: | ---: | ---: |
| 1 | 61/61 | 22.721 | 40.157 | 215 |
| 2 | 61/61 | 23.239 | 40.435 | 232 |
| 3 | 61/61 | 22.757 | 40.120 | 199 |

All full runs had zero skipped tests. Isolated runs used only a runner name
filter; no exclusion was committed. Raw timing reports are local temporary
files, not tracked repository artifacts.

Independent `npm.cmd run test:rules:size` compiled the unchanged production
Rules successfully: **252,647 bytes**, unchanged from P10 merge and below the
unchanged **253,952-byte** CI budget.

Local full quality gate: `git diff --check`, ESLint config syntax, typecheck,
lint, **816/816 app tests** and production build passed. Lint retains the
existing AuthProvider fast-refresh warning; build retains the existing chunk
size warning. Neither is changed by this test-only task.

### Reproduction commands (PowerShell)

To avoid resolving the older global CLI, select the validated version explicitly:

```powershell
npx.cmd --yes firebase-tools@15.29.0 emulators:exec --only firestore --project demo-ccm-rules 'node node_modules/vitest/vitest.mjs run --config vitest.rules.config.ts src/firestore.rules.test.ts -t age.0.seconds$ --reporter verbose'
npx.cmd --yes firebase-tools@15.29.0 emulators:exec --only firestore --project demo-ccm-rules 'node node_modules/vitest/vitest.mjs run --config vitest.rules.config.ts src/firestore.rules.test.ts --reporter verbose'
npm.cmd run test:rules:size
```

These are local demo Emulator checks, not production commands. Release approval
is separate. This task does not deploy Rules, Hosting or Functions; it does not
write production business/Master records, import the OWNER dataset, alter PR #36
or mark P10 production deployed.
