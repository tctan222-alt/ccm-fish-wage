# Managed cloud development setup

These commands prepare and test a checkout on the managed cloud computer. They
do not use a personal PC, start a dispatcher, schedule code changes, authenticate
Firebase, or deploy anything. Repository content and GitHub checkpoints are the
durable state; a particular checkout path or cache is disposable.

## Dependency preparation

From the checkout root, run:

```sh
bash scripts/cloud-setup.sh
bash scripts/cloud-validate.sh
```

The setup script follows the numeric Node major in `.nvmrc` (currently 20, matching
the app CI job), then runs `npm ci` against the committed lockfile. If the image's
Node major differs, its existing Node/npm bootstraps the requested Node major
from the npm `node` package. No global install, administrator access, home-directory
configuration, or personal path is required. The selected patch version is
printed in the task log; an existing matching major is reused.

Tool binaries and npm downloads live in `cloud-tools` under Git's common metadata
directory, outside the `node_modules` directory replaced by `npm ci`. Validation
resolves this cache itself; it needs no sourced file or persistent shell session.
Nothing in this cache is committed. Recreating it is safe after a cloud checkout
is replaced. The scripts retain inherited proxy, CA, authentication and runtime
guard settings; a denied download is an actual environment blocker, not a reason
to bypass the network policy.

Validation runs the ESLint configuration syntax check, all repository
`scripts/*.node-test.mjs` tests (including queue/lock and cloud audit checks),
typecheck, lint, full application tests, build and `git diff --check`. It stops on
the first failing command. Existing warnings must be reported without disguising
errors. All application tests receive a complete demo-only Firebase identity
through the Vitest configuration, even if the environment has production values;
a regression test checks the actual unmocked SDK instances. This does not change
the production build configuration. No Codex task or automatic PR is launched by
either script.

## Optional Firestore Rules validation

Use a managed image with **JDK 21**. The script reports an exact blocker when Java
is absent or a different major; it does not download an unreviewed JDK or invoke
the user's computer. Then run:

```sh
bash scripts/cloud-setup.sh --rules
bash scripts/cloud-validate.sh --rules
```

Setup installs **firebase-tools@15.29.0** into the cloud tool cache and downloads
the official Firestore Emulator jar using `setup:emulators:firestore` with the
demo project. This downloads a dependency; it does not start the Emulator or run
business code. Validation checks the exact CLI version, uses a cache-local
Firebase configuration and Emulator directory, and runs the package command with the
**demo-ccm-rules** project. It then checks the unchanged compiled-size budget of
**253,952 bytes**. The Rules CI job may use Node 22 independently; these manual
cloud commands retain the app's `.nvmrc` Node major.

The execution sandbox must allow local Emulator ports for `--rules`; a denied
listen is a permission blocker, not proof that another process owns the port.
Use the supported cloud permission mechanism rather than changing project targets
or bypassing network policy.

Production Firebase credentials are not needed. Do not add service-account
files, run `firebase login` or `firebase init`, publish Rules/indexes, call a
production database, or deploy Hosting/Functions to make validation work.
Keep dependency-download network access in setup. Run application validation
with external networking denied where the cloud sandbox supports that boundary;
the Rules test needs only the local Emulator after setup has cached its jar.

## Managed environment configuration

The owner-selected cloud environment must provide a Git checkout, bootstrap
Node/npm, Bash and Git; include JDK 21 when Rules checks are needed. Network access
must permit the npm package downloads and, for Rules, the official Emulator
download. GitHub code/PR access belongs to the cloud task's authorized connection.
These scripts do not provision or publish a Codex Cloud environment, create
credentials, grant GitHub access, or claim a hosted task URL.

Use `bash scripts/cloud-setup.sh` (or `--rules`) as the environment's setup command
where that supported configuration is available. Run validation in the task
after editing. Record the actual task/PR/CI links and exact tool versions in the
GitHub issue; do not replace execution evidence with a setup recipe.

Automatic coding remains separately gated by the handover and runner requirements
in [CODEX_AUTOMATION_WORKFLOW.md](CODEX_AUTOMATION_WORKFLOW.md). A successful manual
cloud validation is not evidence of a cloud coding schedule.
