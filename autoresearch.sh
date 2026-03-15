#!/bin/bash
set -euo pipefail

# Run tests and capture results (strip ANSI codes)
TEST_RAW=$(pnpm test --run 2>&1)
TEST_OUTPUT=$(echo "$TEST_RAW" | sed 's/\x1b\[[0-9;]*m//g')

# Check tests passed
if ! echo "$TEST_OUTPUT" | grep -q 'Tests.*passed'; then
  echo "TESTS FAILED"
  echo "$TEST_OUTPUT" | tail -10
  exit 1
fi

# Extract test count
TEST_COUNT=$(echo "$TEST_OUTPUT" | grep '      Tests ' | sed 's/[^0-9]*\([0-9][0-9]*\) passed.*/\1/')
TEST_FILES_COUNT=$(echo "$TEST_OUTPUT" | grep ' Test Files ' | sed 's/[^0-9]*\([0-9][0-9]*\) passed.*/\1/')

# Count architecture metrics
GOD_OBJECT_LINES=$(wc -l < src/mesh/node-runtime.ts | tr -d ' ')
SOURCE_MODULES=$(find src -name '*.ts' -not -name '*.test.ts' | wc -l | tr -d ' ')
TEST_FILE_COUNT=$(find src -name '*.test.ts' | wc -l | tr -d ' ')

echo "METRIC test_count=${TEST_COUNT}"
echo "METRIC god_object_lines=${GOD_OBJECT_LINES}"
echo "METRIC source_modules=${SOURCE_MODULES}"
echo "METRIC test_files=${TEST_FILE_COUNT}"
