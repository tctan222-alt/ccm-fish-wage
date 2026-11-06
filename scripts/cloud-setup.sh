#!/usr/bin/env bash
set -euo pipefail

# Manual cloud preparation only. This script never starts a coding dispatcher.
CCM_RULES=false
case "${1:-}" in
  '') ;;
  --rules) CCM_RULES=true ;;
  --help) printf '%s\n' 'Usage: bash scripts/cloud-setup.sh [--rules]'; exit 0 ;;
  *) printf '%s\n' 'Usage: bash scripts/cloud-setup.sh [--rules]' >&2; exit 2 ;;
esac
if (( $# > 1 )); then printf '%s\n' 'Unexpected setup arguments.' >&2; exit 2; fi

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
if ! command -v node >/dev/null || ! command -v npm >/dev/null; then
  printf '%s\n' 'The managed cloud image needs a bootstrap Node/npm installation.' >&2
  exit 1
fi
mkdir -p "$CCM_TOOLS/npm-cache"
# Keep bootstrap artifacts outside node_modules: npm ci replaces that directory.
# Do not replace the inherited proxy, CA, credential or runtime guard settings.
export npm_config_cache="$CCM_TOOLS/npm-cache"
if [[ "$(node -p 'process.versions.node.split(".")[0]')" != "$CCM_NODE_TARGET" ]]; then
  CCM_NODE_BIN="$CCM_TOOLS/node/node_modules/.bin"
  if [[ ! -x "$CCM_NODE_BIN/node" ]] || [[ "$("$CCM_NODE_BIN/node" -p 'process.versions.node.split(".")[0]')" != "$CCM_NODE_TARGET" ]]; then
    npm install --prefix "$CCM_TOOLS/node" --no-save --package-lock=false --no-audit --no-fund "node@$CCM_NODE_TARGET"
  fi
  export PATH="$CCM_NODE_BIN:$PATH"
fi
printf 'Cloud app toolchain: Node %s, npm %s\n' "$(node --version)" "$(npm --version)"
npm ci --no-audit --no-fund

if [[ "$CCM_RULES" == true ]]; then
  if ! command -v java >/dev/null; then
    printf '%s\n' 'Rules setup blocked: select a managed cloud image with JDK 21.' >&2
    exit 1
  fi
  CCM_JAVA_MAJOR="$(java -XshowSettings:properties -version 2>&1 | awk '/java.specification.version =/ {print $3}')"
  if [[ "$CCM_JAVA_MAJOR" != 21 ]]; then
    printf 'Rules setup blocked: JDK 21 is required; observed %s.\n' "$CCM_JAVA_MAJOR" >&2
    exit 1
  fi
  npm install --prefix "$CCM_TOOLS/firebase" --no-save --package-lock=false --no-audit --no-fund firebase-tools@15.29.0
  mkdir -p "$CCM_TOOLS/firebase-config" "$CCM_TOOLS/emulators"
  PATH="$CCM_TOOLS/firebase/node_modules/.bin:$PATH" \
    XDG_CONFIG_HOME="$CCM_TOOLS/firebase-config" \
    FIREBASE_EMULATORS_PATH="$CCM_TOOLS/emulators" \
    FIREBASE_CLI_DISABLE_USAGE_REPORTING=true CI=true \
    firebase setup:emulators:firestore --project demo-ccm-rules
  printf '%s\n' 'Rules toolchain prepared: JDK 21 and firebase-tools 15.29.0; demo Emulator only.'
fi
printf '%s\n' 'Setup complete. Run bash scripts/cloud-validate.sh with the same optional --rules flag.'
