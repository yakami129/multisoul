# AskQuestion Card 双向同步修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 AskQuestion 卡片在 Chat 和 Inbox 之间状态不同步的问题。

**Architecture:** 客户端直接联动——答题后立即同步两侧状态，不依赖后端 ACK。在 `inboxStore` 新增 `removeItem`，在 `chatStore` 新增 `markAnswered`，给 `WsMessage` 加 `answered` 字段，让 `AskQuestionCard` / `MultiAskQuestionCard` 支持外部已回答状态，最后在 Chat 端和 Inbox 端答题回调中分别触发对方的清理。

**Tech Stack:** React Native, Expo, Zustand, expo-sqlite, TypeScript

---

## 文件改动清单

| 文件 | 操作 |
|------|------|
| `mobile/src/types.ts` | 修改：`WsMessage` 加 `answered?: boolean` |
| `mobile/src/features/inbox/services/inboxService.ts` | 修改：新增 `deleteInboxItem` |
| `mobile/src/store/inboxStore.ts` | 修改：新增 `removeItem` 方法 |
| `mobile/src/store/chatStore.ts` | 修改：新增 `markAnswered` 方法 |
| `mobile/src/features/chat/components/AskQuestionCard.tsx` | 修改：新增 `answered` prop |
| `mobile/src/features/chat/components/MultiAskQuestionCard.tsx` | 修改：新增 `answered` prop |
| `mobile/src/features/chat/components/MessageBubble.tsx` | 修改：透传 `msg.answered` |
| `mobile/src/hooks/useWebSocket.ts` | 修改：答题后调 `inboxStore.removeItem` |
| `mobile/app/(tabs)/inbox.tsx` | 修改：答题后调 `removeItem` + `markAnswered` |

---

## Task 1: WsMessage 加 answered 字段

**Files:**
- Modify: `mobile/src/types.ts:48-54`

- [ ] **Step 1: 修改 WsMessage 接口**

将 `mobile/src/types.ts` 中的 `WsMessage` 接口从：

```typescript
export interface WsMessage {
  type: 'message';
  seq: number;
  role: MessageRole;
  payload: MessagePayload;
  created_at: number;
}
```

改为：

```typescript
export interface WsMessage {
  type: 'message';
  seq: number;
  role: MessageRole;
  payload: MessagePayload;
  created_at: number;
  answered?: boolean;
}
```

- [ ] **Step 2: 验证类型检查通过**

```bash
cd /Users/alan/Documents/codes/yakami0129/multisoul/mobile && pnpm typecheck
```

预期：无新增类型错误。

- [ ] **Step 3: Commit**

```bash
cd /Users/alan/Documents/codes/yakami0129/multisoul/mobile
git add src/types.ts
git commit -m "feat(types): add answered field to WsMessage"
```

---

## Task 2: inboxService 新增 deleteInboxItem

**Files:**
- Modify: `mobile/src/features/inbox/services/inboxService.ts`

- [ ] **Step 1: 在文件末尾新增函数**

在 `mobile/src/features/inbox/services/inboxService.ts` 末尾追加：

```typescript
export async function deleteInboxItem(id: string): Promise<void> {
  const db = getDb();
  await db.runAsync('DELETE FROM inbox WHERE id = ?', [id]);
}
```

- [ ] **Step 2: 验证类型检查**

```bash
cd /Users/alan/Documents/codes/yakami0129/multisoul/mobile && pnpm typecheck
```

预期：无类型错误。

- [ ] **Step 3: Commit**

```bash
cd /Users/alan/Documents/codes/yakami0129/multisoul/mobile
git add src/features/inbox/services/inboxService.ts
git commit -m "feat(inbox): add deleteInboxItem to inboxService"
```

---

## Task 3: inboxStore 新增 removeItem

**Files:**
- Modify: `mobile/src/store/inboxStore.ts`

- [ ] **Step 1: 修改 inboxStore**

将 `mobile/src/store/inboxStore.ts` 完整替换为：

