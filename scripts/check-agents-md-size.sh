#!/usr/bin/env bash
# Mechanized constraint: AGENTS.md must remain a map, not an encyclopedia.
#
# Trigger: AGENTS.md is the agent navigation entry point. The Harness
# Engineering pattern requires a stable, ~100-line table of contents pointing
# to the structured docs/ directory. Letting it grow turns it back into a
# monolithic instruction manual that crowds out task context.
#
# Hard limit: 150 lines (50% headroom over the 100-line target).
# When you hit the cap, refactor: push detail into docs/{quality,references,..}
# and keep AGENTS.md as pure pointers.
#
# Background: see docs/quality/mechanized-constraints.md.

set -euo pipefail

target=AGENTS.md
limit=150

if [ ! -f "$target" ]; then
  echo "ERROR: $target not found at repo root." >&2
  exit 1
fi

current=$(wc -l <"$target" | tr -d ' ')

if [ "$current" -gt "$limit" ]; then
  echo "ERROR: $target is $current lines (limit: $limit)." >&2
  echo "" >&2
  echo "AGENTS.md must stay a navigation map, not an encyclopedia." >&2
  echo "Refactor: push detailed content into the docs/ subtree and" >&2
  echo "keep this file to short pointers only." >&2
  echo "Doc: docs/quality/mechanized-constraints.md" >&2
  exit 1
fi

exit 0
