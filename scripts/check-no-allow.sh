#!/usr/bin/env bash
# Mechanized constraint: prohibit #[allow(...)] in Rust source files.
#
# Using #[allow] silences compiler/clippy diagnostics without fixing them.
# It teaches the codebase to ignore real problems, and future readers lose
# context about why the warning exists.
#
# Fix the underlying issue instead:
#   clippy::too_many_arguments  →  group related params into a context struct
#   dead_code                   →  remove unused code, or wire it up
#   unused_imports              →  delete the import
#   unused_variables            →  prefix the binding with `_`
#
# Scope: cli/src/**/*.rs (all Rust application source).
#
# Background: docs/quality/mechanized-constraints.md

set -euo pipefail

if [ -n "${1:-}" ] && [ "$1" = "--staged" ]; then
  files=$(git diff --cached --name-only --diff-filter=ACMR)
else
  files=$(git ls-files)
fi

if [ -z "$files" ]; then
  exit 0
fi

candidates=$(printf '%s\n' "$files" | awk '
  $0 ~ /^cli\/src\// && $0 ~ /\.rs$/ { print }
')

if [ -z "$candidates" ]; then
  exit 0
fi

violations=""
while IFS= read -r f; do
  [ -f "$f" ] || continue
  matches=$(grep -n '#\[allow(' "$f" 2>/dev/null || true)
  if [ -n "$matches" ]; then
    while IFS= read -r match; do
      violations="${violations}  ${f}: ${match}"$'\n'
    done <<< "$matches"
  fi
done <<< "$candidates"

if [ -n "$violations" ]; then
  echo "ERROR: #[allow(...)] found in Rust source — fix the root cause instead of silencing the diagnostic." >&2
  echo "" >&2
  echo "  clippy::too_many_arguments  →  wrap related params into a context struct" >&2
  echo "  dead_code                   →  remove unused code, or wire it up" >&2
  echo "  unused_imports              →  delete the import" >&2
  echo "  unused_variables            →  prefix the binding with \`_\`" >&2
  echo "" >&2
  printf '%s' "$violations" >&2
  echo "" >&2
  echo "Doc: docs/quality/mechanized-constraints.md" >&2
  exit 1
fi

exit 0
