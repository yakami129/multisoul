# Chat AI 消息 Markdown 渲染 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Chat 页面 AI 消息气泡增加 Markdown 渲染，同时修复打字机在 tool_call 到来或任务完成时不停止的问题。

**Architecture:** 新增 `MarkdownMessage.tsx` 封装 `react-native-markdown-display`，在 `MessageBubble.tsx` 的 `agent_text` case 中根据 `typewriter` / `forceComplete` prop 决定渲染纯文本（流式中）还是 Markdown（完成后）。`forceComplete` 由 `[id].tsx` 渲染时同步计算，避免 `setState` 异步竞态。

**Tech Stack:** React Native, `react-native-markdown-display`, `expo-clipboard`, TypeScript, `@testing-library/react-native`

**Spec:** `docs/product-specs/SPEC-chat-md-render.md`

---

## 文件变更地图

| 文件 | 类型 | 说明 |
|---|---|---|
| `mobile/src/features/chat/components/MarkdownMessage.tsx` | 新增 | MD 渲染核心组件，封装样式/rules/复制/表格 |
| `mobile/src/features/chat/components/MarkdownMessage.test.tsx` | 新增 | MarkdownMessage 单元测试 |
| `mobile/src/features/chat/components/MessageBubble.tsx` | 修改 | 新增 `forceComplete` prop；agent_text case 切换 MD |
| `mobile/src/features/chat/components/MessageBubble.test.tsx` | 修改 | 新增 MD 渲染测试、forceComplete 测试 |
| `mobile/app/chat/[id].tsx` | 修改 | 新增 `shouldForceComplete` 派生值，传入 MessageBubble |
| `mobile/package.json` | 修改 | 新增 `react-native-markdown-display`，确认 `expo-clipboard` |

---

## Task 1: 安装依赖并配置 Jest mock

**Files:**
- Modify: `mobile/package.json`
- Create: `mobile/__mocks__/react-native-markdown-display.tsx`
- Modify: `mobile/jest.setup.js`

- [ ] **Step 1: 安装 react-native-markdown-display 和 expo-clipboard**

```bash
cd mobile
pnpm add react-native-markdown-display
pnpm add expo-clipboard
```

确认输出含 `react-native-markdown-display` 和 `expo-clipboard` 版本号。

- [ ] **Step 2: 检查是否需要 @types**

```bash
cd mobile
ls node_modules/react-native-markdown-display/src/*.d.ts 2>/dev/null || echo "no bundled types"
```

如果输出 `no bundled types`，执行：
```bash
pnpm add -D @types/react-native-markdown-display
```

- [ ] **Step 3: 创建 Jest mock（react-native-markdown-display 在 Jest 中依赖 native，需 mock）**

创建 `mobile/__mocks__/react-native-markdown-display.tsx`：

```tsx
import React from 'react';
import { Text, View } from 'react-native';

// Minimal mock: renders children as plain text wrapped in a View.
// Tests that need to verify Markdown output should test MarkdownMessage.tsx
// (which wraps this library), not the library itself.
const Markdown = ({ children }: { children: string }) => (
  <View testID="markdown-root">
    <Text>{children}</Text>
  </View>
);

export default Markdown;
```

- [ ] **Step 4: 在 jest.setup.js 中注册 expo-clipboard mock**

在 `mobile/jest.setup.js` 末尾追加：

```js
// Mock expo-clipboard — not available in Jest environment
jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn().mockResolvedValue(undefined),
}));
```

- [ ] **Step 5: 验证依赖安装正常，typecheck 通过**

```bash
cd mobile && pnpm typecheck
```

Expected: 0 errors（此时还没改功能代码，应该干净）

---

## Task 2: 新增 MarkdownMessage 组件（含 PIP-BOY 样式）

**Files:**
- Create: `mobile/src/features/chat/components/MarkdownMessage.tsx`
- Create: `mobile/src/features/chat/components/MarkdownMessage.test.tsx`

- [ ] **Step 1: 写失败测试**

创建 `mobile/src/features/chat/components/MarkdownMessage.test.tsx`：

