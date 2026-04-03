#!/bin/bash
set -euo pipefail

# Run tests and capture results (strip ANSI codes)
TEST_RAW=$(pnpm test 2>&1)
TEST_OUTPUT=$(echo "$TEST_RAW" | sed 's/\x1b\[[0-9;]*m//g')

# Check tests passed
if ! echo "$TEST_OUTPUT" | grep -q 'Tests.*passed'; then
  echo "TESTS FAILED"
  echo "$TEST_OUTPUT" | tail -20
  exit 1
fi

# Extract metrics
TEST_COUNT=$(echo "$TEST_OUTPUT" | grep '      Tests ' | sed 's/[^0-9]*\([0-9][0-9]*\) passed.*/\1/')
TEST_FILE_COUNT=$(find src -name '*.test.ts' | wc -l | tr -d ' ')
SOURCE_MODULES=$(find src -name '*.ts' -not -name '*.test.ts' | wc -l | tr -d ' ')
GOD_OBJECT_LINES=$(wc -l < src/mesh/node-runtime.ts | tr -d ' ')

# Git progress vs origin/main (best-effort)
if git rev-parse --verify origin/main >/dev/null 2>&1; then
  GIT_COMMITS_AHEAD=$(git rev-list --count origin/main..HEAD | tr -d ' ')
else
  GIT_COMMITS_AHEAD=0
fi

echo "METRIC test_count=${TEST_COUNT}"
echo "METRIC test_files=${TEST_FILE_COUNT}"
echo "METRIC source_modules=${SOURCE_MODULES}"
echo "METRIC god_object_lines=${GOD_OBJECT_LINES}"
echo "METRIC git_commits_ahead=${GIT_COMMITS_AHEAD}"
