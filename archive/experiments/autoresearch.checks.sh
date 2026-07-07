#!/bin/bash
set -euo pipefail

# All existing tests must pass
pnpm test --run --reporter=dot 2>&1 | tail -20

# Typecheck — only show NEW errors (not the known 3 in discovery.ts)
NEW_ERRORS=$(npx tsc --noEmit --pretty false 2>&1 | grep 'error TS' | grep -v 'src/mesh/discovery.ts' || true)
if [ -n "$NEW_ERRORS" ]; then
  echo "NEW TYPE ERRORS:"
  echo "$NEW_ERRORS"
  exit 1
fi
