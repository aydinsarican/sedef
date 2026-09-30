#!/usr/bin/env bash
# Sedef installer — run on the factory Mac.
#
#   ./install.sh --deps          (from an ADMIN account) Homebrew tools + Claude Code CLI, for every user
#   ./install.sh                 (as the factory user) build, link, create ~/.sedef, validate, write the launchd agent
#   ./install.sh --set-api-key   also store the Anthropic API key in the login keychain (prompted)
#   ./install.sh --with-skills   also install the recommended third-party skills (scripts/install-skills.sh)
#   ./install.sh --start         also load the launchd agent (the foreman starts and restarts on its own)
#
# On a single admin account, plain ./install.sh does both parts. Safe to re-run.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
SET_KEY=0; WITH_SKILLS=0; START=0; DEPS_ONLY=0
for a in "$@"; do
  case "$a" in
    --deps) DEPS_ONLY=1 ;;
    --set-api-key) SET_KEY=1 ;;
    --with-skills) WITH_SKILLS=1 ;;
    --start) START=1 ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    *) echo "unknown option: $a" >&2; exit 2 ;;
  esac
done

say() { printf '\n\033[1m▶ %s\033[0m\n' "$*"; }
warn() { printf '\033[33m⚠ %s\033[0m\n' "$*"; }
die() { printf '\033[31m✖ %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || die "The factory host must be macOS (Xcode builds). A Mac mini is the usual choice."
IS_ADMIN=0
if id -Gn | tr ' ' '\n' | grep -qx admin; then IS_ADMIN=1; fi

say "Homebrew"
if ! command -v brew >/dev/null 2>&1; then
  # A fresh standard user often has Homebrew installed (by the admin) but not on PATH yet.
  for b in /opt/homebrew/bin/brew /usr/local/bin/brew; do
    if [ -x "$b" ]; then eval "$("$b" shellenv)"; break; fi
  done
fi
command -v brew >/dev/null 2>&1 || die "Homebrew is required. From an admin account install it (https://brew.sh), then run ./install.sh --deps there."
BREW_PREFIX="$(brew --prefix)"
CAN_BREW=0
if [ -w "$BREW_PREFIX/bin" ] && [ -w "$BREW_PREFIX/Cellar" ]; then CAN_BREW=1; fi

if [ "$CAN_BREW" = 1 ]; then
  say "Command-line tools (Homebrew)"
  brew update --quiet || true
  brew install --quiet node jq gh git xcodegen asc uv librsvg imagemagick xcbeautify openjdk@17 cocoapods
  brew tap mobile-dev-inc/tap >/dev/null 2>&1 || true
  brew install --quiet mobile-dev-inc/tap/maestro || warn "Maestro install failed — see docs/SETUP.md"
  brew install --quiet cameroncooke/axe/axe || warn "AXe (screenshot capture for asc) install failed — optional"
  if ! command -v claude >/dev/null 2>&1; then
    say "Claude Code CLI (plugin validation, MCP logins, human takeovers)"
    npm install -g @anthropic-ai/claude-code
  fi
elif [ "$DEPS_ONLY" = 1 ]; then
  die "This account can't write to $BREW_PREFIX. Run ./install.sh --deps from the admin account that installed Homebrew."
else
  say "Command-line tools (installed by an admin — checking)"
fi
if [ "$DEPS_ONLY" = 1 ]; then
  echo "Shared tools are installed. Now log in as the factory user and run ./install.sh there."
  exit 0
fi

MISSING=()
for c in node npm jq gh git xcodegen asc uv rsvg-convert magick xcbeautify pod; do
  command -v "$c" >/dev/null 2>&1 || MISSING+=("$c")
done
[ -x "$BREW_PREFIX/opt/openjdk@17/bin/java" ] || MISSING+=("openjdk@17")
if [ "${#MISSING[@]}" -gt 0 ]; then
  die "Missing tools: ${MISSING[*]}. Run ./install.sh --deps from an admin account, then re-run this."
fi
command -v maestro >/dev/null 2>&1 || warn "Maestro not found — iOS/Expo acceptance contracts need it (admin: ./install.sh --deps)"
command -v axe >/dev/null 2>&1 || warn "AXe not found — optional (asc screenshot capture)"
# Koubou frames screenshots for `asc screenshots frame`; user-level install, optional.
if ! command -v kou >/dev/null 2>&1; then
  if uv tool install --quiet 'koubou==0.20.0' 2>/dev/null || uv tool install --quiet koubou 2>/dev/null; then
    kou setup-frames >/dev/null 2>&1 || true
  else
    warn "Koubou (screenshot frames) install failed — optional; raw screenshots still pass the store check"
  fi
fi
if ! [ -d "/Applications/Google Chrome.app" ]; then
  warn "Google Chrome not found — the Playwright MCP launches installed Chrome (admin: brew install --cask google-chrome)"
fi
[ "$IS_ADMIN" = 1 ] && warn "This user is an administrator. Recommended: a dedicated standard user for the factory (docs/SETUP.md §1)."
mkdir -p "$HOME/.local/bin"
case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) export PATH="$HOME/.local/bin:$PATH" ;; esac

