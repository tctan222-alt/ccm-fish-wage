#!/usr/bin/env bash
set -euo pipefail

# Validation only: no scheduler, coding runner, deployment or production data path.
CCM_RULES=false
case "${1:-}" in
  '') ;;
  --rules) CCM_RULES=true ;;
  --help) printf '%s\n' 'Usage: bash scripts/cloud-validate.sh [--rules]'; exit 0 ;;
  *) printf '%s\n' 'Usage: bash scripts/cloud-validate.sh [--rules]' >&2; exit 2 ;;
esac
if (( $# > 1 )); then printf '%s\n' 'Unexpected validation arguments.' >&2; exit 2; fi

CCM_SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
CCM_REPO_ROOT="$(git -C "$CCM_SCRIPT_DIR/.." rev-parse --show-toplevel)"
cd "$CCM_REPO_ROOT"
CCM_GIT_COMMON="$(git rev-parse --path-format=absolute --git-common-dir)"
CCM_TOOLS="$CCM_GIT_COMMON/cloud-tools"
CCM_NODE_TARGET="$(tr -d '[:space:]' < .nvmrc)"
if [[ ! "$CCM_NODE_TARGET" =~ ^[0-9]+$ ]]; then
  printf '%s\n' '.nvmrc must contain the numeric Node major used by CI.' >&2
  exit 1
fi
if [[ "$(node -p 'process.versions.node.split(".")[0]')" != "$CCM_NODE_TARGET" ]]; then
  CCM_NODE_BIN="$CCM_TOOLS/node/node_modules/.bin"
  if [[ ! -x "$CCM_NODE_BIN/node" ]] || [[ "$("$CCM_NODE_BIN/node" -p 'process.versions.node.split(".")[0]')" != "$CCM_NODE_TARGET" ]]; then
    printf '%s\n' 'Cloud Node toolchain missing. Run bash scripts/cloud-setup.sh first.' >&2
    exit 1
  fi
  export PATH="$CCM_NODE_BIN:$PATH"
fi
if [[ ! -x node_modules/.bin/vitest ]]; then
  printf '%s\n' 'App dependencies missing. Run bash scripts/cloud-setup.sh first.' >&2
  exit 1
fi
export npm_config_cache="$CCM_TOOLS/npm-cache"
printf 'Validating with Node %s, npm %s\n' "$(node --version)" "$(npm --version)"
node --check eslint.config.js
node --test scripts/*.node-test.mjs
npm run typecheck
npm run lint
npm test
npm run build
git diff --check

if [[ "$CCM_RULES" == true ]]; then
  CCM_FIREBASE_PACKAGE="$CCM_TOOLS/firebase/node_modules/firebase-tools/package.json"
  if [[ ! -f "$CCM_FIREBASE_PACKAGE" ]] || [[ "$(node -p 'require(process.argv[1]).version' "$CCM_FIREBASE_PACKAGE")" != 15.29.0 ]]; then
    printf '%s\n' 'Pinned Rules toolchain missing. Run bash scripts/cloud-setup.sh --rules first.' >&2
    exit 1
  fi
  if ! command -v java >/dev/null || [[ "$(java -XshowSettings:properties -version 2>&1 | awk '/java.specification.version =/ {print $3}')" != 21 ]]; then
    printf '%s\n' 'Rules validation blocked: a managed cloud JDK 21 is required.' >&2
    exit 1
  fi
  export PATH="$CCM_TOOLS/firebase/node_modules/.bin:$PATH"
  export XDG_CONFIG_HOME="$CCM_TOOLS/firebase-config"
  export FIREBASE_EMULATORS_PATH="$CCM_TOOLS/emulators"
  export FIREBASE_CLI_DISABLE_USAGE_REPORTING=true
  export CI=true
  # package.json pins this invocation to demo-ccm-rules, never the real project.
  npm run test:rules
  npm run test:rules:size
fi
printf '%s\n' 'Cloud validation passed. No production operation was performed.'