```tsx
/// MarkdownMessage 组件：渲染 Markdown 内容并提供代码块复制按钮
///
/// 测试1：基础渲染
///   输入：content = "# Hello\n\nsome text"
///   预期：testID="markdown-root" 存在（mock 正常挂载）
///
/// 测试2：代码块复制按钮存在
///   输入：content = "```js\nconsole.log(1)\n```"
///   预期：queryByTestId('copy-btn') 存在
///
/// 测试3：点击复制按钮后显示 COPIED 状态
///   数据：content 含代码块
///   执行：press copy-btn
///   预期：copy-btn 文字变为 "✓ COPIED"（1.5s 内）
///
/// 测试4：历史消息 — 空字符串 content 不崩溃
///   输入：content = ""
///   预期：正常渲染，不抛异常

import * as Clipboard from 'expo-clipboard';
import { act, fireEvent, render } from '@testing-library/react-native';
import React from 'react';
import { MarkdownMessage } from './MarkdownMessage';

describe('MarkdownMessage', () => {
  it('renders markdown root for normal content', () => {
    const { getByTestId } = render(<MarkdownMessage content="# Hello\n\nsome text" />);
    expect(getByTestId('markdown-root')).toBeTruthy();
  });

  it('renders copy button for fenced code block', () => {
    const { queryByTestId } = render(
      <MarkdownMessage content={'```js\nconsole.log(1)\n```'} />,
    );
    // NOTE: this test verifies MarkdownMessage renders a copy button in the code block rule.
    // If the mock replaces the whole Markdown component, this tests our wrapper logic.
    expect(queryByTestId('copy-btn')).not.toBeNull();
  });

  it('shows COPIED feedback on press', async () => {
    jest.useFakeTimers();
    const { getByTestId } = render(
      <MarkdownMessage content={'```js\nconsole.log(1)\n```'} />,
    );
    await act(async () => {
      fireEvent.press(getByTestId('copy-btn'));
    });
    expect(getByTestId('copy-btn').props.children).toContain('COPIED');

    // After 1500ms should reset
    act(() => { jest.advanceTimersByTime(1600); });
    expect(getByTestId('copy-btn').props.children).not.toContain('COPIED');
    jest.useRealTimers();
  });

  it('renders without crash for empty content', () => {
    expect(() => render(<MarkdownMessage content="" />)).not.toThrow();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd mobile && pnpm test -- --watchAll=false --testPathPattern="MarkdownMessage.test"
```

Expected: FAIL — `Cannot find module './MarkdownMessage'`

- [ ] **Step 3: 实现 MarkdownMessage.tsx**

创建 `mobile/src/features/chat/components/MarkdownMessage.tsx`：

