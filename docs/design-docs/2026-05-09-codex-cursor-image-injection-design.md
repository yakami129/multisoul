---
# Codex / Cursor-CLI 图片输入设计

## 问题

`codex` 和 `cursor-cli` runtime 的 `send_to_session` 签名不接受 `file_id`，导致用户发送图片时图片信息被 `runtime/mod.rs` 的 dispatch 层静默丢弃。

## 决策

**Codex 使用原生 `codex exec --image <path>`；Cursor-CLI 继续使用路径前缀注入。**

原因：`codex-cli 0.130.0` 已实测支持 `codex exec ... - --image <file>` 和 `codex exec resume ... - --image <file>`，能直接把图片作为多模态附件传给模型。Cursor-CLI 尚无等价稳定图片参数，因此仍在 dispatch 层将图片绝对路径注入到 prompt 文本前缀，让 agent 自行用文件读取工具查看图片。

## 方案权衡

| 方案 | 优点 | 缺点 | 结论 |
|------|------|------|------|
| A. Codex 原生 `--image` + Cursor 路径注入（当前方案） | Codex 走真实多模态附件；Cursor 保持兼容 | 两个 runtime 不再完全对称 | **选用** |
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

### Cursor-CLI 注入格式

```
[Attached image: /absolute/path/to/uploads/<file_id> — use your file reading tool to view it]
<user_text>
```

### 变更位置

- `cli/src/serve/runtime/mod.rs`：Codex 分支直接传递 `file_id`；Cursor-CLI 分支继续调用 `inject_image_prefix`。
- `cli/src/serve/runtime/codex.rs`：`send_to_session` 接收并入队 `file_id`；`build_codex_args` 在带图 turn 中追加 `--image <path>`。

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
"codex" => {
    codex::send_to_session(state, conv_id, user_text, file_id, project_path, mode);
}
"cursor-cli" => {
    let effective_text = if let Some(fid) = file_id {
        inject_image_prefix(user_text, fid, &state.uploads_dir)
    } else {
        user_text.to_string()
    };
    cursor::send_to_session(state, conv_id, &effective_text, project_path, mode);
}
```

### 不变

- `cursor::send_to_session` 签名不变
- `claude` 路径完全不动
- `SessionMessage` 结构体不变

## 测试覆盖

在 `runtime/mod.rs` 的单元测试中验证 Cursor 路径注入格式；在 `runtime/codex_tests.rs` 中验证：
- 已存在 Codex session 入队时保留 `file_id`
- fresh `codex exec` 带图 argv 精确包含 `- --image <path>`
- resume `codex exec resume` 带图 argv 精确包含 `- --image <path>`
- 带图 argv 不包含旧的 `[Attached image: ...]` 文本前缀
