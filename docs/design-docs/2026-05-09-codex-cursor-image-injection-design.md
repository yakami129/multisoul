---
# Codex / Cursor-CLI 图片路径注入设计

## 问题

`codex` 和 `cursor-cli` runtime 的 `send_to_session` 签名不接受 `file_id`，导致用户发送图片时图片信息被 `runtime/mod.rs` 的 dispatch 层静默丢弃。

## 决策

**在 dispatch 层消费 `file_id`**，将图片绝对路径注入到 prompt 文本前缀，让 agent 自行用文件读取工具查看图片。codex 和 cursor-cli 的 `send_to_session` 签名保持不变。

## 方案权衡

| 方案 | 优点 | 缺点 | 结论 |
|------|------|------|------|
| A. 路径注入（本方案） | 实现简单，两个 runtime 对称，不改签名 | Agent 能否真正"看到"图片取决于其工具能力 | **选用** |
| B. base64 inline | codex 底层 OpenAI 支持 vision | `codex exec` CLI 不保证接受 base64 inline；cursor 不支持 | 放弃 |
| C. 静默忽略并报错 | 用户知情 | 功能缺失 | 放弃 |

## 实现

### 注入格式

```
[Attached image: /absolute/path/to/uploads/<file_id> — use your file reading tool to view it]

<user_text>
```

### 变更位置

只改 `cli/src/serve/runtime/mod.rs`：

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
"codex" | "cursor-cli" => {
    let effective_text = if let Some(fid) = file_id {
        inject_image_prefix(user_text, fid, &state.uploads_dir)
    } else {
        user_text.to_string()
    };
    // 再分发给对应 runtime
}
```

### 不变

- `codex::send_to_session` 签名不变
- `cursor::send_to_session` 签名不变
- `claude` 路径完全不动
- `SessionMessage` 结构体不变

## 测试覆盖

在 `runtime/mod.rs` 的单元测试中验证：
- `file_id = Some(...)` 时，注入后的文本包含路径前缀
- `file_id = None` 时，文本不变
- 路径拼接正确（`uploads_dir.join(file_id)`）