```tsx
import * as Clipboard from 'expo-clipboard';
import React, { memo, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import Markdown from 'react-native-markdown-display';

interface Props {
  content: string;
}

// CopyButton — standalone component so useState is scoped per code block
function CopyButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  const handlePress = async () => {
    await Clipboard.setStringAsync(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Pressable
      testID="copy-btn"
      onPress={() => { void handlePress(); }}
      style={{
        position: 'absolute',
        top: 8,
        right: 8,
        paddingHorizontal: 6,
        paddingVertical: 2,
      }}
    >
      <Text
        style={{
          fontFamily: 'Inter',
          fontSize: 10,
          color: copied ? '#33FF33' : '#0F6B0F',
          letterSpacing: 0.5,
        }}
      >
        {copied ? '✓ COPIED' : 'COPY'}
      </Text>
    </Pressable>
  );
}

// Stable styles object — created once outside component to avoid useMemo boilerplate.
// DO NOT put dynamic values here.
const mdStyles = {
  body: {
    fontFamily: 'Geist',
    fontSize: 14,
    color: '#20C20E',
    lineHeight: 20,
    backgroundColor: 'transparent',
  },
  heading1: {
    fontFamily: 'Anton',
    fontSize: 18,
    color: '#33FF33',
    marginTop: 8,
    marginBottom: 4,
  },
  heading2: {
    fontFamily: 'Anton',
    fontSize: 16,
    color: '#33FF33',
    marginTop: 6,
    marginBottom: 4,
  },
  heading3: {
    fontFamily: 'Inter',
    fontSize: 14,
    color: '#33FF33',
    fontWeight: '600' as const,
    marginTop: 4,
    marginBottom: 2,
  },
  bullet_list: { marginVertical: 4 },
  ordered_list: { marginVertical: 4 },
  list_item: { color: '#20C20E', fontFamily: 'Geist', fontSize: 14 },
  bullet_list_icon: { color: '#2D8B2D' },
  ordered_list_icon: { color: '#2D8B2D' },
  code_inline: {
    fontFamily: 'Geist Mono',
    fontSize: 12,
    color: '#33FF33',
    backgroundColor: '#0A1A0A',
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 2,
  },
  fence: {
    backgroundColor: '#0A1A0A',
    borderWidth: 1,
    borderColor: '#0F2B0F',
    borderRadius: 2,
    padding: 12,
    marginVertical: 6,
    position: 'relative' as const,
  },
  code_block: {
    fontFamily: 'Geist Mono',
    fontSize: 12,
    color: '#20C20E',
    backgroundColor: 'transparent',
  },
  blockquote: {
    borderLeftWidth: 3,
    borderLeftColor: '#0F2B0F',
    paddingLeft: 10,
    marginVertical: 4,
  },
  blockquote_text: { color: '#2D8B2D' },
  hr: { backgroundColor: '#0F2B0F', height: 1, marginVertical: 8 },
  strong: { color: '#33FF33' },
  em: { color: '#2D8B2D' },
  table: { marginVertical: 4 },
  thead: { backgroundColor: '#0A3A0A' },
  th: {
    fontFamily: 'Inter',
    fontSize: 12,
    fontWeight: '700' as const,
    color: '#33FF33',
    padding: 6,
    borderWidth: 1,
    borderColor: '#0F2B0F',
  },
  td: {
    fontFamily: 'Geist',
    fontSize: 13,
    color: '#20C20E',
    padding: 6,
    borderWidth: 1,
    borderColor: '#0F2B0F',
    backgroundColor: '#061206',
  },
  tr: {},
};

export const MarkdownMessage = memo(function MarkdownMessage({ content }: Props) {
  const rules = useMemo(
    () => ({
      // Custom fence renderer: wraps code in relative container + adds CopyButton
      fence: (
        node: { key: string; content: string },
        _children: React.ReactNode,
        _parent: unknown,
        styles: typeof mdStyles,
      ) => (
        <View key={node.key} style={styles.fence}>
          <Text style={styles.code_block}>{node.content}</Text>
          <CopyButton code={node.content} />
        </View>
      ),
      // Custom table renderer: wraps in horizontal ScrollView
      table: (
        node: { key: string },
        children: React.ReactNode,
        _parent: unknown,
      ) => (
        <ScrollView
          key={node.key}
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ marginVertical: 4 }}
        >
          <View>{children}</View>
        </ScrollView>
      ),
    }),
    [],
  );

  return (
    <Markdown style={mdStyles} rules={rules}>
      {content}
    </Markdown>
  );
});
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd mobile && pnpm test -- --watchAll=false --testPathPattern="MarkdownMessage.test"
```

Expected: PASS（4 tests）

- [ ] **Step 5: Typecheck**

```bash
cd mobile && pnpm typecheck
```

Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
cd mobile
git add src/features/chat/components/MarkdownMessage.tsx \
        src/features/chat/components/MarkdownMessage.test.tsx \
        __mocks__/react-native-markdown-display.tsx \
        jest.setup.js \
        package.json pnpm-lock.yaml
git commit -m "feat(chat): add MarkdownMessage component with PIP-BOY styles and copy button"
```

---

## Task 3: 修改 MessageBubble — 新增 forceComplete prop + 切换 MD 渲染

**Files:**
- Modify: `mobile/src/features/chat/components/MessageBubble.tsx`
- Modify: `mobile/src/features/chat/components/MessageBubble.test.tsx`

- [ ] **Step 1: 写失败测试**

在 `mobile/src/features/chat/components/MessageBubble.test.tsx` 末尾追加：

```tsx
// ── Markdown 渲染测试 ──────────────────────────────────────────────

