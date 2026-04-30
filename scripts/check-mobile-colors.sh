#!/usr/bin/env bash
# Mechanized constraint: mobile/ may only use the green-phosphor palette.
#
# Trigger: any hex color in mobile/{src,app}/**/*.{ts,tsx} must appear in the
# allowlist below. Comments (single-line // ...) are stripped before scanning
# to allow historical TODOs to coexist.
#
# Allowlist sourced from mobile/docs/design.md plus extended greens used in
# existing components (verified visually). Update both the docs and this list
# together when introducing a new tone.
#
# Exit 0 if clean; exit 1 with offending lines if a hit.
#
# Background: see docs/quality/mechanized-constraints.md.

set -euo pipefail

# Allowed hex colors (case-insensitive). Source: mobile/docs/design.md §2.
# Update both the design doc AND this list together (same commit).
allowlist=$(cat <<'EOF' | tr '\n' '|' | sed 's/|$//'
040D04
061206
0A1A0A
0F2B0F
20C20E
33FF33
2D8B2D
147A16
0F6B0F
5FA65F
D7FFD2
20C20E88
20C20E99
0F4D0F
AFFFAF
33FF33AA
33FF33CC
33FF3399
FFB000
FF3333
FF4444
1A0000
3D0000
5C0000
8B0000
EOF
)

# Files staged for commit (when --staged), or all tracked source files.
if [ -n "${1:-}" ] && [ "$1" = "--staged" ]; then
  files=$(git diff --cached --name-only --diff-filter=ACMR)
else
  files=$(git ls-files)
fi

if [ -z "$files" ]; then
  exit 0
fi

candidates=$(printf '%s\n' "$files" | awk '
  /^mobile\/(src|app)\/.*\.(ts|tsx)$/ {print}
')

if [ -z "$candidates" ]; then
  exit 0
fi

violations=""
while IFS= read -r f; do
  [ -f "$f" ] || continue
  # Strip single-line // comments, then look for any hex color not in allowlist.
  line=$(
    sed -E 's,//.*,,' "$f" \
      | grep -nE '#[0-9A-Fa-f]{3,8}\b' \
      | grep -viE "#($allowlist)\\b" \
      || true
  )
  if [ -n "$line" ]; then
    while IFS= read -r v; do
      violations="${violations}${f}:${v}"$'\n'
    done <<<"$line"
  fi
done <<<"$candidates"

if [ -n "$violations" ]; then
  echo "ERROR: non-allowlisted hex color in mobile/ source." >&2
  echo "" >&2
  printf '%s' "$violations" >&2
  echo "" >&2
  echo "Allowed greens:" >&2
  echo "  $(echo $allowlist | tr '|' ' ')" >&2
  echo "" >&2
  echo "Fix options:" >&2
  echo "  1. Use an allowlisted color from mobile/docs/design.md" >&2
  echo "  2. If a new tone is needed: extend design.md AND this script's allowlist" >&2
  echo "     in the same commit, with visual justification" >&2
  echo "Doc: docs/quality/mechanized-constraints.md" >&2
  exit 1
fi

exit 0
