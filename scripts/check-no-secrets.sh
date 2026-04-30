#!/usr/bin/env bash
# Mechanized constraint: no hardcoded secrets in source.
#
# Trigger: source code (Rust / TS / TSX / JS / TOML / YAML) must not embed:
#   - ms_v2_<32+ alphanumeric>     (MultiSoul Bearer token)
#   - Bearer <32+ alphanumeric>    (raw Authorization header)
#
# Excludes: docs/, **/__tests__/**, **/*.test.*, **/fixtures/**, .git/, node_modules/.
#
# Exit 0 if clean; exit 1 with offending lines if a hit.
#
# Background: see docs/quality/mechanized-constraints.md.

set -euo pipefail

# Files staged for commit (when called from husky), or all tracked files (manual run).
if [ -n "${1:-}" ] && [ "$1" = "--staged" ]; then
  files=$(git diff --cached --name-only --diff-filter=ACMR)
else
  files=$(git ls-files)
fi

if [ -z "$files" ]; then
  exit 0
fi

# Filter to source-like files only and skip excluded paths.
candidates=$(printf '%s\n' "$files" | awk '
  /\.(rs|ts|tsx|js|jsx|mjs|cjs|toml|yml|yaml)$/ &&
  !/^docs\// &&
  !/\.test\./ &&
  !/__tests__\// &&
  !/\/fixtures\// &&
  !/node_modules\// &&
  !/^scripts\/check-no-secrets\.sh$/ &&
  !/^\.github\// {print}
')

if [ -z "$candidates" ]; then
  exit 0
fi

# Patterns:
#   ms_v2_ followed by 16+ alphanumeric (real tokens are 32+; 16 catches obvious leaks)
#   Bearer followed by 32+ alphanumeric (raw headers)
pattern='(ms_v2_[A-Za-z0-9]{16,}|Bearer[[:space:]]+[A-Za-z0-9._-]{32,})'

hits=""
while IFS= read -r f; do
  [ -f "$f" ] || continue
  match=$(grep -EnH "$pattern" "$f" 2>/dev/null || true)
  if [ -n "$match" ]; then
    hits="${hits}${match}"$'\n'
  fi
done <<<"$candidates"

if [ -n "$hits" ]; then
  echo "ERROR: hardcoded secret detected in source." >&2
  echo "" >&2
  printf '%s\n' "$hits" >&2
  echo "" >&2
  echo "Fix: read the token from env / config / user input. Tests should use a" >&2
  echo "fixture in **/fixtures/** or **/__tests__/** (excluded from this check)." >&2
  echo "Doc: docs/quality/mechanized-constraints.md" >&2
  exit 1
fi

exit 0
