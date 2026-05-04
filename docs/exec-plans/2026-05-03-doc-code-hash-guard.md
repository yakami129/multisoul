# Doc-Code Hash Guard Implementation Plan

**Goal:** Add a CI-enforced doc-code freshness guard for the pilot design guide `docs/design-docs/2026-05-03-new-cli-runtime-integration-guide.md`.

**Design:** [`docs/design-docs/2026-05-03-doc-code-hash-guard-design.md`](../design-docs/2026-05-03-doc-code-hash-guard-design.md)

**Scope:** Extend `docs/design-docs/index.json` with `trackedFiles`, add a check/update script, wire the check into CI, and seed hashes for the pilot guide.

---

## Task 1: Extend design-docs index schema

**Files:**
- Modify: `docs/design-docs/index.schema.json`

**Steps:**
- [ ] Add optional `trackedFiles` to `documents[]`.
- [ ] Require each tracked file entry to include `path`, `sha256`, and `reason`.
- [ ] Validate `sha256` as a lowercase 64-character hex string.
- [ ] Keep existing `file` / `title` constraints unchanged.

**Verification:**
- [ ] `python3 scripts/check-docs-indices.py` still passes before tracked files are seeded.

---

## Task 2: Add check/update script

**Files:**
- Create: `scripts/check-doc-code-hashes.py`

**Steps:**
- [ ] Implement `--check`.
- [ ] Implement `--update-doc <DESIGN_DOC>`（仅 basename，如 `2026-05-03-new-cli-runtime-integration-guide.md`；禁止全仓批量 `--update`）。
- [ ] Read `docs/design-docs/index.json`.
- [ ] For every document with `trackedFiles`, compute sha256 for each repo-relative `path`.
- [ ] In `--check`, fail when a tracked file hash differs and the corresponding design doc is not changed in the current git diff.
- [ ] In `--check`, fail when a tracked file hash differs from the current file even after the design doc changed, because `index.json` still needs refresh.
- [ ] In `--update-doc`, rewrite **仅该文档**的 `trackedFiles` sha256 于 `docs/design-docs/index.json`。

**Verification:**
- [ ] Running `python3 scripts/check-doc-code-hashes.py --check` on a clean tree exits 0 after hashes are seeded.
- [ ] Running `python3 scripts/check-doc-code-hashes.py --update-doc 2026-05-03-new-cli-runtime-integration-guide.md` is idempotent on a clean tree.

---

## Task 3: Seed pilot tracked files

**Files:**
- Modify: `docs/design-docs/index.json`

**Pilot document:**
- `docs/design-docs/2026-05-03-new-cli-runtime-integration-guide.md`

**Tracked files:**
- `cli/src/serve/runtime/mod.rs`
- `cli/src/serve/state.rs`
- `cli/src/serve/routes/messages.rs`
- `cli/src/serve/runtime/claude.rs`
- `cli/src/serve/runtime/codex.rs`
- `cli/src/serve/runtime/cursor.rs`
- `cli/src/db.rs`
- `mobile/src/types.ts`

**Steps:**
- [ ] Add `trackedFiles` entries with meaningful `reason` values.
- [ ] Run `python3 scripts/check-doc-code-hashes.py --update-doc 2026-05-03-new-cli-runtime-integration-guide.md`.

**Verification:**
- [ ] `python3 scripts/check-doc-code-hashes.py --check` passes.
- [ ] `python3 scripts/check-docs-indices.py` passes.

---

## Task 4: Wire CI and documentation

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `docs/quality/mechanized-constraints.md`
- Optional modify: `docs/quality/SPEC-harness-roadmap.md`

**Steps:**
- [ ] Add `python3 scripts/check-doc-code-hashes.py --check` to `repo-checks`.
- [ ] Document the new mechanized constraint in `docs/quality/mechanized-constraints.md`.
- [ ] Mark or reference the doc-gardening pilot in `docs/quality/SPEC-harness-roadmap.md` if useful.

**Verification:**
- [ ] CI-equivalent local command passes:
  - `python3 scripts/check-docs-indices.py`
  - `python3 scripts/check-doc-code-hashes.py --check`
  - `bash scripts/check-agents-md-size.sh`

---

## Task 5: Regression scenarios

**Scenario A: Code changed, doc unchanged**
- [ ] Temporarily edit one tracked file.
- [ ] Run `python3 scripts/check-doc-code-hashes.py --check`.
- [ ] Confirm it fails and names the stale design doc, tracked file, reason, and fix steps.

**Scenario B: Code changed, doc changed, hash stale**
- [ ] Temporarily edit one tracked file and the linked design doc.
- [ ] Do not run `--update-doc`.
- [ ] Confirm `--check` fails because `index.json` hash is stale.

**Scenario C: Code changed, doc changed, hash refreshed**
- [ ] Edit tracked file and linked design doc.
- [ ] Run `python3 scripts/check-doc-code-hashes.py --update-doc 2026-05-03-new-cli-runtime-integration-guide.md`.
- [ ] Confirm `--check` passes.

**Cleanup:**
- [ ] Revert temporary edits used for regression scenarios.

---

## Definition of Done

- [ ] Pilot guide has tracked code file hashes in `docs/design-docs/index.json`.
- [ ] Hash mismatch forces same-PR design doc update.
- [ ] Hash mismatch also forces refreshed `index.json` sha256.
- [ ] CI runs the guard in `repo-checks`.
- [ ] Existing docs index checks still pass.
