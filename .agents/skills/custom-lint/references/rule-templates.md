# Custom Lint Rule Templates

Load this reference when creating a new custom lint rule.

## Path / Diff Rule

Use when a rule is about changed paths, new files, renames, or required companion files.

Interview additions:

- Which `git diff --name-status` statuses matter? Usually `A`, `C`, `R`.
- For renames, should the destination path be checked? Usually yes.
- Is the rule PR-only, staged-only, or both?
- Are historical files grandfathered?

Implementation notes:

- Pre-commit input: `git diff --cached --name-status --diff-filter=ACMR`.
- CI PR input: `git diff --name-status --diff-filter=ACMR "$base"...HEAD`.
- For `R` and `C` records, check the final path field.
- Print both the offending status and path.

Canonical-doc-paths example:

```text
Fail:
A  docs/specs/example.md
A  docs/superpowers/specs/example.md
R  docs/product-specs/SPEC-old.md -> docs/specs/SPEC-old.md

Pass:
A  docs/product-specs/2026-06-07-SPEC-example.md
M  docs/superpowers/plans/legacy.md
```

## Regex Scan Rule

Use when a literal or regular-expression pattern is sufficient.

Interview additions:

- Which extensions and directories are candidates?
- Which paths are excluded?
- Should comments, tests, or fixtures be excluded?
- Is the pattern allowed in the check script itself?

Implementation notes:

- Prefer `git ls-files` for full repo mode.
- Prefer staged file names for pre-commit mode.
- Use `grep -EnH` for readable diagnostics.
- Print a specific fix hint.

## Manifest Sync Rule

Use when files on disk must match a JSON/YAML manifest or adapter set.

Interview additions:

- What is the source of truth?
- Is the relation one-way or bidirectional?
- Is sorting required?
- Are symlinks allowed?

Implementation notes:

- Prefer Python for JSON and path semantics.
- Report missing, stale, duplicate, and unsorted entries separately.
- Keep the checker deterministic and network-free.

Agent skill adapter example:

```text
Source: .agents/skills/custom-lint/SKILL.md
Claude: .claude/skills/custom-lint/SKILL.md symlink points to source
Cursor: .cursor/rules/custom-lint.mdc references source
Codex: AGENTS.md and CLAUDE.md reference source
```

## AST / ESLint Rule

Use when grep would be brittle and the target is JavaScript or TypeScript structure.

Interview additions:

- Can an existing ESLint rule express this?
- Is a `no-restricted-imports` pattern enough?
- Which files should the override apply to?
- Should test files have relaxed behavior?

Implementation notes:

- Prefer existing ESLint config patterns before adding custom plugins.
- Keep overrides scoped with `files`.
- Run `cd mobile && pnpm lint` after config changes.