```typescript
import { create } from 'zustand';
import { loadInboxItems, writeInboxItem, markRead, deleteInboxItem } from '@/features/inbox/services/inboxService';
import { type InboxItem } from '@/types';

interface InboxState {
  items: InboxItem[];
  load: () => Promise<void>;
  addItem: (item: InboxItem) => Promise<void>;
  markRead: (id: string) => Promise<void>;
  removeItem: (id: string) => Promise<void>;
}

export const useInboxStore = create<InboxState>((set) => ({
  items: [],

  load: async () => {
    const items = await loadInboxItems();
    set({ items });
  },

  addItem: async (item) => {
    await writeInboxItem(item);
    set((s) => ({ items: [item, ...s.items] }));
  },

  markRead: async (id) => {
    await markRead(id);
    set((s) => ({
      items: s.items.map((i) => (i.id === id ? { ...i, read_at: Date.now() } : i)),
    }));
  },

  removeItem: async (id) => {
    await deleteInboxItem(id);
    set((s) => ({ items: s.items.filter((i) => i.id !== id) }));
  },
}));
```

- [ ] **Step 2: 验证类型检查**

```bash
cd /Users/alan/Documents/codes/yakami0129/multisoul/mobile && pnpm typecheck
```

预期：无类型错误。

- [ ] **Step 3: Commit**

```bash
cd /Users/alan/Documents/codes/yakami0129/multisoul/mobile
git add src/store/inboxStore.ts
git commit -m "feat(store): add removeItem to inboxStore"
```

---

## Task 4: chatStore 新增 markAnswered

**Files:**
- Modify: `mobile/src/store/chatStore.ts`

- [ ] **Step 1: 修改 chatStore**

将 `mobile/src/store/chatStore.ts` 完整替换为：

```typescript
import { create } from 'zustand';
import { type Conversation, type WsMessage } from '@/types';

interface ChatState {
  conversations: Conversation[];
  messages: Record<string, WsMessage[]>;
  setConversations: (convs: Conversation[]) => void;
  removeConversation: (id: string) => void;
  restoreConversation: (conv: Conversation, index: number) => void;
  appendMessage: (conv_id: string, msg: WsMessage) => void;
  setMessages: (conv_id: string, msgs: WsMessage[]) => void;
  markAnswered: (conv_id: string, ask_id: string) => void;
}

export const useChatStore = create<ChatState>((set) => ({
  conversations: [],
  messages: {},
  setConversations: (conversations) => set({ conversations }),
  removeConversation: (id) =>
    set((s) => ({ conversations: s.conversations.filter((c) => c.id !== id) })),
  restoreConversation: (conv, index) =>
    set((s) => {
      const next = [...s.conversations];
      next.splice(index, 0, conv);
      return { conversations: next };
    }),
  appendMessage: (conv_id, msg) =>
    set((s) => {
      const existing = s.messages[conv_id] ?? [];
      if (existing.some((m) => m.seq === msg.seq)) return s;
      return { messages: { ...s.messages, [conv_id]: [...existing, msg] } };
    }),
  setMessages: (conv_id, msgs) => set((s) => ({ messages: { ...s.messages, [conv_id]: msgs } })),
  markAnswered: (conv_id, ask_id) =>
    set((s) => {
      const existing = s.messages[conv_id];
      if (!existing) return s;
      const updated = existing.map((m) =>
        m.role === 'ask_question' && (m.payload as { ask_id?: string }).ask_id === ask_id
          ? { ...m, answered: true }
          : m,
      );
      return { messages: { ...s.messages, [conv_id]: updated } };
    }),
}));
```

- [ ] **Step 2: 验证类型检查**

```bash
cd /Users/alan/Documents/codes/yakami0129/multisoul/mobile && pnpm typecheck
```

预期：无类型错误。

- [ ] **Step 3: Commit**

```bash
cd /Users/alan/Documents/codes/yakami0129/multisoul/mobile
git add src/store/chatStore.ts
git commit -m "feat(store): add markAnswered to chatStore"
```

---

## Task 5: AskQuestionCard 支持外部 answered prop

**Files:**
- Modify: `mobile/src/features/chat/components/AskQuestionCard.tsx:6-25`

