# CLI 命令分组（`msctl spec`）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development if available; otherwise use superpowers:executing-plans or the local equivalent. This repository overrides the default per-task commit habit: implement all tasks, pass verification, run required code review, then create **one final commit** and record its SHA in `docs/exec-plans/index.json`.

**Design Reference:** [`docs/design-docs/2026-06-07-cli-command-grouping-design.md`](../design-docs/2026-06-07-cli-command-grouping-design.md)

**Goal:** Group spec CLI commands under `msctl spec`, hard-remove legacy top-level `save-spec` / `mark-spec-done`, and add R14 lint to prevent new flat top-level command variants.

**Architecture:** Add `commands/spec.rs` as clap aggregator (mirroring `auth.rs`); keep `save_spec.rs` and `mark_spec_done.rs` as handler modules. Register `Commands::Spec { subcommand }` in `main.rs`. Add `scripts/check-cli-command-layout.sh` scanning `main.rs` with infrastructure whitelist.

**Tech Stack:** Rust + clap 4; bash pre-commit scripts; existing Cargo tests.

---

## Baseline Evidence

- Current top-level variants in [`cli/src/main.rs`](../../cli/src/main.rs): `SaveSpec`, `MarkSpecDone` (flat — violation of target convention).
- Grouped precedents: [`cli/src/commands/auth.rs`](../../cli/src/commands/auth.rs), [`cli/src/commands/agent.rs`](../../cli/src/commands/agent.rs), [`cli/src/commands/daemon.rs`](../../cli/src/commands/daemon.rs).
- Agent string reference: [`cli/src/serve/spec/routes/ideas.rs`](../../cli/src/serve/spec/routes/ideas.rs) mentions `msctl save-spec`.
- No mobile or REST API changes required.

## Implementation Boundaries

- **Hard cut:** no clap aliases for `save-spec` / `mark-spec-done`.
- Do not regroup `ask-question`, `serve`, or `logs` in this PR.
- Do not add new spec subcommands beyond migrating existing two.
- R14 v1 scans **only** `cli/src/main.rs`; do not lint `commands/` file naming.
- After changing `cli/src/main.rs`, run `python3 scripts/check-doc-code-hashes.py --update-doc 2026-06-07-cli-command-grouping-design.md`.

---

## Task 1: `msctl spec` Aggregator and `main.rs` Cutover

**Files:**
- Create: `cli/src/commands/spec.rs`
- Modify: `cli/src/commands/mod.rs`
- Modify: `cli/src/main.rs`

- [ ] Add `SpecCommands` enum with `Save` and `MarkDone` variants; map clap names to `save` and `mark-done`.
- [ ] Implement `spec::handle()` dispatching to existing `save_spec::handle` / `mark_spec_done::handle`.
- [ ] Replace `Commands::SaveSpec` and `Commands::MarkSpecDone` with:

  ```rust
  /// Spec artifact commands
  Spec {
      #[command(subcommand)]
      subcommand: commands::spec::SpecCommands,
  },
  ```

- [ ] Update `main()` match arm accordingly.
- [ ] Verify `cargo run -- spec --help` lists both subcommands.

**Verification:**
- Run: `cd cli && cargo build && cargo run -- spec --help`
- Expected: help text shows `save` and `mark-done`; no `save-spec` at top level.

---

## Task 2: Documentation and String Reference Updates

**Files:**
- Modify: `docs/references/cli-commands.md`
- Modify: `cli/AGENTS.md` (msctl inject block if present)
- Modify: `cli/src/serve/spec/routes/ideas.rs`
- Modify: grep hits in active docs (command **examples** only)

- [ ] Replace top-level `save-spec` / `mark-spec-done` rows with `spec` group in cli-commands reference.
- [ ] Add `## msctl spec` section documenting `save` and `mark-done` flags (mirror existing save-spec / mark-spec-done docs).
- [ ] Update Agent instruction string in `ideas.rs` to `msctl spec save --path ...`.
- [ ] Update command examples in recent exec-plans / product-specs where agents copy-paste CLI (leave historical narrative mentioning old names if needed, but fix all executable examples).

**Verification:**
- Run: `rg 'msctl save-spec|msctl mark-spec-done' --glob '!docs/product-specs/**' --glob '!docs/exec-plans/2026-06-0[1-6]*'`
- Expected: no hits in `cli/` or `docs/references/`; historical archived plans may retain old names in prose.

---

## Task 3: R14 Lint Script and Harness Wiring

**Files:**
- Create: `scripts/check-cli-command-layout.sh`
- Modify: `.husky/pre-commit`
- Modify: `.github/workflows/ci.yml`
- Modify: `docs/quality/mechanized-constraints.md`

- [ ] Implement bash script:
  - Extract `enum Commands` body from `cli/src/main.rs`
  - For each variant line/block: pass if contains `subcommand:` OR variant name ∈ `{Serve, AskQuestion, Logs}`
  - Fail with actionable message on flat variants like `SaveSpec(` or `MarkSpecDone(`
- [ ] Support `--staged` mode (consistent with sibling scripts); exit 0 when no `cli/src/main.rs` in scope for staged-only if cheap to always scan full file anyway.
- [ ] Add pre-commit hook invocation after `check-cli-test-layout.sh`.
- [ ] Add CI step in `repo-checks` job.
- [ ] Document as **R14** in mechanized-constraints.md (起因、检测、白名单、修复方式).
- [ ] Optional: add `cli/tests/scripts/check_cli_command_layout_tests.sh` or inline test fixture — at minimum manually verify fail case once.

**Verification:**
- Run: `bash scripts/check-cli-command-layout.sh` → exit 0 on clean tree.
- Temporarily add `FooBar(commands::foo::FooArgs),` to `Commands` → script exit 1 with clear message → revert.

---

## Task 4: Regression Tests

**Files:**
- Create or extend tests as needed under `cli/tests/`

- [ ] If clap parsing is testable without HTTP: assert `msctl spec --help` output contains `save` and `mark-done` (integration test or `cli/tests/commands/spec_tests.rs`).
- [ ] Existing `save_spec` / `mark_spec_done` unit behavior unchanged — `cargo test` green.

**Verification:**
- Run: `cd cli && cargo test`
- Expected: all tests pass.

---

## Task 5: Design Doc Hash Refresh and Index

**Files:**
- Modify: `docs/design-docs/index.json` (trackedFiles sha256 for `cli/src/main.rs` after Task 1)

- [ ] After Task 1 merges structurally, run:

  ```bash
  python3 scripts/check-doc-code-hashes.py --update-doc 2026-06-07-cli-command-grouping-design.md
  ```

- [ ] Confirm `python3 scripts/check-doc-code-hashes.py --check` passes.

**Verification:**
- Run: `python3 scripts/check-docs-indices.py && python3 scripts/check-doc-code-hashes.py --check`

---

## Final Verification Checklist

- [ ] `cd cli && cargo test && cargo build`
- [ ] `bash scripts/check-cli-command-layout.sh`
- [ ] `msctl spec save` / `msctl spec mark-done` work against running serve (manual smoke)
- [ ] `msctl save-spec` fails with unknown command
- [ ] Design doc §7 acceptance criteria all checked
- [ ] Single commit; update `docs/exec-plans/index.json` → `lastCompletedCommit` for this plan file

---

## Risk Notes

- **Agent scripts / user shell history:** hard cut may break copy-paste from old docs; mitigated by updating reference docs and ideas.rs string in same PR.
- **npm global msctl:** users must reinstall/update binary; out of repo scope but note in PR body.
