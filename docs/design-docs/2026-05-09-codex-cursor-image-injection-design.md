---
# Codex / Cursor-CLI / InfCode 图片输入设计

## 问题

`codex`、`cursor-cli` 和 `infcode` runtime 的 `send_to_session` 签名不都能原生接收 `file_id`，导致用户发送图片时图片信息可能在 `runtime/mod.rs` 的 dispatch 层被静默丢弃。

## 决策

**Codex 使用原生 `codex exec --image <path>`；Cursor-CLI 和 InfCode 使用路径前缀注入。**

原因：`codex-cli 0.130.0` 已实测支持 `codex exec ... - --image <file>` 和 `codex exec resume ... - --image <file>`，能直接把图片作为多模态附件传给模型。Cursor-CLI 和 InfCode JSON CLI 尚无等价稳定图片参数，因此仍在 dispatch 层将图片绝对路径注入到 prompt 文本前缀，让 agent 自行用文件读取工具查看图片。

## 方案权衡

| 方案 | 优点 | 缺点 | 结论 |
|------|------|------|------|
| A. Codex 原生 `--image` + Cursor/InfCode 路径注入（当前方案） | Codex 走真实多模态附件；Cursor/InfCode 保持兼容 | runtime 不再完全对称 | **选用** |
| B. 所有 runtime 路径注入 | 实现简单，两个 runtime 对称 | Codex 不能可靠"看到"图片，取决于工具读取和 sandbox | 放弃 |
| C. base64 inline | codex 底层 OpenAI 支持 vision | `codex exec` CLI 使用 `--image` 而非 stdin base64；cursor 不支持 | 放弃 |
| D. 静默忽略并报错 | 用户知情 | 功能缺失 | 放弃 |

## 实现

### Codex argv

```
codex exec ... - --image /absolute/path/to/uploads/<file_id>
codex exec resume ... - --image /absolute/path/to/uploads/<file_id>
```

`--image` 必须放在 stdin prompt marker `-` 之后；否则 Codex CLI 的 `--image <FILE>...` 可变参数可能吞掉 prompt marker，导致 `No prompt provided via stdin`。

Codex worker 从 `SessionMessage.file_id` 计算 `uploads_dir.join(file_id)`，传给 `spawn_codex(..., image_path)`。如果已有 pre-warmed resume 进程，但当前消息带图，则丢弃该无图预热进程并重新 spawn 带 `--image` 的进程。

### Cursor-CLI / InfCode 注入格式

```
[Attached image: /absolute/path/to/uploads/<file_id> — use your file reading tool to view it]
<user_text>
```

### 变更位置

- `cli/src/serve/runtime/mod.rs`：Codex 分支直接传递 `file_id`；Cursor-CLI / InfCode 分支继续调用 `inject_image_prefix`。
- `cli/src/serve/runtime/codex/mod.rs`：`send_to_session` 接收并入队 `file_id`；`build_codex_args` 在带图 turn 中追加 `--image <path>`。
- `cli/src/serve/runtime/infcode/mod.rs`：InfCode adapter 接收已注入图片路径提示的 prompt，不再携带原生 `file_id`。

```rust
fn inject_image_prefix(user_text: &str, file_id: &str, uploads_dir: &std::path::Path) -> String {
    let path = uploads_dir.join(file_id);
    let path_str = path.to_string_lossy().replace('\\', "/");
    format!(
        "[Attached image: {} — use your file reading tool to view it]\n\n{}",
        path_str, user_text
    )
}
```

注入串中的路径统一用正斜杠，避免 Windows 上出现混合分隔符。

dispatch 时：

```rust
let message = runtime::DispatchMessage { text: user_text, file_id, model_id, seq: user_seq };

"codex" => {
    codex::send_to_session(state, conv_id, message, project_path, mode);
}
"cursor-cli" | "infcode" => {
    let effective_text = if let Some(fid) = message.file_id {
        inject_image_prefix(message.text, fid, &state.uploads_dir)
    } else {
        message.text.to_string()
    };
    let runtime_message = runtime::DispatchMessage { text: &effective_text, file_id: None, model_id: message.model_id, seq: message.seq };
    // dispatch to cursor::send_to_session or infcode::send_to_session
}
```

### 不变

- `claude` 路径完全不动
- Codex 仍使用原生 `--image`
- Cursor 和 InfCode 仍使用路径前缀注入

### 2026-05-23 更新

为避免旧 turn 的完成状态覆盖新 turn，runtime dispatch 现在通过 `DispatchMessage { text, file_id, seq }` 传递用户消息。`SessionMessage` 和 `cursor::send_to_session` 因此携带 `seq`，但图片输入策略不变：Codex 继续接收 `file_id`，Cursor 继续接收注入后的 prompt 文本。

### 2026-05-24 更新

conversation 级模型切换把 `model_id` 加入 `DispatchMessage` / `SessionMessage`，由各 runtime adapter 转为底层 CLI 的 `--model` 参数。该字段不改变本文的图片策略：Codex 仍直接消费 `file_id` 并追加 `--image`，Cursor 仍接收已经注入图片路径的文本且不再携带 `file_id`。

### 2026-05-31 更新

runtime dispatch 会先注入 `<multisoul-context>` conversation-id 块，再拼接 runtime-specific 的提示文本。该上下文块不改变本文的图片策略：Codex 仍通过原生 `file_id` / `--image` 传图，Cursor 仍在上下文块之后接收图片路径提示。

### 2026-06-02 更新

新增 `infcode` runtime 后，图片策略沿用 Cursor 路径：dispatch 层先把 `file_id` 转成 `[Attached image: <absolute_path> ...]` prompt 前缀，再注入 `<multisoul-context>` conversation-id 块，最后把 `file_id` 清空后交给 InfCode adapter。InfCode V1 通过 `infcode --mode json` 单次子进程执行，没有原生图片参数，因此不走 Codex 的 `--image` 分支。

### 2026-06-11 更新

新增 `opencode` runtime。opencode CLI（`opencode run --format json`）目前无原生 `--image` flag，图片策略沿用 Cursor / InfCode 路径：dispatch 层的 `("cursor-cli" | "infcode")` match arm 扩展为 `("cursor-cli" | "infcode" | "opencode")`，先将 `file_id` 转为 `[Attached image: <path>]` prompt 前缀，再把 `file_id` 清空后交给 opencode adapter。如果 opencode 未来支持 `--file` / `--image` 原生图片参数，可将其迁移到 Codex 路径并删除该注入分支。

## 测试覆盖

在 `runtime/mod.rs` 的单元测试中验证 Cursor / InfCode 路径注入格式；在 `runtime/codex_tests.rs` 中验证：
- 已存在 Codex session 入队时保留 `file_id`
- fresh `codex exec` 带图 argv 精确包含 `- --image <path>`
- resume `codex exec resume` 带图 argv 精确包含 `- --image <path>`
- 带图 argv 不包含旧的 `[Attached image: ...]` 文本前缀
