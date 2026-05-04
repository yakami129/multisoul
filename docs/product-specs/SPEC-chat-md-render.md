# Chat AI 消息 Markdown 渲染 SPEC

**版本**: 1.1  
**日期**: 2026-05-03

---

## 1. 背景与目标

当前 `MessageBubble.tsx` 中 `agent_text` 角色的 AI 消息仅以纯文本渲染（`<Text>{displayedText}</Text>`），
Markdown 语法（代码块、标题、列表、加粗等）原样裸露。AI 回复大量使用 Markdown，导致阅读体验极差。

**目标**：

1. 为 AI 消息气泡增加完整 Markdown 渲染能力
2. 修复打字机在不该继续播放时仍在运行的问题：收到 `tool_call` 或任务完成/失败时，立即终止打字机，完整显示文本后切换 MD 渲染

---

## 2. 范围

### In Scope
- `agent_text` 消息气泡的 Markdown 渲染
- 支持：代码块、标题（H1–H3）、有序/无序列表、粗体、斜体、行内代码、表格、分割线、引用块
- 代码块右上角"复制"按钮
- 表格横向滑动（溢出处理）
- 流式 typewriter 期间降级为纯文本，流式完成后切换为 Markdown 渲染
- 样式严格遵循 PIP-BOY 设计系统绿色系

### Out of Scope
- 语法高亮（不引入代码高亮库）
- `user_text` 消息的 Markdown 渲染
- 图片/链接点击跳转（`[text](url)` 仅渲染文字，不可跳转）
- 任何 HTML 标签渲染

---

## 3. 技术选型

| 项 | 决策 |
|---|---|
| 库 | `react-native-markdown-display` |
| 语法高亮 | 不引入 |
| 表格溢出 | 表格外层包裹 `<ScrollView horizontal>` |
| 代码块复制 | 自定义 `pre` renderer，右上角 `Clipboard.setStringAsync()` |

---

## 4. 渲染策略

### 4.1 流式 vs 完成状态

| 状态 | `typewriter` prop | 渲染方式 |
|---|---|---|
| 流式输入中 | `true`（`visibleChars < agentText.length`） | 纯 `<Text>` + 光标动画（现有行为不变） |
| 流式完成（正常结束） | `false`（`visibleChars >= agentText.length`） | 切换为 `MarkdownMessage` 渲染 |
| 历史消息（无 typewriter） | `false` | 直接 `MarkdownMessage` 渲染 |

**切换时机**：`typewriter` 由 `true` 变 `false` 时，触发一次切换，不产生重新动画。

---

### 4.2 打字机强制终止（新增）

#### 设计方案：`forceComplete` prop（当帧生效，无竞态）

不使用 `setTypewriterSeq(null)`（setState 异步，下帧才生效，存在竞态），改为在 `[id].tsx` 渲染时**同步计算 `forceComplete` bool**，直接传给 `MessageBubble`。

**原方案 `setTypewriterSeq(null)` 的三个问题：**

1. **竞态**：`setTypewriterSeq(null)` 下帧才生效，当帧 `typewriter` prop 不变，打字机视觉上不立即停
2. **`idle` 误杀**：`idle` 是页面初始态，用它作触发条件会在历史消息加载时误杀打字机
3. **双轨制盲区**：`activeTypewriterSeq = incomingAgentTextSeq ?? typewriterSeq`，只清 `typewriterSeq` 但 `incomingAgentTextSeq` 仍可能非 null，打字机仍不停

#### `forceComplete` 计算逻辑（在 `[id].tsx` 渲染时同步计算）

```ts
// 触发强制完成的条件（同步计算，当帧生效）
const lastMsg = messages.at(-1);
const shouldForceComplete =
  // 条件1：最后一条消息是 tool_call（说明 AI 文本已输完，进入工具调用阶段）
  lastMsg?.role === 'tool_call' ||
  // 条件2：任务已完成或失败（用 completed/failed，不含 idle 避免初始误判）
  conversationStatus === 'completed' ||
  conversationStatus === 'failed';
```

