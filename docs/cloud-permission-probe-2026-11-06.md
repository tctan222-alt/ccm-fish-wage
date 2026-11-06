# Issue #74 controlled cloud permission probe

This document exists only on the dedicated permission-test branch. Do not merge it.

- Owner scope: manually validate existing cloud account/environment/GitHub write and subscription scheduling permissions.
- Baseline main: `fe81b9f1f614f272d3393ad1f017cad7001bcbc8`.
- Allowed branch: `test/issue-74-cloud-permission-20261106-1443`.
- Allowed mutable path: `docs/cloud-permission-probe-2026-11-06.md` only.
- Probe nonce: `ccm74-native-write-20261106-1443`.
- No main, production configuration, Firebase, business data, credentials, paid API, schedule or held PR changes.
- The current connected GitHub account reports admin/push. Creating this document tests that connector's branch contents write; it does not prove native Codex write rights.
- CLI status reports an existing ChatGPT login; cloud task listing reports token parsing failure. No credential values were collected or printed.
- Existing CCM weekly automation is status-only, with no exposed coding-environment binding.
- Prior actual native cloud task: https://chatgpt.com/s/cd_6aede013b0888191b8d6409d0d39f773 ; its report says GitHub CLI lacked authentication and its proxy rejected GitHub fetch with403.
- Controlled native result: PENDING. A single manually requested native task may append its observed branch/HEAD/Node/check result below and push only to the allowed branch, using existing permissions. If unavailable, report the blocker; do not create credentials or change access.

## Native result

No result has been supplied by the native probe yet.
