#!/usr/bin/env bash
# Sedef lane verifier — Chrome extension (Manifest V3, Vite/TypeScript, Playwright).
# Immutable during build/QA/release. Usage: bash .sedef/verify.sh <contract|quick|acceptance [phase-XX]|full|store>
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck disable=SC1091
[ -f .sedef/project.env ] && source .sedef/project.env

MODE="${1:-quick}"
ARG="${2:-}"
DIST_DIR="${DIST_DIR:-dist}"

log() { printf '▶ %s\n' "$*"; }
die() { printf '✖ %s\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "missing tool: $1"; }

deps() {
  [ -f package.json ] || die "no package.json yet — phase-01 scaffolds the extension"
  if [ ! -d node_modules ]; then npm ci --no-audit --no-fund || npm install --no-audit --no-fund; fi
}

manifest_check() {
  need jq
  local m="${DIST_DIR}/manifest.json"
  [ -f "$m" ] || m="public/manifest.json"
  [ -f "$m" ] || die "manifest.json not found in ${DIST_DIR}/ or public/"
  jq -e '.manifest_version == 3' "$m" >/dev/null || die "manifest_version must be 3"
  if jq -e '(.permissions // []) + (.host_permissions // []) | index("<all_urls>")' "$m" >/dev/null; then
    die "avoid <all_urls>; request the narrowest host permissions (prefer activeTab)"
  fi
  if jq -e '.content_security_policy.extension_pages // "" | test("unsafe-eval")' "$m" >/dev/null; then
    die "remote/eval code is not allowed in MV3"
  fi
  log "manifest ok ($m)"
}

contract() {
  need jq
  [ -f .sedef/feature_list.json ] || die "missing .sedef/feature_list.json"
  local bad=0 id f
  while IFS= read -r id; do
    f="tests/acceptance/${id}.spec.ts"
    if [ ! -f "$f" ]; then echo "missing contract: $f"; bad=1; continue; fi
    grep -Eq '@phase-[0-9]+' "$f" || { echo "$f: no @phase-XX tag"; bad=1; }
  done < <(jq -r '.[].id' .sedef/feature_list.json)
  [ "$bad" = 0 ] || die "acceptance contracts incomplete"
  log "contracts ok"
}

quick() {
  deps
  npm run --if-present typecheck
  npm run --if-present lint
  npm run --if-present test:unit
  npm run build
  manifest_check
  log "quick ok"
}

acceptance() {
  local tag="${1:-}"
  deps
  npx playwright install chromium >/dev/null
  compgen -G "tests/acceptance/*.spec.ts" >/dev/null || die "no acceptance specs"
  if [ -n "$tag" ]; then
    if ! grep -lq -- "@${tag}" tests/acceptance/*.spec.ts; then log "no contracts tagged ${tag}"; return 0; fi
    npx playwright test tests/acceptance --grep "@${tag}"
  else
    npx playwright test tests/acceptance
  fi
  log "acceptance ok"
}

full() {
  rm -rf "$DIST_DIR"
  quick
  acceptance ""
  log "full ok"
}

store() {
  manifest_check
  compgen -G "${DIST_DIR}/*.zip" >/dev/null || compgen -G "build/*.zip" >/dev/null || die "no packaged zip (npm run zip)"
  compgen -G "listing/en*.md" >/dev/null || compgen -G "listing/en*/*.md" >/dev/null || die "English store listing copy missing (listing/en.md, listing/en-US.md or listing/en-US/*.md)"
  compgen -G "site/privacy*" >/dev/null || [ -f site/privacy/index.html ] || die "privacy policy page missing under site/"
  log "store ok"
}

case "$MODE" in
  contract) contract ;;
  quick) quick ;;
  acceptance) acceptance "$ARG" ;;
  full) full ;;
  store) store ;;
  *) die "unknown mode: $MODE" ;;
esac