在消息列表渲染时：
```tsx
<MessageBubble
  key={`${msg.seq}`}
  msg={msg}
  typewriter={msg.seq === activeTypewriterSeq}
  forceComplete={msg.seq === activeTypewriterSeq && shouldForceComplete}
  ...
/>
```

#### `MessageBubble` 内部响应

新增 `forceComplete` prop（`boolean`，默认 `false`）。

当 `forceComplete === true` 时：
- 跳过 typewriter interval，直接 `setVisibleChars(agentText.length)`
- 等价于 typewriter 自然结束——渲染 `MarkdownMessage`（完整文本）

```ts
// MessageBubble 内部，在渲染逻辑中：
const isStreaming = typewriter && !forceComplete && visibleChars < agentText.length;
```

#### 各触发条件说明

| 触发条件 | 说明 |
|---|---|
| 最后一条消息 `role === 'tool_call'` | AI 文本阶段结束，进入工具调用，当前 agent_text 立即完成 |
| `conversationStatus === 'completed'` | 任务整体完成，停止所有打字机 |
| `conversationStatus === 'failed'` | 任务失败，停止打字机 |
| 新一条 `agent_text` 进来 | `activeTypewriterSeq` 自然切换到新 seq，旧消息 `typewriter` prop 变 false，`MessageBubble` 内 `typewriter→false` effect 跳到末尾，无需额外处理 |

**不触发的情况**：
- 收到 `ask_question`、`tool_result`——不影响打字机
- `conversationStatus === 'idle'`——初始态，不作为终止条件

---

## 5. 组件变更

### 5.1 `app/chat/[id].tsx`（修改）

**新增同步计算 `shouldForceComplete`**（无新 state/effect，纯派生值）：

```ts
const lastMsg = messages.at(-1);
const shouldForceComplete =
  lastMsg?.role === 'tool_call' ||
  conversationStatus === 'completed' ||
  conversationStatus === 'failed';
```

**传入 MessageBubble**：

```tsx
<MessageBubble
  key={`${msg.seq}`}
  msg={msg}
  typewriter={msg.seq === activeTypewriterSeq}
  forceComplete={msg.seq === activeTypewriterSeq && shouldForceComplete}
  onAnswer={sendAnswer}
  onAnswerMulti={sendAnswerMulti}
  imageUri={imageUriForMessage(msg)}
  waiting={false}
/>
```

### 5.2 `MessageBubble.tsx`（修改）

**Props 新增 `forceComplete`**：

```ts
interface Props {
  msg: WsMessage;
  onAnswer?: ...;
  onAnswerMulti?: ...;
  typewriter?: boolean;
  forceComplete?: boolean;  // 新增
  waiting?: boolean;
  imageUri?: string;
}
```

**`agent_text` case 改动**：

```tsx
// forceComplete 时跳过 interval，直接跳到末尾
const isStreaming = typewriter && !forceComplete && visibleChars < agentText.length;

// 当 typewriter 从 true 变 false 时（forceComplete 或自然结束），跳到末尾
useEffect(() => {
  if (prevTypewriterRef.current && !typewriter) {
    setVisibleChars(agentText.length);
  }
}, [typewriter, agentText.length]);

if (isStreaming) {
  return (
    <View style={s.aiWrap}>
      <View style={s.aiBubble}>
        <Text style={[s.aiText, s.typingText]}>{displayedText}</Text>
      </View>
    </View>
  );
} else {
  return (
    <View style={s.aiWrap}>
      <View style={s.aiBubble}>
        <MarkdownMessage content={agentText} />
      </View>
    </View>
  );
}
```

### 5.3 新增 `MarkdownMessage.tsx`

路径：`mobile/src/features/chat/components/MarkdownMessage.tsx`

职责：
- 封装 `react-native-markdown-display` 的 `Markdown` 组件
- 注入 `styles` 映射（见 §6）
- 注入自定义 `rules`：
  - `fence` / `code_block`：渲染深色背景块 + 右上角复制按钮
  - `table`：外层包裹 `<ScrollView horizontal>`
