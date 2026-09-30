#!/usr/bin/env bash
# Sedef lane verifier — iOS (XcodeGen + xcodebuild + Maestro).
# The foreman and the stop gate run this; it is immutable during build/QA/release.
# Usage: bash .sedef/verify.sh <contract|quick|acceptance [phase-XX]|full|store>
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck disable=SC1091
source .sedef/project.env

MODE="${1:-quick}"
ARG="${2:-}"
APP_PATH=""

log() { printf '▶ %s\n' "$*"; }
die() { printf '✖ %s\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "missing tool: $1 (see docs/SETUP.md)"; }
pretty() { if command -v xcbeautify >/dev/null 2>&1; then xcbeautify --quiet; else tail -n 80; fi; }

gen() {
  need xcodegen
  xcodegen generate --quiet
}

pick_sim() {
  if [ -n "${SIM_UDID:-}" ]; then echo "$SIM_UDID"; return; fi
  need jq
  local udid
  udid="$(xcrun simctl list devices available -j | jq -r '
    [ .devices | to_entries[]
      | select(.key | test("iOS-[0-9]+"))
      | (.key | capture("iOS-(?<maj>[0-9]+)-(?<min>[0-9]+)")) as $v
      | .value[]
      | select((.isAvailable != false) and (.name | startswith("iPhone")))
      | { udid, booted: (.state == "Booted"), ver: (($v.maj | tonumber) * 100 + ($v.min | tonumber)), pro: (.name | test("Pro$")) } ]
    | sort_by([ (if .booted then 1 else 0 end), .ver, (if .pro then 1 else 0 end) ])
    | last | .udid // empty')"
  [ -n "$udid" ] || die "no available iPhone simulator (install an iOS runtime in Xcode → Settings → Components)"
  echo "$udid"
}

build_sim_app() {
  local sim="$1"
  gen
  log "build ${SCHEME} for simulator ${sim}"
  xcodebuild -project "$PROJECT" -scheme "$SCHEME" -configuration Debug -destination "id=${sim}" \
    -derivedDataPath build/DerivedData CODE_SIGNING_ALLOWED=NO build 2>&1 | pretty
  APP_PATH="$(find build/DerivedData/Build/Products -type d -name "${APP_NAME}.app" -path '*-iphonesimulator/*' | head -1)"
  [ -n "$APP_PATH" ] || die "built app not found under build/DerivedData"
}

run_maestro() {
  local sim="$1" tag="${2:-}"
  need maestro
  compgen -G ".maestro/acceptance/*.yaml" >/dev/null || die "no acceptance flows in .maestro/acceptance"
  if [ -n "$tag" ] && ! grep -lq -- "$tag" .maestro/acceptance/*.yaml; then
    log "no contracts tagged ${tag} — nothing to run"
    return 0
  fi
  xcrun simctl boot "$sim" >/dev/null 2>&1 || true
  xcrun simctl bootstatus "$sim" -b >/dev/null 2>&1 || true
  xcrun simctl install "$sim" "$APP_PATH"
  local out="build/maestro-${tag:-all}"
  local args=(test --platform ios --device "$sim" -e "APP_ID=${BUNDLE_ID}" --format junit --output "${out}.xml" --test-output-dir "$out")
  [ -n "$tag" ] && args+=(--include-tags "$tag")
  log "maestro ${tag:-all contracts}"
  maestro "${args[@]}" .maestro/acceptance/
}

contract() {
  need jq
  [ -f .sedef/feature_list.json ] || die "missing .sedef/feature_list.json"
  local bad=0 id f
  while IFS= read -r id; do
    f=".maestro/acceptance/${id}.yaml"
    if [ ! -f "$f" ]; then echo "missing contract: $f"; bad=1; continue; fi
    grep -q '^appId:' "$f" || { echo "$f: missing appId"; bad=1; }
    grep -q '^---' "$f" || { echo "$f: missing '---' separator"; bad=1; }
    grep -Eq 'launchApp|tapOn|assertVisible' "$f" || { echo "$f: no steps"; bad=1; }
    grep -Eq 'phase-[0-9]+' "$f" || { echo "$f: no phase tag"; bad=1; }
  done < <(jq -r '.[].id' .sedef/feature_list.json)
  [ "$bad" = 0 ] || die "acceptance contracts incomplete"
  log "contracts ok"
}

quick() {
  need xcodebuild
  gen
  local sim; sim="$(pick_sim)"
  log "build + unit tests (${UNIT_TEST_TARGET}) on ${sim}"
  xcodebuild -project "$PROJECT" -scheme "$SCHEME" -destination "id=${sim}" -derivedDataPath build/DerivedData \
    -only-testing:"${UNIT_TEST_TARGET}" CODE_SIGNING_ALLOWED=NO test 2>&1 | pretty
  log "quick ok"
}

acceptance() {
  local tag="${1:-}"
  local sim; sim="$(pick_sim)"
  build_sim_app "$sim"
  run_maestro "$sim" "$tag"
  log "acceptance ok"
}

full() {
  need xcodebuild
  rm -rf build/DerivedData
  gen
  local sim; sim="$(pick_sim)"
  log "clean build + all tests on ${sim}"
  xcodebuild -project "$PROJECT" -scheme "$SCHEME" -destination "id=${sim}" -derivedDataPath build/DerivedData \
    CODE_SIGNING_ALLOWED=NO test 2>&1 | pretty
  build_sim_app "$sim"
  run_maestro "$sim" ""
  log "full ok"
}

store() {
  [ -f metadata/app-info/en-US.json ] || die "missing metadata/app-info/en-US.json"
  if command -v asc >/dev/null 2>&1; then asc metadata validate --dir ./metadata; fi
  compgen -G "screenshots/framed/*.png" >/dev/null || compgen -G "screenshots/raw/*.png" >/dev/null || die "no screenshots in screenshots/framed or screenshots/raw"
  [ -f design/brand/icon-1024.png ] || die "missing design/brand/icon-1024.png"
  if command -v sips >/dev/null 2>&1; then
    sips -g hasAlpha design/brand/icon-1024.png | grep -q 'hasAlpha: no' || die "design/brand/icon-1024.png must not have an alpha channel"
  fi
  local set f
  set="$(find . \( -path ./build -o -path ./.git -o -name '*Tests' \) -prune -o -type d -name 'AppIcon.appiconset' -print | head -1)"
  [ -n "$set" ] || die "no AppIcon.appiconset in the project"
  jq -e '[.images[]? | select(.filename != null)] | length > 0' "$set/Contents.json" >/dev/null \
    || die "$set has no icon assigned (the factory copies design/brand/icon-1024.png there when the brand stage passes)"
  while IFS= read -r f; do
    [ -f "$set/$f" ] || die "$set/$f is listed in Contents.json but missing"
  done < <(jq -r '.images[]? | .filename // empty' "$set/Contents.json")
  compgen -G "site/privacy*" >/dev/null || [ -f site/privacy/index.html ] || die "privacy policy page missing under site/"
  log "store assets ok"
}

case "$MODE" in
  contract) contract ;;
  quick) quick ;;
  acceptance) acceptance "$ARG" ;;
  full) full ;;
  store) store ;;
  *) die "unknown mode: $MODE (contract|quick|acceptance [tag]|full|store)" ;;
esac
