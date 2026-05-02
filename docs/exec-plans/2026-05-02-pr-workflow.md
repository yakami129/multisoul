# PR-Based Development Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce PR-based workflow: no direct push to main, CI must pass before merge, Claude Code auto-creates PRs after user confirmation.

**Architecture:** GitHub branch protection rules block direct pushes. Existing CI workflow (`.github/workflows/ci.yml`) is registered as required status checks. PR template standardizes PR description. CLAUDE.md updated to constrain Claude Code behavior.

**Tech Stack:** GitHub branch protection, GitHub Actions (already exists), `gh` CLI, git worktree

**Spec:** `docs/product-specs/SPEC-pr-workflow.md`

---

## Files

| Action | Path |
|--------|------|
| Create | `.github/pull_request_template.md` |
| Modify | `CLAUDE.md` — add §PR Workflow section |
| Manual | GitHub web: branch protection + squash-only merge |

---

### Task 1: Create PR Template

**Files:**
- Create: `.github/pull_request_template.md`

- [ ] **Step 1: Create the file**

```markdown
## Summary
<!-- 改了什么，为什么 -->

## Test plan
- [ ] CI 通过（cargo test + cargo build + pnpm typecheck + pnpm test）
- [ ] 手动验证：...

## Risk
<!-- 潜在影响范围、需要注意的地方 -->
```

Write to `.github/pull_request_template.md`.

- [ ] **Step 2: Verify the file exists**

Run:
```bash
cat .github/pull_request_template.md
```
Expected: file contents as above.

- [ ] **Step 3: Commit**

```bash
git checkout -b chore/pr-workflow
git add .github/pull_request_template.md
git commit -m "chore: add PR template with Summary/Test plan/Risk sections"
```

---

### Task 2: Update CLAUDE.md — Add PR Workflow Section

**Files:**
- Modify: `CLAUDE.md` — after §2 约束 section, add a new subsection about PR workflow

- [ ] **Step 1: Add PR workflow constraint to CLAUDE.md**

In `CLAUDE.md`, find the section **`## 2. 关键约束`** and add at the end of the human-readable soft constraints list:

```markdown
- **禁止直接 push main** —— 所有变更必须通过 PR；直接 push 会被 GitHub branch protection 拒绝
- **PR 开启前必须验证** —— `cargo test` + `cargo build` + `pnpm typecheck` + `pnpm test --watchAll=false` 全部通过
- **开 PR 需用户确认** —— Claude Code 自动 commit 到功能分支后，必须等用户确认才能执行 `gh pr create`
- **CI 失败自动修复** —— 读取 `gh run view --log-failed` 日志，尝试修复 lint/type/fmt 错误后 re-push；逻辑错误上报用户
```

- [ ] **Step 2: Add Claude Code PR behavior section**

At the end of `CLAUDE.md` (after §12 or at a new §13), add:

```markdown
## 13. PR 工作流（Claude Code 行为约束）

### 开发时
- 优先使用 `git worktree`（skill `superpowers:using-git-worktrees`）隔离开发
- 分支命名：`feat/<desc>`, `fix/<desc>`, `chore/<desc>`

### 完成功能后
1. 在分支上运行 `cargo test` + `cargo build` + `cd mobile && pnpm typecheck` + `pnpm test -- --watchAll=false`
2. 用 `commit` skill 提交代码
3. **等用户确认**后，执行：
   ```bash
   gh pr create --title "<title>" --body "$(cat <<'EOF'
   ## Summary
   <!-- 改了什么 -->

   ## Test plan
   - [ ] CI 通过
   - [ ] 手动验证：...

   ## Risk
   <!-- 影响范围 -->
   EOF
   )"
   ```
4. 等待 CI 结果（`gh pr checks`）

### CI 失败时
1. `gh run view --log-failed` 读取日志
2. 尝试修复 lint/type/fmt 错误并 re-push
3. 复杂错误上报用户等待指示

### 禁止
- `git push origin main`（任何情况）
- 在 main 分支上 commit
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "chore: add PR workflow behavior constraints to CLAUDE.md"
```

---

### Task 3: Create and Merge the PR (validates the workflow itself)

- [ ] **Step 1: Push the branch**

```bash
git push -u origin chore/pr-workflow
```

- [ ] **Step 2: Wait for user confirmation, then open PR**

After user confirms, run:

```bash
gh pr create \
  --title "chore: enforce PR-based workflow (template + CLAUDE.md)" \
  --body "$(cat <<'EOF'
## Summary
- 新增 `.github/pull_request_template.md`（Summary / Test plan / Risk 三段式）
- 更新 `CLAUDE.md` §2 及新增 §13，约束 Claude Code 禁止直接 push main、开 PR 前验证、等用户确认

## Test plan
- [ ] CI 通过（repo-checks + mobile-check + cli-check）
- [ ] 在 GitHub web 上确认 PR template 已自动填充

## Risk
- 本 PR 合并后需立即在 GitHub 配置 branch protection（见 Task 4），否则保护尚未生效
EOF
)"
```

- [ ] **Step 3: Monitor CI**

```bash
gh pr checks
```

Wait for all 3 checks to pass: `repo checks (constraints)`, `mobile (typecheck + lint + test)`, `cli (build + test)`.

- [ ] **Step 4: Merge (Squash)**

```bash
gh pr merge --squash --delete-branch
```

---

### Task 4: Configure GitHub Branch Protection (Manual — GitHub Web)

> This task cannot be automated via CLI without admin token. Must be done in GitHub web UI.

- [ ] **Step 1: Open branch protection settings**

Navigate to: `https://github.com/yakami0129/multisoul/settings/branches`

Click **Add rule** (or **Edit** if a rule exists for `main`).

- [ ] **Step 2: Configure the rule**

Branch name pattern: `main`

Check the following:
- ✅ **Require a pull request before merging**
  - Required approvals: 0 (review is soft requirement)
- ✅ **Require status checks to pass before merging**
  - ✅ Require branches to be up to date before merging
  - Add required checks (search and select):
    - `repo checks (constraints)`
    - `mobile (typecheck + lint + test)`
    - `cli (build + test)`
- ✅ **Do not allow bypassing the above settings**

Click **Save changes**.

- [ ] **Step 3: Restrict merge strategies to Squash only**

Navigate to: `https://github.com/yakami0129/multisoul/settings`

Under **Pull Requests**:
- ❌ Allow merge commits — uncheck
- ❌ Allow rebase merging — uncheck
- ✅ Allow squash merging — keep checked
- ✅ (Optional) Default to PR title for squash merge commit message

Click **Save**.

- [ ] **Step 4: Verify protection is active**

Try to push directly to main:
```bash
git checkout main
echo "# test" >> README.md
git add README.md
git commit -m "test: should be rejected"
git push origin main
```

Expected output:
```
remote: error: GH006: Protected branch update failed for refs/heads/main.
remote: error: Required status check "..." is expected.
To https://github.com/yakami0129/multisoul.git
 ! [remote rejected] main -> main (protected branch hook declined)
```

Revert the local commit after verifying:
```bash
git reset --hard HEAD~1
```

---

## Acceptance Checklist

- [ ] `.github/pull_request_template.md` exists and contains Summary/Test plan/Risk
- [ ] `CLAUDE.md` §13 added with PR workflow behavior
- [ ] Direct push to main is rejected with 403/protected branch error
- [ ] Opening a PR auto-populates the template
- [ ] CI runs automatically on new PRs
- [ ] Only squash merge is available in the UI
