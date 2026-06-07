---
name: custom-lint
description: Create or update MultiSoul custom lint rules from real mistakes. Use when adding mechanized constraints, repository checks, pre-commit or CI gates, semantic PR-diff lint, regex/path/manifest/ESLint rules, or when turning a CLAUDE.md/AGENTS.md convention into an executable check.
---

# Custom Lint

Use this skill to turn one real mistake into one executable lint rule. Keep every rule independently removable: one rule, one script, one quality-doc entry, one pre-commit hook call, one CI step.

## First Principles

- Do not invent rules. Require a concrete failure, near miss, or repeated review comment.
- Prefer deterministic checks. CI-blocking semantic lint must read reproducible inputs: PR diff and repo files.
- Do not default to LLM calls in CI. Use path, diff, JSON, AST, ESLint, or regex first.
- Grandfather historical violations unless the user explicitly asks to clean them up.
- Never add `#[allow]`, `eslint-disable`, `@ts-ignore`, or similar suppressions to make a check pass.
- For structured choices, use `msctl ask-question` when AskUserQuestion is unavailable.

## Interview

Collect these fields before editing files:

1. **Incident**: What real error caused this rule?
2. **Rule type**: path/diff, regex scan, manifest sync, or AST/ESLint.
3. **Scope**: staged-only, PR diff, full repo, or package-specific.
4. **History policy**: fail existing violations, or only new/changed files?
5. **Rename/copy policy**: should rename/copy targets count as new?
6. **Failure signal**: what exact output should contributors see?
7. **Fix guidance**: what should a human or Agent do next?
8. **Gate level**: local only, CI report, or CI blocking?
9. **Docs**: which quality/design doc and index need updates?
10. **Verification**: what pass and fail fixtures or dry-run examples prove it works?

If the user is unsure, choose the smallest blocking rule that catches the next recurrence without failing unrelated historical files.

## Rule Templates

Read `references/rule-templates.md` before generating a rule. Use these default script shapes:

- `scripts/check-<rule>.sh` for path/diff and shell-friendly regex checks.
- `scripts/check-<rule>.py` for JSON manifests, sorting, path parsing, or richer diagnostics.
- `scripts/check-<rule>.mjs` or ESLint config changes for TypeScript/JavaScript AST rules.

Generated scripts must support the modes they need:

```bash
bash scripts/check-<rule>.sh --staged
bash scripts/check-<rule>.sh --base origin/main
bash scripts/check-<rule>.sh
```

Use `--staged` for pre-commit. Use full repo or `--base` in CI depending on the rule.

## Allowed Auto-Edits

For this skill, automatic integration is limited to standard gate files:

- `scripts/check-*.sh|py|mjs`
- `.husky/pre-commit`
- `.github/workflows/ci.yml`
- `docs/quality/mechanized-constraints.md`
- relevant manifests, such as `docs/design-docs/index.json`
- optional skill adapter files under `.agents/skills`, `.claude/skills`, and `.cursor/rules`

Do not edit unrelated product code unless the lint rule itself requires a fixture or test target and the user has agreed.

## Integration Steps

1. Inspect existing checks in `scripts/`, `.husky/pre-commit`, `.github/workflows/ci.yml`, and `docs/quality/mechanized-constraints.md`.
2. Draft pass/fail examples before writing the script.
3. Create or update exactly one rule script.
4. Add a cheap pre-commit call when staged files can trigger the rule.
5. Add a CI `repo-checks` step when the rule is intended to block merges.
6. Add a concise `docs/quality/mechanized-constraints.md` section with script, cause, detection, and fix.
7. Run the new check in pass mode and, when feasible, against a temporary fail fixture.
8. Run existing impacted validation. At minimum, run `python3 scripts/check-docs-indices.py` when docs manifests change.

## Output Contract

End with:

- Files created or changed.
- The rule's input mode and gate level.
- Verification commands and results.
- Any known pre-existing failures that are unrelated to this rule.

Do not claim a rule is dogfooded unless a pass and fail example were actually exercised.
