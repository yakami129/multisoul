# SPEC-chat-ios-ux.md

Chat 界面 iOS 交互优化规格

**版本**: 2.0  
**日期**: 2026-05-03  
**设计稿**: `mobile/docs/pencli/ui.pen` → `Chat UI — iOS Interaction Improvements`（节点 `dmeDp`）

---

## 1. 背景与目标

当前 Chat 界面（`app/chat/[id].tsx` + `features/chat/components/MessageBubble.tsx`）存在以下问题，本次统一改造：

1. **状态反馈缺失**：Header 仅有一个小圆点，无法区分 running/awaiting/completed/failed 等会话状态
2. **AI 等待体验差**：等待 AI 回复时仅显示 "WAIT" 文字按钮
3. **多图上传体验差**：当前只支持单张图片，且预览行仅显示文件名
4. **图片气泡体验差**：已有基础但缺少全屏预览
5. **缺少停止对话**：无法在 AI 运行中中断

---

## 2. 设计稿参考

设计稿共 4 个 iPhone 屏幕（390×844），位于 `mobile/docs/pencli/ui.pen` 节点 `dmeDp`：

| 屏 | 名称 | 核心内容 |
|---|---|---|
| S1 | Chat Main (Status) | Header Badge、重连 Banner、AI 等待动画气泡、发送/停止一体按钮 |
| S2 | Image Upload Input | 图片按钮 + 横向多图预览行（最多 5 张，每张有 × 角标） |
| S3 | Image Bubble | 用户气泡嵌缩略图 + "Tap to enlarge →"；AI 回复正常 |
| S4 | Fullscreen Preview | 深色遮罩全屏 + × 关闭 + 底部文件名 + CRT 角装饰 |

---

## 3. 功能规格

### 3.1 Header 状态 Badge

**位置**：Header 右侧，替换原有圆点。

**会话状态（`conversation.status`）→ Badge 样式：**

| 状态 | 文字 | 背景色 | 圆点颜色 |
|---|---|---|---|
| `running` | RUNNING | `#0A3A0A` | `#33FF33` |
| `awaiting_question` | AWAITING | `#1A1200` | `#FFB000` |
| `completed` | COMPLETED | `#081808` | `#20C20E` |
| `failed` | FAILED | `#1A0000` | `#FF4040` |
| `idle` | IDLE | `#0A1A0A` | `#2D8B2D` |

**WebSocket 连接状态叠加：**

| WS 状态 | 行为 |
|---|---|
| `open` | 不影响 Badge |
| `reconnecting` | Header 下方显示黄色 Banner："⟳  RECONNECTING…" |
| `closed` | Badge 文字改为 "OFFLINE"，橙色配色（`#FFB000`） |

### 3.2 AI 等待动画气泡

发送消息后 `isAwaitingResponse === true` 且尚无 AI 回复时：

- 显示左对齐气泡，内含三个绿点（透明度梯度动画：0.4 → 0.7 → 1.0 依次亮起）
- 气泡下方显示 "Analyzing…"（`Inter`，10px，`#0F6B0F`，letterSpacing 0.5）
- 气泡样式：`$crt-panel` 背景，`$crt-border` 边框，圆角 `[0,16,16,16]`

**替换现有行为**：不再显示 "WAIT" 文字按钮。

### 3.3 图片上传按钮（输入区）

**按钮样式**：
- 圆形（border-radius 18），尺寸 36×36
- 背景 `#0F2B0F`，边框 `$green-muted`
- 图标：Lucide `image`，16×16，颜色 `$green-muted`

**交互**：
1. 点击按钮弹出 ActionSheet，提供"相册"和"拍照"两个选项
2. 调用 `expo-image-picker`（`launchImageLibraryAsync` 或 `launchCameraAsync`）
3. 权限被拒绝时：Alert 提示"请在设置中开启相机/相册权限"，并提供"去设置"按钮（`Linking.openSettings()`）

**图片数量限制**：每次发送最多 5 张，超限时禁止继续选择并提示。

### 3.4 多图横向预览行

**位置**：输入框上方，仅在有待发图片时显示。

**布局**：水平滚动行（`ScrollView horizontal`），左右 padding 16，行高 68。

**每张缩略图**：
- 尺寸 52×52，圆角 8px，背景 `#0A3A0A`
- 右上角 × 角标：圆形（border-radius 9），尺寸 18×18，`#0A1A0A` 背景，`$green-muted` 边框，Lucide `x` 8×8
- 点击 × 角标移除该张图片

**上传时序**：
- 选图后**立即**上传至 `POST /api/v1/uploads`，获取 `file_id`
- 上传中：缩略图上显示 loading 指示器（可用 opacity 降低表示 pending 状态）
- 上传失败：缩略图右下角显示红色 ! 角标，重新点击可重传

### 3.5 发送/停止一体按钮

**空闲/有内容可发**（`!isAwaitingResponse`）：
- 圆形按钮（border-radius 18），尺寸 36×36
- 绿色背景 `$green-primary`，Lucide `send`，颜色 `#040D04`

**AI 运行中**（`isAwaitingResponse`）：
- 深红背景 `#1A0000`，红色边框 `#C24040`，Lucide `square`，颜色 `#FF6060`
- 点击触发 `POST /api/v1/conversations/:id/abort`

### 3.6 停止对话（Abort）

