#!/usr/bin/env python3
"""
Validate project skill adapter files for shared Agent skills.

Currently checks the custom-lint skill source and its Claude/Cursor/Codex entry points.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SOURCE = REPO_ROOT / ".agents" / "skills" / "custom-lint" / "SKILL.md"
CLAUDE_LINK = REPO_ROOT / ".claude" / "skills" / "custom-lint" / "SKILL.md"
CURSOR_RULE = REPO_ROOT / ".cursor" / "rules" / "custom-lint.mdc"
AGENTS_MD = REPO_ROOT / "AGENTS.md"
CLAUDE_MD = REPO_ROOT / "CLAUDE.md"
SOURCE_REL = ".agents/skills/custom-lint/SKILL.md"


def _rel(path: Path) -> str:
    return str(path.relative_to(REPO_ROOT))


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def main() -> int:
    errors: list[str] = []

    if not SOURCE.is_file():
        errors.append(f"missing source skill: {SOURCE_REL}")

    if not CLAUDE_LINK.exists() and not CLAUDE_LINK.is_symlink():
        errors.append(f"missing Claude skill adapter: {_rel(CLAUDE_LINK)}")
    elif not CLAUDE_LINK.is_symlink():
        errors.append(f"Claude skill adapter must be a symlink: {_rel(CLAUDE_LINK)}")
    else:
        link_target = os.readlink(CLAUDE_LINK)
        resolved = CLAUDE_LINK.parent.joinpath(link_target).resolve()
        expected = SOURCE.resolve()
        if resolved != expected:
            errors.append(
                "Claude skill symlink points to "
                f"{link_target}, expected {SOURCE_REL}"
            )

    if not CURSOR_RULE.is_file():
        errors.append(f"missing Cursor rule adapter: {_rel(CURSOR_RULE)}")
    else:
        cursor_content = _read(CURSOR_RULE)
        if SOURCE_REL not in cursor_content:
            errors.append(f"Cursor rule must reference {SOURCE_REL}")
        if "alwaysApply: false" not in cursor_content:
            errors.append("Cursor rule should be opt-in with alwaysApply: false")

    for doc_path in (AGENTS_MD, CLAUDE_MD):
        if not doc_path.is_file():
            errors.append(f"missing project instruction file: {_rel(doc_path)}")
            continue
        if SOURCE_REL not in _read(doc_path):
            errors.append(f"{_rel(doc_path)} must reference {SOURCE_REL}")

    if errors:
        for error in errors:
            print(f"[agent-skill-adapters] {error}", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
