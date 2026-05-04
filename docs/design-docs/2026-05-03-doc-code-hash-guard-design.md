# Doc-Code Hash Guard Design

## 1. 背景与目标

设计文档会引用具体代码文件，例如 `docs/design-docs/2026-05-03-new-cli-runtime-integration-guide.md` 引用了 runtime adapter、runtime 分发、DB 与 mobile 类型。随着代码演进，文档很容易保持旧说法，造成 Agent 和人类误判。

目标是在 `docs/design-docs/index.json` 中为设计文档记录关联代码文件及 sha256。CI 检测到 tracked code 内容变化时，必须要求对应文档同 PR 更新，并要求 `index.json` 中 hash 同步刷新。

## 2. 设计原则

- hash 是 stale 信号，不是语义一致性证明。
- 第一版只做 pilot：`2026-05-03-new-cli-runtime-integration-guide.md`。
- 第一版对 pilot 使用 blocking gate：tracked code 变了但文档没改，CI fail。
- 不提供 ack/reason 例外通道；代码变了就必须更新文档。
- 更新由代码变更驱动：Agent 应先读 tracked 文件 diff，再改文档或写明「无需改正文」的原因，最后仅对该设计文档执行 `--update-doc` 刷新 hash。

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
python3 scripts/check-doc-code-hashes.py --update-doc 2026-05-03-new-cli-runtime-integration-guide.md
```

`--check`：

- 读取 `docs/design-docs/index.json`。
- 对有 `trackedFiles` 的文档逐项计算当前 sha256。
- 若 tracked file hash 与 index 不一致：
  - 检查当前 git diff 中对应文档是否修改。
  - 检查 `index.json` hash 是否刷新到当前值。
  - 任一不满足则 fail，并输出文档路径、代码路径、reason、建议命令。

`--update-doc <DESIGN_DOC>`：

- **仅**更新 `documents[].file == <DESIGN_DOC>`（**basename**，如 `2026-05-03-new-cli-runtime-integration-guide.md`；也接受 `docs/design-docs/…` 形式，脚本只取文件名）的那一条目下全部 `trackedFiles` 的 sha256。
- 写回 `docs/design-docs/index.json`。
- 不提供批量 `--update`，避免一次误刷新多篇 pilot 的 hash。
- 由开发者/Agent 在完成对该篇文档的审查与正文/脚注修改后运行。

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
  1. Read the tracked file diff; update the design doc or add a short note why prose is unchanged.
  2. Run python3 scripts/check-doc-code-hashes.py --update-doc 2026-05-03-new-cli-runtime-integration-guide.md
```

## 7. 非目标

- 不自动判断文档语义是否正确。
- 不自动重写文档。
- 不覆盖 product-specs / exec-plans。
- 不做 line-range / symbol hash。
- CI 仍要求 tracked 变更与**同一篇**设计文档在同一 PR 触及；若正文可不改，须在文档内用简短脚注说明审阅结论与原因（不算「跳过文档」）。
- 不做全仓文档历史清算。

## 8. Agent 更新建议

- 先对 `git diff`（或 PR 中的）tracked 文件做实质审查，再改设计文档对应章节。
- 若确认对读者无影响、正文不必改：在同一设计文档中加一句脚注说明**已审阅**与**为何无需改**（满足「同 PR 触及文档」与可审计性）。
- **禁止**在未读 diff、未改文档的情况下直接运行 `--update-doc` 仅刷新 hash。
- CI 失败信息中会给出针对该篇文档的 `--update-doc <basename>.md` 命令。

## 9. 验收标准

- `index.json` schema 支持 `trackedFiles`，且 reason 必填。
- `--update-doc <pilot-basename>.md` 能为该 pilot 文档写入当前 sha256。
- 修改 tracked code 但不改文档时，`--check` 失败。
- 修改 tracked code + 文档但不刷新 hash 时，`--check` 失败。
- 修改 tracked code + 文档 + 刷新 hash 时，`--check` 通过。
- 现有 `scripts/check-docs-indices.py` 继续通过。