say "Xcode"
if xcodebuild -version >/dev/null 2>&1; then
  xcodebuild -version | head -1
  xcodebuild -license check >/dev/null 2>&1 || warn "Accept the Xcode license once: sudo xcodebuild -license accept"
else
  warn "Xcode not found. Install it from the App Store, open it once, then: sudo xcode-select -s /Applications/Xcode.app"
fi

say "Claude Code CLI (plugin validation, MCP logins, human takeovers)"
if ! command -v claude >/dev/null 2>&1; then
  # Standard users can't write to Homebrew's global npm prefix: install into ~/.local instead.
  npm install -g --prefix "$HOME/.local" @anthropic-ai/claude-code
fi
claude --version || true

say "Runner"
( cd "$ROOT/runner" && npm ci --no-audit --no-fund && npm run build )
chmod +x "$ROOT/bin/sedef" "$ROOT/plugin/hooks/guard.sh" "$ROOT"/templates/*/.sedef/verify.sh "$ROOT"/plugin/skills/*/scripts/*.mjs
if [ -w "$BREW_PREFIX/bin" ]; then LINK_DIR="$BREW_PREFIX/bin"; else LINK_DIR="$HOME/.local/bin"; fi
ln -sf "$ROOT/bin/sedef" "$LINK_DIR/sedef"
echo "sedef → $LINK_DIR/sedef"
[ "$LINK_DIR" = "$HOME/.local/bin" ] && warn "Add ~/.local/bin to this user's PATH for interactive shells (e.g. in ~/.zprofile)."

say "Factory folders and secrets"
mkdir -p "$HOME/.sedef/secrets" && chmod 700 "$HOME/.sedef" "$HOME/.sedef/secrets"
if [ ! -f "$HOME/.sedef/.env" ]; then
  cp "$ROOT/.env.example" "$HOME/.sedef/.env"
  echo "created ~/.sedef/.env — fill it in (docs/SETUP.md §4)"
fi
chmod 600 "$HOME/.sedef/.env"
grep -q '^SEDEF_HOME=' "$HOME/.sedef/.env" || echo "SEDEF_HOME=$ROOT" >> "$HOME/.sedef/.env"
mkdir -p "$ROOT/factory/"{ideas/cards,ledger,learnings,reports,portfolio,proposals,logs/sessions,inbox}
mkdir -p "$HOME/sedef-products"

if [ "$SET_KEY" = 1 ]; then
  say "Anthropic API key → login keychain (service sedef-anthropic-api-key)"
  echo "Use a key from a dedicated Console workspace with a monthly spend limit. Paste it when prompted (twice)."
  security add-generic-password -a sedef -s sedef-anthropic-api-key -U -w
fi

if [ "$WITH_SKILLS" = 1 ]; then
  say "Third-party skills"
  bash "$ROOT/scripts/install-skills.sh"
fi

say "Validation"
claude plugin validate "$ROOT/plugin" || warn "plugin validation reported problems"
"$ROOT/bin/sedef" validate-config

say "launchd agent"
PLIST="$HOME/Library/LaunchAgents/com.sedef.foreman.plist"
mkdir -p "$HOME/Library/LaunchAgents"
NODE_BIN="$(command -v node)"
SERVICE_PATH="$BREW_PREFIX/bin:$BREW_PREFIX/sbin:$HOME/.local/bin:$HOME/.maestro/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
sed -e "s#__NODE__#$NODE_BIN#g" -e "s#__ROOT__#$ROOT#g" -e "s#__PATH__#$SERVICE_PATH#g" -e "s#__HOME__#$HOME#g" \
  -e "s#__JAVA_HOME__#$BREW_PREFIX/opt/openjdk@17#g" \
  "$ROOT/scripts/com.sedef.foreman.plist.tmpl" > "$PLIST"
plutil -lint "$PLIST"
if [ "$START" = 1 ]; then
  launchctl bootout "gui/$(id -u)/com.sedef.foreman" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$PLIST"
  echo "foreman started — logs: $ROOT/factory/logs/"
else
  echo "written $PLIST (not started). Start with: ./install.sh --start"
fi

say "Next steps (docs/SETUP.md)"
cat <<EOF
  1. Fill ~/.sedef/.env (Telegram bot, support e-mail in config, optional MCP keys).
  2. asc auth login --name factory --key-id <ID> --issuer-id <ISSUER> --private-key ~/.asc/AuthKey_<ID>.p8 --network
  3. gh auth login            (if factory.github_owner is set)
  4. Xcode → Settings → Accounts: sign in with the factory team's Apple ID (automatic signing).
  5. Optional OAuth MCP servers — add, then log in once each (a browser opens):
$(jq -r '.mcpServers | to_entries[] | select(.value.auth=="oauth") | "       claude mcp add --scope user --transport http \(.key) \(.value.url) && claude mcp login \(.key)"' "$ROOT/config/mcp.json")
  6. sedef doctor
  7. ./install.sh --start
EOF
