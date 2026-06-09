# PR-Based Development Workflow SPEC

## 1. 背景与目标

当前 main 分支无任何保护，Claude Code 和开发者均可直接 push，存在代码质量无保障、无 CI 强制验证的风险。

**目标：** 引入标准 PR 工作流，CI 全量通过作为合并硬门槛，Claude Code 行为受约束，减少意外直接提交。

## 2. 范围

### In Scope
- GitHub main branch protection rules 配置
- PR 模板（`.github/pull_request_template.md`）
- CLAUDE.md 更新（Claude Code 行为约束）

### Out of Scope
- 发布流程（EAS Build / CLI release）——保持现有 SOP 不变
- 多环境分支策略（staging/dev）——仅 main 一条主线
- CI workflow 本身——已有 `.github/workflows/ci.yml` 已覆盖所需检查

## 3. 分支策略

- **命名规范**：`feat/<description>`, `fix/<description>`, `chore/<description>`
- **生命周期**：开发完成 → PR → CI 通过 → Squash merge → 删除分支
- **禁止**：直接 push 到 main

## 4. CI 检查项（已有，需绑定为 required status checks）

现有 `.github/workflows/ci.yml` 已包含：

| Job | 内容 |
|-----|------|
| `repo-checks` | AGENTS.md 大小、secrets 检查、色彩合规、行数限制 |
| `mobile-check` | typecheck + lint + format + test（含 coverage 阈值） |
| `cli-check` | build + test + clippy + fmt |
| `cli-e2e` | build + `cargo test --test e2e_tests`（真实启动 serve 的 HTTP 集成测试） |

需在 branch protection 中将这四个 job 设为 required。

## 5. GitHub Branch Protection Rules

`main` 分支需配置（在 GitHub web Settings → Branches → Add rule）：

- ✅ Require a pull request before merging
- ✅ Require status checks to pass before merging
  - Required checks: `repo checks (constraints)`, `mobile (typecheck + lint + test)`, `cli (build + test)`, `cli (serve e2e)`
- ✅ Require branches to be up to date before merging
- ✅ Do not allow bypassing the above settings
- 合并策略：只允许 Squash merge（在 repo Settings → General → Pull Requests 中设置）

## 6. PR 模板

文件：`.github/pull_request_template.md`

```markdown
## Summary
<!-- 改了什么，为什么 -->

## Test plan
- [ ] CI 通过（`bash scripts/test-all.sh` 或等价：`cargo test` + `cargo test --test e2e_tests` + `pnpm typecheck` + `pnpm test`）
- [ ] 手动验证：...

## Risk
<!-- 潜在影响范围、需要注意的地方 -->
```

## 7. Claude Code 行为约束

### 开发时
- 分支命名遵循 `feat/xxx` 规范

### 完成功能后
1. 在分支上运行完整验证（`bash scripts/test-all.sh` 或等价，含 `cargo test --test e2e_tests`）
2. 使用 `commit` skill 提交代码
3. **等待用户确认**后，使用 `gh pr create` 开 PR（附带 Summary + Test plan + Risk）
4. 等待 CI 结果

### CI 失败时
- 自动读取失败 job 的日志（`gh run view --log-failed`）
- 尝试自动修复（lint error、类型错误、格式问题等）
- 修复后 push，触发 CI 重新运行
- 复杂问题（逻辑错误等）报告给用户，等待指示

### 禁止行为
- 直接 `git push origin main`
- 在 main 分支上做任何 commit

## 8. 验收标准

- [ ] 直接 push 到 main 被 GitHub 拒绝（403 错误）
- [ ] PR 不通过 CI 无法出现 Merge 按钮（或按钮灰色不可点）
- [ ] Claude Code 不再直接 commit 到 main
- [ ] CI 在每个 PR 上自动运行并报告结果
