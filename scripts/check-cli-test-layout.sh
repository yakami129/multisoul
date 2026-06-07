#!/usr/bin/env bash
# Mechanized constraint: Rust unit test files live under cli/tests/, mirroring cli/src/.
#
# Standalone *_tests.rs files must not remain under cli/src/. They are included
# from production modules via #[path = "..."] or include!() pointing into cli/tests/.
#
# Cargo auto-discovers integration tests only at cli/tests/*.rs (top level). Unit
# test mirrors for modules directly under cli/src/ belong in cli/tests/src/.
#
# Scope: cli/src/**/*.rs, cli/tests/**/*
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

violations=""

# R-CLI-TEST-1: no standalone *_tests.rs under cli/src/
while IFS= read -r f; do
  [ -f "$f" ] || continue
  base=$(basename "$f")
  case "$base" in
    *_tests.rs)
      violations="${violations}  ${f}: standalone unit test file must live under cli/tests/ (mirror cli/src/ layout)"$'\n'
      ;;
  esac
done < <(printf '%s\n' "$files" | awk '$0 ~ /^cli\/src\// && $0 ~ /\.rs$/')

# R-CLI-TEST-2: no new top-level cli/tests/*.rs except known integration tests
allowed_integration_tests="logs_smoke.rs"
while IFS= read -r f; do
  [ -f "$f" ] || continue
  base=$(basename "$f")
  case " ${allowed_integration_tests} " in
    *" ${base} "*) continue ;;
  esac
  violations="${violations}  ${f}: top-level cli/tests/*.rs is reserved for integration tests; unit tests belong in cli/tests/<mirror-of-src>/"$'\n'
done < <(printf '%s\n' "$files" | awk '
  $0 ~ /^cli\/tests\/[^\/]+\.rs$/ { print }
')

if [ -n "$violations" ]; then
  echo "ERROR: CLI test layout violation — unit tests must mirror cli/src/ under cli/tests/." >&2
  echo "" >&2
  echo "  cli/src/serve/foo_tests.rs     → cli/tests/serve/foo_tests.rs" >&2
  echo "  cli/src/db_workflows_tests.rs  → cli/tests/src/db_workflows_tests.rs" >&2
  echo "  (top-level cli/tests/*.rs is only for integration tests like logs_smoke.rs)" >&2
  echo "" >&2
  printf '%s' "$violations" >&2
  echo "" >&2
  echo "Doc: docs/quality/mechanized-constraints.md" >&2
  exit 1
fi

exit 0
