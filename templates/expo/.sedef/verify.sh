#!/usr/bin/env bash
# Sedef lane verifier — Expo (iOS + Android from one codebase; iOS simulator for contracts).
# Immutable during build/QA/release. Usage: bash .sedef/verify.sh <contract|quick|acceptance [phase-XX]|full|store>
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck disable=SC1091
[ -f .sedef/project.env ] && source .sedef/project.env

MODE="${1:-quick}"
ARG="${2:-}"
: "${BUNDLE_ID:?BUNDLE_ID must be set in .sedef/project.env}"
APP_PATH=""

log() { printf '▶ %s\n' "$*"; }
die() { printf '✖ %s\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "missing tool: $1"; }
pretty() { if command -v xcbeautify >/dev/null 2>&1; then xcbeautify --quiet; else tail -n 80; fi; }

deps() {
  [ -f package.json ] || die "no package.json yet — phase-01 scaffolds the Expo app"
  if [ ! -d node_modules ]; then npm ci --no-audit --no-fund || npm install --no-audit --no-fund; fi
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
      | { udid, booted: (.state == "Booted"), ver: (($v.maj | tonumber) * 100 + ($v.min | tonumber)) } ]
    | sort_by([ (if .booted then 1 else 0 end), .ver ]) | last | .udid // empty')"
  [ -n "$udid" ] || die "no available iPhone simulator"
  echo "$udid"
}

build_sim_app() {
  local sim="$1"
  deps
  need pod
  npx expo prebuild --platform ios --no-install >/dev/null
  (cd ios && pod install >/dev/null)
  local ws; ws="$(compgen -G 'ios/*.xcworkspace' | head -1)"
  [ -n "$ws" ] || die "no iOS workspace after prebuild"
  local scheme="${EXPO_SCHEME:-$(basename "$ws" .xcworkspace)}"
  log "build ${scheme} (Release, JS bundled) for ${sim}"
  xcodebuild -workspace "$ws" -scheme "$scheme" -configuration Release -destination "id=${sim}" \
    -derivedDataPath build/DerivedData CODE_SIGNING_ALLOWED=NO build 2>&1 | pretty
  APP_PATH="$(find build/DerivedData/Build/Products -type d -name '*.app' -path '*-iphonesimulator/*' | head -1)"
  [ -n "$APP_PATH" ] || die "built app not found"
}

run_maestro() {
  local sim="$1" tag="${2:-}"
  need maestro
  compgen -G ".maestro/acceptance/*.yaml" >/dev/null || die "no acceptance flows"
  if [ -n "$tag" ] && ! grep -lq -- "$tag" .maestro/acceptance/*.yaml; then log "no contracts tagged ${tag}"; return 0; fi
  xcrun simctl boot "$sim" >/dev/null 2>&1 || true
  xcrun simctl bootstatus "$sim" -b >/dev/null 2>&1 || true
  xcrun simctl install "$sim" "$APP_PATH"
  local out="build/maestro-${tag:-all}"
  local args=(test --platform ios --device "$sim" -e "APP_ID=${BUNDLE_ID}" --format junit --output "${out}.xml" --test-output-dir "$out")
  [ -n "$tag" ] && args+=(--include-tags "$tag")
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
    grep -Eq 'phase-[0-9]+' "$f" || { echo "$f: no phase tag"; bad=1; }
  done < <(jq -r '.[].id' .sedef/feature_list.json)
  [ "$bad" = 0 ] || die "acceptance contracts incomplete"
  log "contracts ok"
}

quick() {
  deps
  npx tsc --noEmit
  npm run --if-present lint
  npm run --if-present test
  log "quick ok"
}

acceptance() {
  local sim; sim="$(pick_sim)"
  build_sim_app "$sim"
  run_maestro "$sim" "${1:-}"
  log "acceptance ok"
}

full() {
  rm -rf build/DerivedData ios
  quick
  acceptance ""
  log "full ok"
}

store() {
  [ -f metadata/app-info/en-US.json ] || die "missing metadata/app-info/en-US.json"
  compgen -G "screenshots/framed/*.png" >/dev/null || compgen -G "screenshots/raw/*.png" >/dev/null || die "no screenshots"
  [ -f design/brand/icon-1024.png ] || die "missing design/brand/icon-1024.png"
  local icon; icon="$(jq -r '.expo.icon // empty' app.json 2>/dev/null)"
  if [ -z "$icon" ] || [ ! -f "$icon" ]; then
    die "app.json expo.icon must point at the brand icon (e.g. ./assets/icon.png copied from design/brand/icon-1024.png)"
  fi
  if command -v sips >/dev/null 2>&1; then
    sips -g hasAlpha "$icon" | grep -q 'hasAlpha: no' || die "$icon must not have an alpha channel (App Store)"
  fi
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
