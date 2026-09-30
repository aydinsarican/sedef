#!/usr/bin/env bash
# Sedef lane verifier — web (Astro/Next.js + Playwright + impeccable).
# Immutable during build/QA/release. Usage: bash .sedef/verify.sh <contract|quick|acceptance [phase-XX]|full|store>
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck disable=SC1091
[ -f .sedef/project.env ] && source .sedef/project.env

MODE="${1:-quick}"
ARG="${2:-}"
SLOP_DIR="${SLOP_DIR:-src}"
SITE_DIR="${SITE_DIR:-site}"

log() { printf '▶ %s\n' "$*"; }
die() { printf '✖ %s\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "missing tool: $1"; }

deps() {
  [ -f package.json ] || die "no package.json yet — phase-01 scaffolds the app"
  if [ ! -d node_modules ]; then npm ci --no-audit --no-fund || npm install --no-audit --no-fund; fi
}

contract() {
  need jq
  [ -f .sedef/feature_list.json ] || die "missing .sedef/feature_list.json"
  local bad=0 id f
  while IFS= read -r id; do
    f="tests/acceptance/${id}.spec.ts"
    if [ ! -f "$f" ]; then echo "missing contract: $f"; bad=1; continue; fi
    grep -q "@playwright/test" "$f" || { echo "$f: not a Playwright spec"; bad=1; }
    grep -Eq '@phase-[0-9]+' "$f" || { echo "$f: no @phase-XX tag in a test title"; bad=1; }
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
  log "quick ok"
}

acceptance() {
  local tag="${1:-}"
  deps
  npx playwright install chromium >/dev/null
  compgen -G "tests/acceptance/*.spec.ts" >/dev/null || die "no acceptance specs in tests/acceptance"
  if [ -n "$tag" ]; then
    if ! grep -lq -- "@${tag}" tests/acceptance/*.spec.ts; then log "no contracts tagged ${tag} — nothing to run"; return 0; fi
    npx playwright test tests/acceptance --grep "@${tag}"
  else
    npx playwright test tests/acceptance
  fi
  log "acceptance ok"
}

full() {
  rm -rf dist .next .astro
  quick
  acceptance ""
  if [ -d "$SLOP_DIR" ]; then
    mkdir -p build
    log "impeccable detect ${SLOP_DIR}"
    npx -y impeccable detect --json "$SLOP_DIR" > build/impeccable.json || die "impeccable found anti-patterns — see build/impeccable.json"
  fi
  log "full ok"
}

store() {
  [ -d "$SITE_DIR" ] || [ -d dist ] || die "no ${SITE_DIR}/ or dist/ to deploy"
  compgen -G "${SITE_DIR}/privacy*" >/dev/null || [ -f "${SITE_DIR}/privacy/index.html" ] || compgen -G "src/pages/privacy*" >/dev/null || die "privacy policy page missing"
  [ -f .sedef/store-plan.md ] || die "missing .sedef/store-plan.md"
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
