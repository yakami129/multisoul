# Chat 图片上传 SPEC

## 1. 背景与目标

当前 chat 仅支持纯文本，用户无法将截图/照片发给 Agent 做视觉分析。
目标：让用户在手机上选图，通过 msctl 传递给 Claude，实现端到端多模态对话。

## 2. 范围

### 2.1 In Scope

- 用户侧图片发送：选择 JPEG/PNG，客户端压缩至 ≤2MB，点击发送时上传后传给 Claude
- 手机端消息气泡内内联缩略图，点击全屏预览
- CLI (Claude runtime) 读取上传图片并以 base64 image content block 发给 Claude
- 大文件（压缩后仍 >2MB）被拒绝并给出提示

### 2.2 Out of Scope

- Markdown / 代码块高亮渲染
- PDF / 文档预览卡片
- Codex runtime 图片支持（Codex stdin 协议不同，需单独适配）
- 图片消息的持久化历史（重新进入对话不显示旧图片缩略图）

## 3. 使用场景

**场景 A（核心）：** 用户拍了一张报错截图 → 选图 → 点击发送 → Claude 分析截图内容并给出建议

## 4. 业务流程

```
[手机] 选图 → 客户端压缩(≤2MB JPEG)
    → 点击发送 → POST /api/v1/uploads
    → [msctl] 保存到 ~/.config/msctl/uploads/<uuid>.jpg，返回 { file_id, url }
    → [手机] POST /api/v1/conversations/:id/messages { text?, file_id }
    → [msctl] 收到消息，读取文件 → base64 → 写入 Claude stdin (image content block)
    → [Claude] 视觉分析 → 返回 agent_text 消息
    → [手机] WS 收到 agent_text，展示回复
```

**文件生命周期：** Claude 处理完该 turn 后，后台异步删除上传的临时文件。

## 5. 数据模型与接口

### 新增 REST 端点

```
POST /api/v1/uploads
  Authorization: Bearer <token>
  Content-Type: multipart/form-data
  Body: file (image/jpeg | image/png, ≤2MB after client compression)
  Response 201: { file_id: string }
  Response 413: 文件过大
  Response 415: 不支持的媒体类型
```

### 现有端点扩展

```
POST /api/v1/conversations/:id/messages  (扩展)
  Body: { text?: string, file_id?: string }
  约束: text 和 file_id 至少一个非空
```

### 消息 payload 扩展

`user_text` role 的 payload 新增可选字段 `file_id`：

```json
{ "text": "帮我看看这个错误", "file_id": "abc-def-123" }
```

纯文本消息不含 `file_id`（向后兼容）。

### Claude stdin — image content block 格式

```json
{
  "type": "user",
  "message": {
    "role": "user",
    "content": [
      {
        "type": "image",
        "source": {
          "type": "base64",
          "media_type": "image/jpeg",
          "data": "<base64-encoded-bytes>"
        }
      },
      { "type": "text", "text": "帮我看看这个错误" }
    ]
  }
}
```

若消息无文字，content 数组只含 image block。

## 6. 技术实现概览

### CLI 端（`cli/src/`）

| 文件 | 改动 |
|------|------|
| `serve/routes/mod.rs` | 注册 `POST /api/v1/uploads` 路由 |
| `serve/routes/uploads.rs` | 新文件：multipart 接收、格式/大小校验、存 `~/.config/msctl/uploads/` |
| `serve/routes/messages.rs` | `PostMessageBody` 增加 `file_id: Option<String>` |
| `serve/runtime/claude.rs` | 新增 `write_user_message_with_image(stdin, text, file_path)`；turn 结束后异步删文件 |

关键约束：
- axum body limit 设为 4MB（客户端压缩目标 ≤2MB，服务端留冗余）
- 文件路径必须在 `~/.config/msctl/uploads/` 内（防路径穿越）
- 上传请求需 Bearer auth，与其他接口一致

### Mobile 端（`mobile/src/features/chat/`）

| 文件 | 改动 |
|------|------|
| `components/ChatScreen.tsx` | 输入框旁新增图片按钮（Lucide `Image` 16x16） |
| `components/MessageBubble.tsx` | `user_text` case 增加 `file_id` 分支：显示缩略图（120x120）+ 文字（如有） |
| `services/chatService.ts` | 新增 `uploadImage(file)` 方法；`postMessage` 接受可选 `file_id` |
| `hooks/useChatSocket.ts` 或 Screen | 管理待发图片状态（pending image URI） |

图片流程：
1. `expo-image-picker` 选图
2. `expo-image-manipulator` 压缩（目标 ≤2MB JPEG）
3. 点击发送 → `POST /api/v1/uploads` → 获得 `file_id`
4. `POST .../messages` 携带 `file_id`（+ 文字）
5. 发送完成后清空 pending image 状态

## 7. UI/UX 要求

- 缩略图：120x120px，`object-fit: cover`，`borderRadius: 2`（PIP-BOY 风格）
- 上传中：输入区显示图片预览 + 绿色进度指示，发送按钮 loading 状态
- 发送成功：气泡内展示缩略图（+ 文字如有），点击 → Modal 全屏展示原图
- 错误提示（toast，不阻断键盘）：
  - >2MB：「图片过大，已无法压缩至 2MB 以内，请选择其他图片」
  - 非 JPEG/PNG：客户端过滤，不发请求
  - 上传网络失败：「图片上传失败，请重试」

## 8. 错误与边界情况

| 场景 | 处理方式 |
|------|----------|
| 图片压缩失败 | toast 提示，不发送 |
| 上传网络失败 | toast 提示，允许重试 |
| msctl 收到 file_id 但文件不存在 | 降级为纯文本消息，日志 warn |
| Claude runtime 为 Codex | 此迭代不处理；`send_to_session` 中 Codex 路径忽略 file_id |
| 图片 + 空文本 | 允许，content 数组只含 image block |

## 9. 非功能性需求

- 服务端 body limit：4MB
- 临时文件目录：`~/.config/msctl/uploads/`（需在 serve 启动时确保目录存在）
- 所有上传请求需 Bearer auth
- Turn 结束后异步删除临时文件，不阻塞响应

## 10. 风险与权衡

- **已做取舍**：图片不持久化，重进对话不显示历史图片缩略图
- **待实测**：Claude CLI `--input-format stream-json` 是否接受 image content block（理论上兼容 Claude API content array，需 spike 验证）
- **不做**：Codex runtime 图片支持（后续迭代）

## 11. 验收标准

- [ ] 手机选 JPEG/PNG 图片 → 点击发送 → Claude 回复里提到图片内容（端到端跑通）
- [ ] 手机消息气泡内显示图片缩略图，点击可全屏查看
- [ ] 压缩后 >2MB 的图片给出 toast 提示，不发请求
- [ ] 非 JPEG/PNG 格式被客户端过滤
- [ ] `cargo test` + `cargo build` + `pnpm typecheck` + `pnpm test -- --watchAll=false` 全部通过
