#!/usr/bin/env bash
# Recommended third-party skills for the factory user's Claude Code (installed globally into ~/.claude/skills).
# Each is a menu the factory's own skills reference — never a default look. Commands verified late Sep 2026.
set -uo pipefail
S="npx -y skills@1.7.0 add"
ok=0; fail=0
run() {
  echo "▶ $*"
  if "$@"; then ok=$((ok + 1)); else fail=$((fail + 1)); echo "  (failed — continue)"; fi
}

# Design & taste
run $S anthropics/skills --skill frontend-design -g -a claude-code -y
run $S https://github.com/Leonxlnx/taste-skill --skill design-taste-frontend -g -a claude-code -y
run $S nextlevelbuilder/ui-ux-pro-max-skill --skill ui-ux-pro-max -g -a claude-code -y

# iOS
run $S https://github.com/avdlee/swiftui-agent-skill --skill swiftui-expert-skill -g -a claude-code -y
run $S https://github.com/openai/plugins/tree/main/plugins/build-ios-apps/skills/swiftui-liquid-glass -g -a claude-code -y

# App Store Connect (asc CLI skills) and store assets
run $S rorkai/app-store-connect-cli-skills --skill '*' -g -a claude-code -y
run $S ParthJadhav/app-store-screenshots -g -a claude-code -y

# Motion / promo video
run $S remotion-dev/skills --skill '*' -g -a claude-code -y

# Optional methodology plugin (brainstorm → plan → TDD with review), useful for humans taking over:
# claude plugin marketplace add obra/superpowers-marketplace && claude plugin install superpowers@superpowers-marketplace

echo "skills installed: $ok ok, $fail failed"
