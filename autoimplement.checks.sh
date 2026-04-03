#!/bin/bash
set -euo pipefail

echo "== Targeted mesh reliability checks =="
pnpm vitest run \
  src/mesh/peer-connection-manager.test.ts \
  src/mesh/node-runtime.test.ts \
  src/mesh/peer-lifecycle.test.ts \
  src/mesh/peer-server.test.ts \
  src/mesh/handshake.test.ts \
  src/mesh/wired-system.test.ts

echo
echo "== Typecheck (new errors only) =="
NEW_ERRORS=$(pnpm typecheck --pretty false 2>&1 | grep 'error TS' | grep -v 'src/mesh/discovery.ts' | grep -v 'src/agents/pi-session.ts' || true)
if [ -n "$NEW_ERRORS" ]; then
  echo "NEW TYPE ERRORS:"
  echo "$NEW_ERRORS"
  exit 1
fi