- [ ] **Step 1: 新增 answered prop 并初始化内部状态**

将 Props 接口和组件签名从：

```typescript
interface Props {
  question: string;
  subtitle?: string;
  options: AskQuestionOption[];
  multiSelect?: boolean;
  onCancel: () => void;
  onConfirm: (selectedId: string) => void;
}

export default function AskQuestionCard({
  question,
  subtitle,
  options,
  multiSelect = false,
  onCancel,
  onConfirm,
}: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [answered, setAnswered] = useState(false);
```

改为：

```typescript
interface Props {
  question: string;
  subtitle?: string;
  options: AskQuestionOption[];
  multiSelect?: boolean;
  answered?: boolean;
  onCancel: () => void;
  onConfirm: (selectedId: string) => void;
}

export default function AskQuestionCard({
  question,
  subtitle,
  options,
  multiSelect = false,
  answered: answeredProp = false,
  onCancel,
  onConfirm,
}: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [answered, setAnswered] = useState(answeredProp);
```

- [ ] **Step 2: 验证类型检查**

```bash
cd /Users/alan/Documents/codes/yakami0129/multisoul/mobile && pnpm typecheck
```

预期：无类型错误。

- [ ] **Step 3: Commit**

```bash
cd /Users/alan/Documents/codes/yakami0129/multisoul/mobile
git add src/features/chat/components/AskQuestionCard.tsx
git commit -m "feat(ui): AskQuestionCard accepts external answered prop"
```

---

## Task 6: MultiAskQuestionCard 支持外部 answered prop

**Files:**
- Modify: `mobile/src/features/chat/components/MultiAskQuestionCard.tsx:11-19`

- [ ] **Step 1: 新增 answered prop 并初始化内部状态**

将 Props 接口和组件签名从：

```typescript
interface Props {
  questions: QuestionItem[];
  onCancel: () => void;
  onConfirm: (answers: Record<string, string>) => void;
}

export default function MultiAskQuestionCard({ questions, onCancel, onConfirm }: Props) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [answered, setAnswered] = useState(false);
```

改为：

```typescript
interface Props {
  questions: QuestionItem[];
  answered?: boolean;
  onCancel: () => void;
  onConfirm: (answers: Record<string, string>) => void;
}

export default function MultiAskQuestionCard({ questions, answered: answeredProp = false, onCancel, onConfirm }: Props) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [answered, setAnswered] = useState(answeredProp);
```

- [ ] **Step 2: 验证类型检查**

```bash
cd /Users/alan/Documents/codes/yakami0129/multisoul/mobile && pnpm typecheck
```

预期：无类型错误。

- [ ] **Step 3: Commit**

```bash
cd /Users/alan/Documents/codes/yakami0129/multisoul/mobile
git add src/features/chat/components/MultiAskQuestionCard.tsx
git commit -m "feat(ui): MultiAskQuestionCard accepts external answered prop"
```

---

## Task 7: MessageBubble 透传 msg.answered

**Files:**
- Modify: `mobile/src/features/chat/components/MessageBubble.tsx:149-186`

- [ ] **Step 1: 在 ask_question case 的每个 AskQuestionCard / MultiAskQuestionCard 上透传 answered**

将 `mobile/src/features/chat/components/MessageBubble.tsx` 中 `case 'ask_question':` 代码块从：

```typescript
    case 'ask_question': {
      const p = msg.payload as AskQuestionPayload;
      if (p.questions.length === 1) {
        const q = p.questions[0];
        if (q.multi_select) {
          return (
            <View style={s.aiWrap}>
              <AskQuestionCard
                question={q.text}
                options={q.options}
                multiSelect
                onCancel={() => onAnswer?.(p.ask_id, '__cancelled__')}
                onConfirm={(ids) => onAnswerMulti?.(p.ask_id, { '0': ids })}
              />
            </View>
          );
        }
        return (
          <View style={s.aiWrap}>
            <AskQuestionCard
              question={q.text}
              options={q.options}
              onCancel={() => onAnswer?.(p.ask_id, '__cancelled__')}
              onConfirm={(id) => onAnswer?.(p.ask_id, id)}
            />
          </View>
        );
      }
      return (
        <View style={s.aiWrap}>
          <MultiAskQuestionCard
            questions={p.questions}
            onCancel={() => onAnswer?.(p.ask_id, '__cancelled__')}
            onConfirm={(answers) => onAnswerMulti?.(p.ask_id, answers)}
          />
        </View>
      );
    }
```