- 使用 `React.memo` + `useMemo` 缓存 styles 和 rules，避免每次渲染重新创建对象

---

## 6. 样式规范（PIP-BOY 绿色系）

| Markdown 元素 | 样式 |
|---|---|
| 正文 (`body`) | `Geist`, 14px, `#20C20E`, lineHeight 20 |
| `h1` | `Anton`, 18px, `#33FF33` |
| `h2` | `Anton`, 16px, `#33FF33` |
| `h3` | `Inter`, 14px, `#33FF33`, fontWeight 600 |
| 无序/有序列表 | `Geist`, 14px, `#20C20E`；bullet 色 `#2D8B2D` |
| 行内代码 | `Geist Mono`, 12px, `#33FF33`，背景 `#0A1A0A`，padding 2×4 |
| 代码块背景 | `#0A1A0A`，border `#0F2B0F`，圆角 2px，padding 12 |
| 代码块文字 | `Geist Mono`, 12px, `#20C20E` |
| 复制按钮 | 右上角绝对定位，`Inter` 10px，`#0F6B0F`；复制成功后 1.5s 显示 "✓ COPIED"，颜色 `#33FF33` |
| 引用块左边框 | `#0F2B0F`，left borderWidth 3，paddingLeft 10，文字 `#2D8B2D` |
| 分割线 | 1px，`#0F2B0F` |
| 粗体 | `#33FF33` |
| 斜体 | `#2D8B2D` |
| 表格 header | 背景 `#0F2B0F`，文字 `#33FF33`，`Inter` 12px bold |
| 表格 cell | 背景 `#061206`，文字 `#20C20E`，border `#0F2B0F` |

---

## 7. 代码块复制按钮

```
┌──────────────── code block ────────── [COPY] ┐
│ const x = 1;                                  │
└───────────────────────────────────────────────┘
```

- 按钮文字：`COPY`；复制成功后变为 `✓ COPIED`，1500ms 后恢复
- 使用 `expo-clipboard`（`Clipboard.setStringAsync`）
- 若 `expo-clipboard` 已在项目中，直接使用；否则执行 `pnpm add expo-clipboard`

---

## 8. 表格渲染

表格节点通过自定义 rule 包裹横向滚动：

```tsx
table: (node, children, parent, styles) => (
  <ScrollView
    key={node.key}
    horizontal
    showsHorizontalScrollIndicator={false}
    style={{ marginVertical: 4 }}
  >
    <View>{children}</View>
  </ScrollView>
)
```

---

## 9. 性能分析与应对

| 风险 | 描述 | 应对 |
|---|---|---|
| 流式期间频繁 re-parse | 每次 `visibleChars` 变化都触发 MD re-render | 流式期间完全降级为 `<Text>`，避免 MD parse |
| 强制停止时的竞态 | `setTypewriterSeq(null)` 后 `visibleChars` 还未到末尾，短暂显示截断文本 | `typewriter→false` effect 会立即 `setVisibleChars(agentText.length)`，同帧跳到末尾 |
| 长消息首次 parse 耗时 | 消息完成时 parse 一次（~5–10ms） | `MarkdownMessage` 用 `React.memo`，`content` 不变则不重渲染 |
| FlatList 中大量 MD 节点 | 历史消息全部用 MD 渲染，节点数增加 | `MessageBubble` 已有 `memo`，`MarkdownMessage` 额外加 `useMemo(styles)` |
| 表格 ScrollView 嵌套 | FlatList > Cell > MD > ScrollView(H) | 表格 ScrollView 为 horizontal，方向不冲突，无需特殊处理 |
| 切换瞬间闪烁 | typewriter→false 时从 Text 切换到 Markdown | 切换前后文字颜色和字体一致，视觉差异极小 |
| forceComplete 时内容截断 | forceComplete=true 但 visibleChars 还未到末尾 | `isStreaming = typewriter && !forceComplete && ...`，forceComplete 时直接走 MD 分支，显示完整 `agentText`，不截断 |

