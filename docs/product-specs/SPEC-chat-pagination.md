# Chat 懒加载分页优化 SPEC

## 1. 背景与目标

### 背景

Chat 对话页面当前初始加载固定 15 条消息，向上翻历史时触发阈值为距顶 80px。
这导致：
- 用户进入稍长对话就立即触发分页加载（15 条不到 1 屏）
- 触发时机过晚（已滚到顶才开始请求），产生可感知的等待停顿

### 业务目标

- 减少初始加载后用户立即触发分页的频率
- 提前触发向上翻页加载，消除可感知的加载等待
- 加载中有明确的 UI 反馈

---

## 2. 范围

### In Scope

- 修改 `chatDetailLimits.ts` 中的分页常量
- 提升 `TOP_LOAD_THRESHOLD` 让向上加载提前触发
- 向上加载时在列表顶部展示 loading 指示器

### Out of Scope

- 后台静默预取（不增加额外网络请求）
- 消息虚拟化 / FlashList 迁移
- 向下无限滚动（实时新消息已由 WebSocket 推送覆盖，不存在向下历史 gap 场景）
- focus_ask_id 跳转后向下加载历史 gap（待后续单独评估）
- 焦点跳转逻辑（`FOCUS_MESSAGE_LIMIT`）不变

---

## 3. 用户与使用场景

### 场景 1：进入长对话

用户打开一条有 30+ 条消息的对话，从最新消息开始阅读，偶尔上滑查看历史上下文。

- **当前痛点**：15 条不到 1 屏，进入后几乎立即触发分页，等待明显。
- **优化后**：初始加载 25 条，覆盖约 1.5-2 屏，绝大多数用户无需立即触发分页。

### 场景 2：连续上滑翻阅历史

用户连续上滑回溯历史对话内容。

- **当前痛点**：滑到顶才触发加载，有明显停顿感。
- **优化后**：距顶 300px（约 3-4 条消息高度）时提前触发，P95 网络延迟内数据到位，用户无感。

---

## 4. 技术实现

### 4.1 常量变更

文件：`mobile/app/chat/chatDetailLimits.ts`

| 常量 | 当前值 | 新值 | 说明 |
|------|--------|------|------|
| `INITIAL_MESSAGE_LIMIT` | 15 | **25** | 覆盖约 1.5-2 屏，减少首次翻页需求 |
| `OLDER_MESSAGE_LIMIT` | 50 | **30** | 配合提前触发，每批适中，prepend 不卡帧 |
| `TOP_LOAD_THRESHOLD` | 80 | **300** | 约 3-4 条消息高度提前触发，P95 网络内无感加载 |

不变的常量：
- `FOCUS_MESSAGE_LIMIT = 100`
- `BOTTOM_STICKY_THRESHOLD = 120`

**300px 阈值推导：**
- 典型消息行高约 60-80px，300px ≈ 3-4 条消息的高度
- 网络延迟 P95 约 200-400ms，300px 滚动距离 + 提前触发可覆盖绝大多数场景
- 小于 200px 用户可能会感知到等待；大于 400px 会增加不必要的提前请求频率

### 4.2 加载状态 UI 反馈

**新增 `isLoadingOlder` 响应式 state**

文件：`mobile/app/chat/useChatDetailHistory.ts`

- 在 `loadOlderMessages` 函数内：开始请求前设 `isLoadingOlder = true`，请求完成/失败后设 `false`
- 注意：store 内存命中（无网络请求）路径也应短暂设为 `true`，保持行为一致

**FlatList 顶部 loading 指示器**

文件：`mobile/app/chat/ChatTranscriptList.tsx`

- 新增 `isLoadingOlder` prop（`boolean`）
- `ListHeaderComponent`：当 `isLoadingOlder === true` 时渲染 loading 指示器，否则返回 `null`
- 样式规范：
  - 高度：40px（含上下 padding 各 8px）
  - ActivityIndicator color：`#FF6B35`（accent）
  - 背景透明，不遮挡消息内容
  - 加载完成后直接消失，无淡出动画

### 4.3 涉及文件汇总

| 文件 | 改动内容 |
|------|---------|
| `mobile/app/chat/chatDetailLimits.ts` | 修改 3 个常量 |
| `mobile/app/chat/useChatDetailHistory.ts` | 新增 `isLoadingOlder` state，loading 期间 true/false |
| `mobile/app/chat/ChatTranscriptList.tsx` | 接收 `isLoadingOlder` prop，渲染 ListHeaderComponent |

---

## 5. UI/UX 要求

- Loading 指示器置于列表**最顶部**，不遮挡消息内容
- 高度 40px（含 padding），不影响 `maintainVisibleContentPosition` 位置锁定
- ActivityIndicator color `#FF6B35`，背景透明
- 加载完成后无动画直接消失，保持简洁

---

## 6. 边界情况

| 场景 | 处理方式 |
|------|---------|
| 已是最早消息（`hasOlderMessages = false`） | 不渲染 loading，不触发请求（现有门控逻辑已处理） |
| 网络请求失败 | `isLoadingOlder` 设回 false，loading 消失；错误由现有 toast/error 处理 |
| 用户进入即快速上滑 | `hasUserScrolledHistory` 门控仍然有效，进入时不触发 |
| store 内存命中（无网络请求）时 | `isLoadingOlder` 短暂为 true，保持行为一致性 |
| `OLDER_MESSAGE_LIMIT` 50→30 对 store 命中率的影响 | store 优先命中逻辑不变，仅减小每次可见窗口大小，命中率不变 |

---

## 7. 非功能性需求

- **性能**：`OLDER_MESSAGE_LIMIT` 减小至 30，每次 prepend 节点数减少，FlatList reconcile 更快
- **网络**：无额外请求（无预取），仅阈值提前，总请求数与用户翻阅深度正相关不变
- **向后兼容**：API 参数 `before_seq + limit` 不变，服务端无需任何改动

---

## 8. 未决问题（待后续评估）

- **focus 跳转后向下历史 gap**：从 Inbox 跳到历史消息后，下方可能有未加载的历史消息（早于最新实时消息）。当前 Out of Scope，需单独 SPEC 评估 `after_seq` 向下加载方案。

---

## 9. 验收标准

- [ ] 进入有 30+ 条消息的对话，初始加载 25 条，不立即触发分页
- [ ] 上滑至距顶 300px 时开始加载，顶部出现 loading 指示器
- [ ] 加载完成后 loading 消失，`maintainVisibleContentPosition` 保证滚动位置不跳动
- [ ] 已是最早消息时无 loading 指示器、不触发请求
- [ ] 网络失败时 loading 消失，页面不崩溃
- [ ] `pnpm typecheck` 通过，无新 TS 错误
- [ ] `pnpm test -- --watchAll=false` 通过