改为：

```typescript
    case 'ask_question': {
      const p = msg.payload as AskQuestionPayload;
      if (p.questions.length === 1) {
        const q = p.questions[0];
        if (q.multi_select) {
          return (
            <View style={s.aiWrap}>
              <AskQuestionCard
                question={q.text}
                options={q.options}
                multiSelect
                answered={msg.answered}
                onCancel={() => onAnswer?.(p.ask_id, '__cancelled__')}
                onConfirm={(ids) => onAnswerMulti?.(p.ask_id, { '0': ids })}
              />
            </View>
          );
        }
        return (
          <View style={s.aiWrap}>
            <AskQuestionCard
              question={q.text}
              options={q.options}
              answered={msg.answered}
              onCancel={() => onAnswer?.(p.ask_id, '__cancelled__')}
              onConfirm={(id) => onAnswer?.(p.ask_id, id)}
            />
          </View>
        );
      }
      return (
        <View style={s.aiWrap}>
          <MultiAskQuestionCard
            questions={p.questions}
            answered={msg.answered}
            onCancel={() => onAnswer?.(p.ask_id, '__cancelled__')}
            onConfirm={(answers) => onAnswerMulti?.(p.ask_id, answers)}
          />
        </View>
      );
    }
```

- [ ] **Step 2: 验证类型检查**

```bash
cd /Users/alan/Documents/codes/yakami0129/multisoul/mobile && pnpm typecheck
```

预期：无类型错误。

- [ ] **Step 3: Commit**

```bash
cd /Users/alan/Documents/codes/yakami0129/multisoul/mobile
git add src/features/chat/components/MessageBubble.tsx
git commit -m "feat(ui): MessageBubble passes msg.answered to AskQuestion cards"
```

---

## Task 8: useWebSocket 答题后清理 Inbox

**Files:**
- Modify: `mobile/src/hooks/useWebSocket.ts:38-41, 140-150`

- [ ] **Step 1: 引入 removeItem 并在 sendAnswer / sendAnswerMulti 中调用**

将 `mobile/src/hooks/useWebSocket.ts` 中：

```typescript
  const appendMessage = useChatStore((s) => s.appendMessage);
  const setMessages = useChatStore((s) => s.setMessages);
  const addInboxItem = useInboxStore((s) => s.addItem);
```

改为：

```typescript
  const appendMessage = useChatStore((s) => s.appendMessage);
  const setMessages = useChatStore((s) => s.setMessages);
  const addInboxItem = useInboxStore((s) => s.addItem);
  const removeInboxItem = useInboxStore((s) => s.removeItem);
```

再在同一文件中将：

```typescript
  const sendAnswer = useCallback((ask_id: string, choice_id?: string, freeform?: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'answer', ask_id, choice_id, freeform }));
    }
  }, []);

  const sendAnswerMulti = useCallback((ask_id: string, choice_ids: Record<string, string>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'answer', ask_id, choice_ids }));
    }
  }, []);
```

改为：

```typescript
  const sendAnswer = useCallback((ask_id: string, choice_id?: string, freeform?: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'answer', ask_id, choice_id, freeform }));
      void removeInboxItem(ask_id);
    }
  }, [removeInboxItem]);

  const sendAnswerMulti = useCallback((ask_id: string, choice_ids: Record<string, string>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'answer', ask_id, choice_ids }));
      void removeInboxItem(ask_id);
    }
  }, [removeInboxItem]);
```

- [ ] **Step 2: 验证类型检查**

```bash
cd /Users/alan/Documents/codes/yakami0129/multisoul/mobile && pnpm typecheck
```

预期：无类型错误。

- [ ] **Step 3: Commit**

