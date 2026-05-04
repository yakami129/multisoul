# GitHub PR 合并闸（强约束）

本仓库 **不允许在 CI 未全部通过时合并 PR**。本地 pre-commit 可被 `--no-verify` 跳过；**合并前的最终闸口是 GitHub 上的绿色 CI**（见 [`docs/quality/mechanized-constraints.md`](../quality/mechanized-constraints.md) 双层拦截说明）。

## 策略（必须遵守）

- **CI 全绿才允许合并** —— `ci.yml` 中三个 job 均成功，且分支满足「up to date」要求（若已在 protection 中勾选）。
- **禁止绕过硬闸** —— 组织/仓库设置里对此规则应关闭「允许管理员绕过」等价选项（GitHub 文案为 *Do not allow bypassing the above settings*）。
- **人类与 Agent** —— 即使握有 admin 权限，也不应在 CI 失败时用手动覆盖、强制合并或改 protection 来合入；应先修代码或修 CI，再 merge。

## GitHub 仓库配置（核对用）

与 [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) 中的 `jobs.*.name` 一致，将以下检查加入 **Branch protection → Require status checks before merging**：

| 必须通过的 check 名称 |
|----------------------|
| `repo checks (constraints)` |
| `mobile (typecheck + lint + test)` |
| `cli (build + test)` |

建议同时启用：

- **Require a pull request before merging**
- **Require branches to be up to date before merging**（与团队协作习惯一致时）
- **Do not allow bypassing the above settings**

具体点击路径会随 GitHub UI 改版略有不同；历史步骤草案见 [`docs/exec-plans/2026-05-02-pr-workflow.md`](../exec-plans/2026-05-02-pr-workflow.md) Task 4。

## 自助排查

- 查看 PR 检查：`gh pr checks`
- 查看失败日志：`gh run view --log-failed`