describe('MessageBubble agent_text markdown rendering', () => {
  const makeAgentMsg = (text: string): WsMessage => ({
    type: 'message',
    seq: 10,
    role: 'agent_text',
    payload: { text },
    created_at: 0,
  });

  /// 历史消息（typewriter=false）：直接渲染 MarkdownMessage，不走 Text 分支
  ///
  /// 数据构造：
  ///   agent_text msg with text = "# Title"
  ///   typewriter = false（历史消息，不打字）
  ///
  /// 执行过程：
  ///   1. render MessageBubble without typewriter prop
  ///   2. MessageBubble agent_text case: isStreaming = false → MarkdownMessage
  ///
  /// 预期结果：
  ///   - testID="markdown-root" 存在（MarkdownMessage mock 渲染）
  ///   - 不存在光标字符 "▌"
  it('renders MarkdownMessage for historical message (no typewriter)', () => {
    const msg = makeAgentMsg('# Title\n\nhello world');
    const { getByTestId, queryByText } = render(<MessageBubble msg={msg} />);
    expect(getByTestId('markdown-root')).toBeTruthy();
    expect(queryByText(/▌/)).toBeNull();
  });

  /// forceComplete=true 时：立即渲染 MarkdownMessage（不走打字机 interval）
  ///
  /// 数据构造：
  ///   agent_text msg, typewriter=true, forceComplete=true
  ///   即使 typewriter=true，forceComplete 应使其跳过流式分支
  ///
  /// 执行过程：
  ///   1. render MessageBubble with typewriter=true, forceComplete=true
  ///   2. isStreaming = typewriter && !forceComplete && ... = true && false = false
  ///   3. 走 MarkdownMessage 分支
  ///
  /// 预期结果：
  ///   - testID="markdown-root" 存在（MarkdownMessage 渲染）
  ///   - 不存在光标 "▌"（未进入打字机 interval）
  it('renders MarkdownMessage immediately when forceComplete=true even if typewriter=true', () => {
    jest.useFakeTimers();
    const msg = makeAgentMsg('hello world');
    const { getByTestId, queryByText } = render(
      <MessageBubble msg={msg} typewriter forceComplete />,
    );
    expect(getByTestId('markdown-root')).toBeTruthy();
    expect(queryByText(/▌/)).toBeNull();
    jest.useRealTimers();
  });

  /// typewriter 自然结束后切换到 MarkdownMessage
  ///
  /// 数据构造：
  ///   agent_text msg with short text "hi"（2 chars）
  ///   typewriter=true, TYPEWRITER_INTERVAL_MS=18ms
  ///
  /// 执行过程：
  ///   1. 初始：isStreaming=true，显示 "" + 光标
  ///   2. advanceTimersByTime(36ms)：visibleChars >= 2，isStreaming=false
  ///   3. typewriter prop 此时仍 true，但 visibleChars=length → isStreaming=false
  ///   4. 渲染 MarkdownMessage
  ///
  /// 预期结果：
  ///   - 36ms 后 testID="markdown-root" 存在
  it('switches to MarkdownMessage after typewriter completes naturally', async () => {
    jest.useFakeTimers();
    const msg = makeAgentMsg('hi');
    const { getByTestId } = render(<MessageBubble msg={msg} typewriter />);

    act(() => {
      jest.advanceTimersByTime(60); // 2 chars × 18ms + buffer
    });

    expect(getByTestId('markdown-root')).toBeTruthy();
    jest.useRealTimers();
  });

  /// typewriter 从 true 变 false 时：visibleChars 跳到末尾（不截断内容）
  ///
  /// 数据构造：
  ///   agent_text msg with text "abcdefghij"（10 chars）
  ///   先以 typewriter=true 渲染，推进 18ms（只显示 1 char）
  ///   然后 rerender 为 typewriter=false（模拟强制停止）
  ///
  /// 执行过程：
  ///   1. render typewriter=true → 18ms 后 visibleChars=1
  ///   2. rerender typewriter=false → prevTypewriterRef=true → setVisibleChars(10)
  ///   3. isStreaming = false → MarkdownMessage
  ///
  /// 预期结果：
  ///   - rerender 后 testID="markdown-root" 存在（完整内容，不截断）
  it('jumps to full content and renders MD when typewriter switches false', async () => {
    jest.useFakeTimers();
    const msg = makeAgentMsg('abcdefghij');
    const { rerender, getByTestId } = render(<MessageBubble msg={msg} typewriter />);

    act(() => { jest.advanceTimersByTime(18); }); // visibleChars = 1

    await act(async () => {
      rerender(<MessageBubble msg={msg} typewriter={false} />);
    });

    expect(getByTestId('markdown-root')).toBeTruthy();
    jest.useRealTimers();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd mobile && pnpm test -- --watchAll=false --testPathPattern="MessageBubble.test"
```

Expected: FAIL — 新增的 4 个测试 fail（找不到 `markdown-root` / `forceComplete` prop 不存在）

- [ ] **Step 3: 修改 MessageBubble.tsx**

在 `mobile/src/features/chat/components/MessageBubble.tsx` 中：

**a. 在顶部 import 列表后面加 MarkdownMessage import**（在现有 import 块末尾追加）：

```tsx
import { MarkdownMessage } from './MarkdownMessage';
```

**b. Props 接口新增 `forceComplete`**（原 interface Props 内 `typewriter` 行后面）：

```tsx
interface Props {
  msg: WsMessage;
  onAnswer?: (ask_id: string, choice_id?: string, freeform?: string) => void;
  onAnswerMulti?: (ask_id: string, choice_ids: Record<string, string>) => void;
  typewriter?: boolean;
  forceComplete?: boolean;  // 新增：true 时立即完成打字机，渲染 MD
  waiting?: boolean;
  imageUri?: string;
}
```

**c. 函数参数解构新增 `forceComplete = false`**：

```tsx
export const MessageBubble = memo(function MessageBubble({
  msg,
  onAnswer,
  onAnswerMulti,
  typewriter = false,
  forceComplete = false,  // 新增
  waiting = false,
  imageUri,
}: Props) {
```

**d. 在现有 `useEffect`（监听 `agentText / msg.role / msg.seq / typewriter`）后面，新增一个 effect** 处理 `typewriter → false` 时的跳末尾逻辑：

找到现有的 effect（第一个 useEffect，结尾 `}, [agentText, msg.role, msg.seq, typewriter];`），在其后插入：

```tsx
  // When typewriter transitions true → false (natural end or forceComplete),
  // jump visibleChars to the end so the full text is available for MD rendering.
  useEffect(() => {
    if (prevTypewriterRef.current && !typewriter) {
      setVisibleChars(agentText.length);
    }
  }, [typewriter, agentText.length]);
```

**e. 修改 `agent_text` case** — 将现有的：

```tsx
    case 'agent_text': {
      const isScanning = typewriter && visibleChars < agentText.length;
      const displayedText = typewriter
        ? `${agentText.slice(0, visibleChars)}${isScanning ? '▌' : ''}`
        : agentText;

      return (
        <View style={s.aiWrap}>
          <View style={s.aiBubble}>
            <Text style={[s.aiText, isScanning && s.typingText]}>{displayedText}</Text>
          </View>
        </View>
      );
    }
```

替换为：

```tsx
    case 'agent_text': {
      // forceComplete bypasses typewriter even if typewriter prop is still true.
      // This handles the case when a tool_call arrives or conversation completes
      // mid-typewriter — the parent computes this synchronously (no setState race).
      const isStreaming = typewriter && !forceComplete && visibleChars < agentText.length;
      const displayedText = isStreaming
        ? `${agentText.slice(0, visibleChars)}▌`
        : agentText;

      if (isStreaming) {
        return (
          <View style={s.aiWrap}>
            <View style={s.aiBubble}>
              <Text style={[s.aiText, s.typingText]}>{displayedText}</Text>
            </View>
          </View>
        );
      }
      return (
        <View style={s.aiWrap}>
          <View style={s.aiBubble}>
            <MarkdownMessage content={agentText} />
          </View>
        </View>
      );
    }
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd mobile && pnpm test -- --watchAll=false --testPathPattern="MessageBubble.test"
```

Expected: PASS（原有测试 + 新增 4 个全部通过）

注意：原有 `'reveals agent text with scanner cursor'` 测试断言 `getByText('system online')` 在 500ms 后存在——需确认此时已完成 typewriter，走 MarkdownMessage 分支，MD mock 仍会 render `children` 文字，所以应该通过。若 mock 不 render 文字则需调整断言为 `getByTestId('markdown-root')`。

- [ ] **Step 5: Typecheck**

```bash
cd mobile && pnpm typecheck
```

Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
cd mobile
git add src/features/chat/components/MessageBubble.tsx \
        src/features/chat/components/MessageBubble.test.tsx
git commit -m "feat(chat): add forceComplete prop to MessageBubble, switch to MarkdownMessage on completion"
```

---

## Task 4: 修改 [id].tsx — 注入 shouldForceComplete

**Files:**
- Modify: `mobile/app/chat/[id].tsx`

- [ ] **Step 1: 在 `[id].tsx` 中新增 `shouldForceComplete` 派生计算**

找到文件中 `const conversationStatus = conversation?.status ?? 'idle';` 这一行（约第 281 行），在其下方插入：

```tsx
  // Synchronously-computed forceComplete flag — avoids setState async race.
  // true when: last message is a tool_call (AI text phase ended), or task completed/failed.
  // Intentionally excludes 'idle' (initial state) to avoid mis-killing typewriter on load.
  const lastMsg = messages.at(-1);
  const shouldForceComplete =
    lastMsg?.role === 'tool_call' ||
    conversationStatus === 'completed' ||
    conversationStatus === 'failed';
```

- [ ] **Step 2: 在消息列表渲染中传入 forceComplete prop**

找到现有的 `<MessageBubble>` 调用（约第 358 行）：

```tsx
            <MessageBubble
              key={`${msg.seq}`}
              msg={msg}
              typewriter={msg.seq === activeTypewriterSeq}
              onAnswer={sendAnswer}
              onAnswerMulti={sendAnswerMulti}
              imageUri={imageUriForMessage(msg)}
              waiting={false}
            />
```

替换为：

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

- [ ] **Step 3: Typecheck**

```bash
cd mobile && pnpm typecheck
```

Expected: 0 errors

- [ ] **Step 4: 跑全部测试**

```bash
cd mobile && pnpm test -- --watchAll=false
```

Expected: 所有测试通过

- [ ] **Step 5: Commit**

```bash
cd mobile
git add app/chat/[id].tsx
git commit -m "feat(chat): inject forceComplete prop — stop typewriter on tool_call or task completion"
```

---

## Task 5: 验收与收尾

**Files:**（无新文件，仅验证）

- [ ] **Step 1: 全量 typecheck**

```bash
cd mobile && pnpm typecheck
```

Expected: 0 errors，无 `@ts-ignore`

- [ ] **Step 2: 全量测试**

```bash
cd mobile && pnpm test -- --watchAll=false
```

Expected: 全部通过，新增覆盖：
- `MarkdownMessage.test.tsx`：4 tests
- `MessageBubble.test.tsx`：原有 7 + 新增 4 = 11 tests

- [ ] **Step 3: 检查颜色合规**

```bash
cd /Users/alan/Documents/codes/yakami0129/multisoul
bash scripts/check-mobile-colors.sh
```

Expected: 0 violations（所有颜色均在设计白名单内）

- [ ] **Step 4: 检查无 console.log**

```bash
cd mobile
grep -r "console\.log" src/features/chat/components/MarkdownMessage.tsx
```

Expected: 无输出

- [ ] **Step 5: 检查无 #[allow] / eslint-disable / @ts-ignore**

```bash
cd mobile
grep -r "eslint-disable\|@ts-ignore\|ts-expect-error" \
  src/features/chat/components/MarkdownMessage.tsx \
  src/features/chat/components/MessageBubble.tsx \
  app/chat/[id].tsx
```

Expected: 无输出

---

## 自检：Spec Coverage

| Spec 要求 | 对应 Task |
|---|---|
| agent_text 显示 MD 渲染 | Task 2, 3 |
| 代码块 + COPY 按钮 | Task 2 |
| 表格横向滚动 | Task 2 |
| 标题/列表/粗体/斜体/行内代码/引用/分割线 | Task 2（mdStyles） |
| 流式期间纯文本降级 | Task 3 |
| 自然结束切 MD | Task 3 |
| forceComplete：tool_call 触发 | Task 3, 4 |
| forceComplete：completed/failed 触发 | Task 4 |
| 不误杀 ask_question | Task 4（shouldForceComplete 逻辑不含 ask_question） |
| idle 不误杀 | Task 4（shouldForceComplete 明确排除 idle） |
| 历史消息直接 MD | Task 3 |
| typewriter→false 跳末尾 | Task 3 |
| 颜色白名单 | Task 2（mdStyles 全用白名单色）, Task 5 验收 |
| expo-clipboard mock | Task 1 |