**前端逻辑**：
1. 用户点击停止按钮
2. 调用 REST `POST /api/v1/conversations/:id/abort`（需 Bearer token）
3. 请求成功后：`setIsAwaitingResponse(false)`，等待气泡消失
4. 请求失败时：console.warn，UI 不变（不影响用户继续使用）

**后端**（CLI）：
- 若 `POST /api/v1/conversations/:id/abort` 尚未实现，需新增
- 接口功能：中断当前正在运行的 agent 进程
- 响应：`{ ok: true }` 或错误状态码

### 3.7 图片消息气泡（用户侧）

当 `role === 'user_text'` 且 `payload.file_id` 存在时：

- 气泡宽度自适应，最大 240
- 缩略图：164×120，圆角 2px，背景 `#0A3A0A`（图片未加载时占位）
- 缩略图下方：文字 "Tap to enlarge →"（`#040D04CC`，`Inter`，10px）
- 整个气泡可点击，触发全屏预览

### 3.8 全屏图片预览

- `Modal` 组件，`animationType="fade"` `transparent={true}`
- 遮罩背景：`#040D04F0`
- 图片：`resizeMode="contain"`，`width: '100%'`，`height: 560`
- 关闭按钮：右上角，40×40 圆形（border-radius 2），Lucide `x`，背景 `#0A3A0A`，边框 `$crt-border`
- 底部文件名文字：`$green-muted`，`Inter`，11px

---

## 4. 组件变更范围

| 文件 | 变更类型 | 说明 |
|---|---|---|
| `app/chat/[id].tsx` | 修改 | 多图状态管理（`pendingImages: PendingImage[]`）、图片选择、abort 调用、状态 Badge 逻辑 |
| `features/chat/components/MessageBubble.tsx` | 修改 | 等待动画气泡（三点）、用户图片气泡缩略图、全屏预览 Modal |
| `features/chat/services/chatService.ts` | 新增 | `abortConversation(baseUrl, token, convId)` |
| `cli/src/serve/routes/` | 新增 | `POST /api/v1/conversations/:id/abort` |

---

## 5. 数据结构

```ts
// 待发图片状态
interface PendingImage {
  localUri: string;       // expo-image-picker 返回的本地 URI
  fileId: string | null;  // 上传成功后的 file_id
  status: 'pending' | 'uploading' | 'uploaded' | 'failed';
}
```

---

## 6. 设计约束

- 颜色严格遵循 `mobile/docs/design.md` §2 白名单（绿色系 + Vault-Tec amber/red）
- 圆角：输入区按钮最大 18px（圆形胶囊），气泡保持 [0,16,16,16] 风格
- 图标：Lucide，inline 14×14，action 16×16
- 禁止 `console.log`，仅允许 `console.warn/error`
- 禁止 `#[allow]` / `// eslint-disable` / `@ts-ignore` 压制

---

## 7. 验收标准

### 7.1 Header 状态 Badge
- [ ] `conversation.status === 'running'` → Badge 显示 "RUNNING"（绿底亮点）
- [ ] `conversation.status === 'awaiting_question'` → Badge 显示 "AWAITING"（橙底橙点）
- [ ] `conversation.status === 'completed'` → Badge 显示 "COMPLETED"（深绿底绿点）
- [ ] `conversation.status === 'failed'` → Badge 显示 "FAILED"（深红底红点）
- [ ] WebSocket `reconnecting` → Header 下方出现黄色 Banner
- [ ] WebSocket `closed` → Badge 变为 "OFFLINE"

### 7.2 AI 等待动画气泡
- [ ] 发送消息后出现三点脉冲气泡（左对齐，样式符合设计稿）
- [ ] 气泡下方显示 "Analyzing…" 文字
- [ ] AI 有回复后等待气泡消失
- [ ] 不再显示 "WAIT" 文字按钮

### 7.3 图片上传 + 多图预览行
- [ ] 点击 📷 弹出 ActionSheet 含"相册"和"拍照"选项
- [ ] 相册权限拒绝时弹出引导 Alert
- [ ] 选图后立即上传，预览行显示缩略图（上传中有 loading 指示）
- [ ] 每张图片右上角有 × 角标，点击移除该图
- [ ] 超过 5 张后无法继续选择，并有提示
- [ ] 上传失败的图片显示红色 ! 角标
- [ ] 预览行位于输入框上方（横向可滚动）

### 7.4 发送/停止一体按钮
- [ ] 空闲状态：绿色圆形 ➤ 按钮
- [ ] `isAwaitingResponse` 时：切换为红色圆形 ■ 按钮
- [ ] 点击 ■ 调用 abort 接口，成功后 `isAwaitingResponse` 变 false

### 7.5 图片消息气泡 + 全屏预览
- [ ] 用户侧含 `file_id` 的消息气泡显示缩略图
- [ ] 缩略图下方有 "Tap to enlarge →" 提示
- [ ] 点击气泡打开全屏 Modal，图片 `contain` 展示
- [ ] Modal 右上角 × 可关闭
- [ ] 底部显示文件名

### 7.6 工程验收
- [ ] `cd mobile && pnpm typecheck` 通过，无 TS 错误
- [ ] `cd mobile && pnpm test -- --watchAll=false` 通过
- [ ] 所有新功能有对应的回归测试（至少覆盖：多图状态管理、abort 调用、气泡渲染）
- [ ] `cd cli && cargo test` 通过（若新增 abort 接口）
- [ ] UI 改动对照 `mobile/docs/design.md` §11 checklist
