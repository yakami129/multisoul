# Doc-Code Hash Guard Design

## 1. 背景与目标

设计文档会引用具体代码文件，例如 `docs/design-docs/2026-05-03-new-cli-runtime-integration-guide.md` 引用了 runtime adapter、runtime 分发、DB 与 mobile 类型。随着代码演进，文档很容易保持旧说法，造成 Agent 和人类误判。

目标是在 `docs/design-docs/index.json` 中为设计文档记录关联代码文件及 sha256。CI 检测到 tracked code 内容变化时，必须要求对应文档同 PR 更新，并要求 `index.json` 中 hash 同步刷新。

## 2. 设计原则

- hash 是 stale 信号，不是语义一致性证明。
- 第一版只做 pilot：`2026-05-03-new-cli-runtime-integration-guide.md`。
- 第一版对 pilot 使用 blocking gate：tracked code 变了但文档没改，CI fail。
- 不提供 ack/reason 例外通道；代码变了就必须更新文档。
- 更新由代码变更驱动文档变更，再刷新 hash。

## 3. Manifest 数据结构

扩展 `docs/design-docs/index.json`：

```json
{
  "file": "2026-05-03-new-cli-runtime-integration-guide.md",
  "title": "接入新 CLI Runtime 开发指南",
  "trackedFiles": [
    {
      "path": "cli/src/serve/runtime/mod.rs",
      "sha256": "<hex>",
      "reason": "Runtime 分发入口；文档 Step 4 说明新增 runtime match arm。"
    }
  ]
}
```

字段约束：

- `path`：repo-root relative path。
- `sha256`：整个文件内容 sha256。
- `reason`：必填，说明该文件为什么会影响文档。

## 4. Pilot tracked files

第一版使用人工精选 + 文档引用路径：

- `cli/src/serve/runtime/mod.rs`
- `cli/src/serve/state.rs`
- `cli/src/serve/routes/messages.rs`
- `cli/src/serve/runtime/claude.rs`
- `cli/src/serve/runtime/codex.rs`
- `cli/src/serve/runtime/cursor.rs`
- `cli/src/db.rs`
- `mobile/src/types.ts`

## 5. 脚本接口

新增脚本：

```bash
python3 scripts/check-doc-code-hashes.py --check
python3 scripts/check-doc-code-hashes.py --update
```

`--check`：

- 读取 `docs/design-docs/index.json`。
- 对有 `trackedFiles` 的文档逐项计算当前 sha256。
- 若 tracked file hash 与 index 不一致：
  - 检查当前 git diff 中对应文档是否修改。
  - 检查 `index.json` hash 是否刷新到当前值。
  - 任一不满足则 fail，并输出文档路径、代码路径、reason、建议命令。

`--update`：

- 重新计算所有 trackedFiles sha256。
- 写回 `docs/design-docs/index.json`。
- 由开发者/Agent 在完成文档更新后运行。

## 6. CI 行为

将脚本接入 repo-checks：

```bash
python3 scripts/check-doc-code-hashes.py --check
```

失败示例：

```text
[doc-code-hash] docs/design-docs/2026-05-03-new-cli-runtime-integration-guide.md is stale
tracked file changed: cli/src/serve/runtime/mod.rs
reason: Runtime 分发入口；文档 Step 4 说明新增 runtime match arm。
Fix:
  1. Update the design doc in the same PR.
  2. Run python3 scripts/check-doc-code-hashes.py --update.
```

## 7. 非目标

- 不自动判断文档语义是否正确。
- 不自动重写文档。
- 不覆盖 product-specs / exec-plans。
- 不做 line-range / symbol hash。
- 不提供“代码变了但文档无需更新”的 ack 例外。
- 不做全仓文档历史清算。

## 8. Agent 更新建议

第一版 CI 只输出明确失败与修复步骤；未来可在失败输出中追加 Agent prompt：

```text
Review the git diff for <tracked file> and update <design doc> sections impacted by reason: <reason>.
```

## 9. 验收标准

- `index.json` schema 支持 `trackedFiles`，且 reason 必填。
- `--update` 能为 pilot 文档写入当前 sha256。
- 修改 tracked code 但不改文档时，`--check` 失败。
- 修改 tracked code + 文档但不刷新 hash 时，`--check` 失败。
- 修改 tracked code + 文档 + 刷新 hash 时，`--check` 通过。
- 现有 `scripts/check-docs-indices.py` 继续通过。
