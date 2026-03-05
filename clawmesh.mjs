#!/bin/sh
# ClawMesh CLI — resolves tsx from local node_modules and exec's into it.
# Using exec ensures the TUI gets direct TTY control (no parent process).
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec "$SCRIPT_DIR/node_modules/.bin/tsx" "$SCRIPT_DIR/clawmesh.ts" "$@"
