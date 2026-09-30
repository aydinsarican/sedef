#!/usr/bin/env bash
# Sedef lane verifier — generic, command-driven (Mac direct, Apify actor, Figma plugin, digital assets …).
# The spec stage defines the commands in .sedef/project.env; both files are immutable during build/QA/release.
# Usage: bash .sedef/verify.sh <contract|quick|acceptance [phase-XX]|full|store>
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck disable=SC1091
[ -f .sedef/project.env ] && source .sedef/project.env

MODE="${1:-quick}"
TAG="${2:-}"
export TAG

die() { printf '✖ %s\n' "$*" >&2; exit 1; }

run_cmd() {
  local var="$1"
  local cmd="${!var:-}"
  [ -n "$cmd" ] || die "${var} is not set in .sedef/project.env — the spec stage must define it"
  printf '▶ %s: %s\n' "$var" "$cmd"
  bash -c "$cmd"
}

case "$MODE" in
  contract) run_cmd CONTRACT_CMD ;;
  quick) run_cmd QUICK_CMD ;;
  acceptance) run_cmd ACCEPTANCE_CMD ;;
  full) run_cmd FULL_CMD ;;
  store) run_cmd STORE_CMD ;;
  *) die "unknown mode: $MODE" ;;
esac