---

## 10. 依赖变更

| 包 | 操作 |
|---|---|
| `react-native-markdown-display` | `pnpm add react-native-markdown-display` |
| `@types/react-native-markdown-display` | `pnpm add -D @types/react-native-markdown-display`（若无内置类型） |
| `expo-clipboard` | 确认已在 `package.json`，否则 `pnpm add expo-clipboard` |

---

## 11. 组件变更范围汇总

| 文件 | 变更类型 | 说明 |
|---|---|---|
| `app/chat/[id].tsx` | 修改 | 新增同步计算 `shouldForceComplete`，传入 `forceComplete` prop（无新 state/effect） |
| `features/chat/components/MessageBubble.tsx` | 修改 | 新增 `forceComplete` prop；`agent_text` case：流式降级纯文本，完成/强制完成后渲染 `MarkdownMessage` |
| `features/chat/components/MarkdownMessage.tsx` | 新增 | 封装 MD 渲染、PIP-BOY 样式、代码块复制、表格横向滚动 |
| `features/chat/components/MessageBubble.test.tsx` | 修改 | 新增历史消息 MD 渲染测试、`forceComplete` 立即跳末尾测试 |
| `app/chat/[id].test.tsx`（或相关 test） | 修改/新增 | 新增 tool_call 到来时 `forceComplete=true` 传入测试、status 完成时 `forceComplete=true` 测试 |
| `package.json` / `pnpm-lock.yaml` | 修改 | 新增 `react-native-markdown-display`、确认 `expo-clipboard` |

---

## 12. 验收标准

### 功能验收

- [ ] AI 消息中的 `# 标题`、`## 二级`、`### 三级` 正确渲染，颜色 `#33FF33`
- [ ] `**粗体**` 渲染为 `#33FF33`，`*斜体*` 渲染为 `#2D8B2D`
- [ ] 有序、无序列表正确缩进，bullet 颜色 `#2D8B2D`
- [ ] 代码块显示 `#0A1A0A` 深色背景，右上角有 `COPY` 按钮
- [ ] 点击 `COPY` 后 1.5s 内显示 `✓ COPIED`，随后恢复
- [ ] 行内 `` `code` `` 显示 `Geist Mono` + `#0A1A0A` 背景
- [ ] 表格可横向滑动，不溢出 280px 气泡边界
- [ ] 引用块显示左绿色边框 + 较暗文字 `#2D8B2D`
- [ ] `---` 分割线渲染为 `#0F2B0F` 细线

### 流式/历史行为

- [ ] 流式输入期间（`typewriter === true`）显示纯文本 + 光标，不触发 MD parse
- [ ] 流式完成后（`typewriter` 变 `false`）无感切换为 MD 渲染，无闪烁
- [ ] 历史消息（重新加载页面后）直接以 MD 形式显示

### 打字机强制终止

- [ ] 收到 `tool_call` 消息后，当前正在打字的 `agent_text` 立即停止打字机，显示完整文本并切换 MD
- [ ] 新一条 `agent_text` 进来时，上一条打字机立即停止，完整显示，新一条开始打字
- [ ] `conversation.status` 变为 `completed` 时，打字机立即停止，消息切换为 MD 渲染
- [ ] `conversation.status` 变为 `failed` 时，打字机立即停止，消息切换为 MD 渲染
- [ ] 收到 `ask_question` 消息时，**不**中断当前打字机（ask_question 不属于 tool_call）

### 工程验收

- [ ] `cd mobile && pnpm typecheck` 通过，无 TS 错误
- [ ] `cd mobile && pnpm test -- --watchAll=false` 通过
- [ ] 新增测试覆盖：历史消息 MD 渲染、流式期间纯文本降级、代码块复制按钮
- [ ] 所有颜色严格在 `mobile/docs/design.md` §2 白名单内
- [ ] 无 `console.log`，无 `@ts-ignore`，无 `eslint-disable`
