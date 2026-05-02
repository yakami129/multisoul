#!/usr/bin/env bash
# Mechanized constraint: single source file must not exceed 500 lines.
#
# Scope: application code under mobile/src, mobile/app, cli/src — extensions
# .ts, .tsx, .rs only.
#
# Excludes: **/__tests__/**, **/*.test.*, **/fixtures/** (same spirit as
# check-no-secrets: tests/fixtures may grow for coverage).
#
# On failure: print paths + line counts and ask contributors / LLM to split
# the file, extract modules, and deduplicate — not to raise the cap casually.
#
# Background: docs/quality/mechanized-constraints.md

set -euo pipefail

limit=500

if [ -n "${1:-}" ] && [ "$1" = "--staged" ]; then
  files=$(git diff --cached --name-only --diff-filter=ACMR)
else
  files=$(git ls-files)
fi

if [ -z "$files" ]; then
  exit 0
fi

candidates=$(printf '%s\n' "$files" | awk '
  ($0 ~ /^mobile\/(src|app)\// || $0 ~ /^cli\/src\//) &&
  $0 ~ /\.(ts|tsx|rs)$/ &&
  !/__tests__\// &&
  !/\.test\./ &&
  !/\/fixtures\// &&
  !/^scripts\/check-max-file-lines\.sh$/ { print }
')

if [ -z "$candidates" ]; then
  exit 0
fi

violations=""
while IFS= read -r f; do
  [ -f "$f" ] || continue
  n=$(wc -l <"$f" | tr -d ' ')
  if [ "$n" -gt "$limit" ]; then
    violations="${violations}${n}	${f}"$'\n'
  fi
done <<<"$candidates"

if [ -n "$violations" ]; then
  echo "ERROR: source file(s) exceed ${limit} lines (split modules / extract helpers; avoid copy-paste)." >&2
  echo "" >&2
  echo "LLM / contributor hint: break into smaller files with clear names, move shared logic to a" >&2
  echo "shared module, and keep each unit under the cap — do not raise the limit without team agreement." >&2
  echo "" >&2
  printf '%s\n' "$violations" | sort -rn >&2
  echo "" >&2
  echo "Doc: docs/quality/mechanized-constraints.md" >&2
  exit 1
fi

exit 0