```bash
cd /Users/alan/Documents/codes/yakami0129/multisoul/mobile
git add src/hooks/useWebSocket.ts
git commit -m "feat(ws): remove inbox item after sending answer from chat"
```

---

## Task 9: Inbox 端答题后同步两侧状态

**Files:**
- Modify: `mobile/app/(tabs)/inbox.tsx`

- [ ] **Step 1: 引入 chatStore.markAnswered，答题时改为 removeItem，并调用 markAnswered；handleOpen 保留 markRead**

将 `mobile/app/(tabs)/inbox.tsx` 完整替换为：

```typescript
import { useRouter } from 'expo-router';
import React from 'react';
import { SafeAreaView, StyleSheet } from 'react-native';
import { sendConversationAnswer } from '@/features/chat/services/chatService';
import InboxScreen from '@/features/inbox/components/InboxScreen';
import { useEndpointStore } from '@/store/endpointStore';
import { useInboxStore } from '@/store/inboxStore';
import { useChatStore } from '@/store/chatStore';
import { type InboxItem } from '@/types';

export default function InboxTab() {
  const items = useInboxStore((s) => s.items);
  const markRead = useInboxStore((s) => s.markRead);
  const removeItem = useInboxStore((s) => s.removeItem);
  const markAnswered = useChatStore((s) => s.markAnswered);
  const endpoints = useEndpointStore((s) => s.endpoints);
  const router = useRouter();

  const handleOpen = (item: InboxItem) => {
    void markRead(item.id);
    if (item.conversation_id) {
      router.push(`/chat/${item.conversation_id}?endpoint_id=${item.endpoint_id}`);
    }
  };

  const handleAnswer = async (
    item: InboxItem,
    ask_id: string,
    choice_id?: string,
    freeform?: string,
  ) => {
    const ep = endpoints.find((e) => e.id === item.endpoint_id);
    if (!ep) return;
    try {
      await sendConversationAnswer(ep.base_url, ep.token, item.conversation_id, {
        ask_id,
        choice_id,
        freeform,
      });
      void removeItem(item.id);
      markAnswered(item.conversation_id, ask_id);
    } catch {
      /* ignore */
    }
  };

  const handleAnswerMulti = async (
    item: InboxItem,
    ask_id: string,
    choice_ids: Record<string, string>,
  ) => {
    const ep = endpoints.find((e) => e.id === item.endpoint_id);
    if (!ep) return;
    try {
      await sendConversationAnswer(ep.base_url, ep.token, item.conversation_id, {
        ask_id,
        choice_ids,
      });
      void removeItem(item.id);
      markAnswered(item.conversation_id, ask_id);
    } catch {
      /* ignore */
    }
  };

  return (
    <SafeAreaView style={s.safe}>
      <InboxScreen
        items={items}
        onOpen={handleOpen}
        onAnswer={(item, ask_id, choice_id, freeform) => {
          void handleAnswer(item, ask_id, choice_id, freeform);
        }}
        onAnswerMulti={(item, ask_id, choice_ids) => {
          void handleAnswerMulti(item, ask_id, choice_ids);
        }}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#040D04' },
});
```

- [ ] **Step 2: 验证类型检查**

```bash
cd /Users/alan/Documents/codes/yakami0129/multisoul/mobile && pnpm typecheck
```

预期：无类型错误。

- [ ] **Step 3: Commit**

```bash
cd /Users/alan/Documents/codes/yakami0129/multisoul/mobile
git add app/(tabs)/inbox.tsx
git commit -m "feat(inbox): remove item and mark chat answered after answering from inbox"
```

---

## 验收标准

修复完成后，以下场景应全部正常：

1. **Chat 答题 → Inbox 条目消失**：在 Chat 中回答问题后，切换到 Inbox，该 pending_question 条目不再显示
2. **Inbox 答题 → Chat 卡片变为已回答**：在 Inbox 中回答问题后，打开对应 Chat，问答卡片显示"ANSWERED"状态，禁止再次交互
3. **Inbox 答题 → Inbox 条目消失**：回答后该条目立即从列表移除
4. **重启 App → 已答问题不再出现**：SQLite 中该记录已被 DELETE，重启后不会再加载
