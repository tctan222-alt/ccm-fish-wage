# Firestore Rules deployment size check

Issue #27 traced the release PATCH `400 INVALID_ARGUMENT` to the compiled rules
size limit. CLI rules compilation and ruleset creation can succeed even when a
ruleset is too large to release. CLI 15.29.0 then tries creating the existing
release, producing the secondary `409 ALREADY_EXISTS` error.

Firebase documents separate limits: 256 KiB source and **250 KiB (256,000 bytes)
compiled rules**. See [Security rule limits](https://firebase.google.com/docs/firestore/security/rules-structure#security_rule_limits).

## Evidence and correction

On 2026-09-06, the active production ruleset
`583d5c49-d023-42ee-b40f-230bbcb9ec6d` had a V1 executable of **255,669 bytes**:
only 331 bytes below the runtime limit. Its source was 165,646 bytes.
The main rules with retail sales measured **271,271 compiled bytes**, exceeding
the runtime limit despite remaining below the source limit. The new CI guard
was also run against this baseline and correctly rejected it.

The shared lazy `incomingData()` / `existingData()` accessors reduce repeated
property-access AST nodes. Expanding these two helpers reproduces all previous
conditions exactly, except the separately reviewed retail decimal-weight
validation. They do not change authentication, authorization, audit, immutability,
or document-access requirements. Retail now uses integer `weightDeciKg` (0.1 kg)
and integer cents, rounded half up per line.

## Local / CI guard

With Java 21 and firebase-tools 15.29.0 installed:

```sh
npm run test:rules
npm run test:rules:size
```

The emulator run downloads compiler jar v1.22.0. The size check compiles locally
without credentials or production access. It removes source-position metadata
except the root expression of each permission, matching the deployed V1 format.
This transformation was calibrated against the production ruleset above: the
local result and the downloaded production executable were protobuf-equal and
both measured 255,669 bytes. The corrected decimal rules measured **246,972 bytes**.

CI fails above **253,952 bytes**, leaving 2 KiB below the service limit. This is a
compiled-size estimate using emulator internals, not a supported backend API or
a replacement for security tests and deployment verification. When upgrading
the pinned emulator/compiler, recalibrate against the read-only
[release getExecutable API](https://firebase.google.com/docs/reference/rules/rest/v1/projects.releases/getExecutable)
before changing the guard. `FIREBASE_EMULATORS_PATH` can select a custom emulator
cache; no rules are uploaded by the check.

Production release must still follow `AGENTS.md`: all gates pass, reviewed PR
merged to main, build from main, deploy `firestore:rules`, then deploy Hosting.
Never bypass a failed Rules release by deploying Hosting alone.
