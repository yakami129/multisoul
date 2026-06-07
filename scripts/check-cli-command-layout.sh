#!/usr/bin/env bash
# Mechanized constraint: top-level msctl Commands must use Subcommand grouping
# or appear on the infrastructure whitelist (Serve, AskQuestion, Logs).
#
# Scope: cli/src/main.rs enum Commands { ... }
#
# Background: docs/quality/mechanized-constraints.md (R14)
# Design: docs/design-docs/2026-06-07-cli-command-grouping-design.md

set -euo pipefail

MAIN_RS="cli/src/main.rs"
DESIGN_DOC="docs/design-docs/2026-06-07-cli-command-grouping-design.md"
# R14-3: infrastructure top-level commands (not domain-grouped).
INFRA_WHITELIST="Serve AskQuestion Logs"

if [ -n "${1:-}" ] && [ "$1" != "--staged" ]; then
  echo "Usage: $0 [--staged]" >&2
  exit 2
fi

# --staged accepted for pre-commit parity; always scans main.rs (cheap).
if [ ! -f "$MAIN_RS" ]; then
  echo "ERROR: missing ${MAIN_RS}" >&2
  exit 1
fi

violations=$(
  awk -v whitelist="${INFRA_WHITELIST}" '
    BEGIN {
      split(whitelist, wl, " ")
      for (i in wl) infra[wl[i]] = 1
      n = 0
    }

    /^enum Commands \{/ {
      in_enum = 1
      depth = 1
      collect = 0
      next
    }

    !in_enum { next }

    {
      if (collect) {
        body = body $0 "\n"
        tmp = $0
        vdepth += gsub(/\{/, "{", tmp) - gsub(/\}/, "}", tmp)
        if (vdepth <= 0) {
          collect = 0
          if (body !~ /subcommand:/) {
            violations[++n] = cur_variant
          }
        }
        tmp = $0
        depth += gsub(/\{/, "{", tmp) - gsub(/\}/, "}", tmp)
        if (depth <= 0) in_enum = 0
        next
      }

      if (depth == 1) {
        if (match($0, /^[[:space:]]+[A-Z][A-Za-z0-9]*[[:space:]]*\(/)) {
          v = $0
          sub(/^[[:space:]]+/, "", v)
          sub(/[[:space:]]*\(.*/, "", v)
          if (!(v in infra)) {
            violations[++n] = v
          }
        } else if (match($0, /^[[:space:]]+[A-Z][A-Za-z0-9]*[[:space:]]*\{/)) {
          cur_variant = $0
          sub(/^[[:space:]]+/, "", cur_variant)
          sub(/[[:space:]]*\{.*/, "", cur_variant)
          body = $0 "\n"
          tmp = $0
          vdepth = gsub(/\{/, "{", tmp) - gsub(/\}/, "}", tmp)
          if (vdepth <= 0) {
            if (body !~ /subcommand:/) {
              violations[++n] = cur_variant
            }
          } else {
            collect = 1
          }
        }
      }

      tmp = $0
      depth += gsub(/\{/, "{", tmp) - gsub(/\}/, "}", tmp)
      if (depth <= 0) in_enum = 0
    }

    END {
      for (i = 1; i <= n; i++) {
        print violations[i]
      }
    }
  ' "${MAIN_RS}"
)

if [ -n "${violations}" ]; then
  echo "ERROR: CLI command layout violation — new top-level Commands variant must use Subcommand grouping or be infrastructure-whitelisted." >&2
  echo "" >&2
  while IFS= read -r variant; do
    [ -n "${variant}" ] || continue
    echo "  ${variant}(...): use a grouped Commands variant with subcommand: or add to infrastructure whitelist" >&2
  done <<< "${violations}"
  echo "" >&2
  echo "Whitelist: ${INFRA_WHITELIST}" >&2
  echo "Doc: ${DESIGN_DOC}" >&2
  exit 1
fi

exit 0
