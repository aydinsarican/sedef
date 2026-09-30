#!/bin/bash
# Forwards Claude Code hook input to the sedef policy engine.
# Factory (SDK) sessions enforce policy in-process, so this exits immediately there.
[ "${SEDEF_SDK_SESSION:-}" = "1" ] && exit 0
SEDEF_HOME="${SEDEF_HOME:-$HOME/sedef}"
if [ -x "$SEDEF_HOME/bin/sedef" ]; then
  exec "$SEDEF_HOME/bin/sedef" hook "$@"
fi
exit 0
