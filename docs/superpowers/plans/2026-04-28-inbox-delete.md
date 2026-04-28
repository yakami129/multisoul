# Inbox 条目删除 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Inbox 列表添加左滑删除功能，仅删除 inbox 条目，不触发任何 chat 侧状态变更。

**Architecture:** `InboxScreen` 每行用 `Swipeable`（react-native-gesture-handler）包裹，左滑露出红色 DELETE 按钮，点击调用 `inboxStore.removeItem`。`inbox.tsx` tab 传入 `onDelete` handler。chat store 完全不受影响。

**Tech Stack:** React Native, react-native-gesture-handler (`Swipeable`), Zustand (inboxStore), expo-sqlite

---

### Task 1: 修改 InboxScreen — 添加 onDelete prop 和 Swipeable 行

**Files:**
- Modify: `mobile/src/features/inbox/components/InboxScreen.tsx`

- [ ] **Step 1: 在 Props 接口中添加 onDelete**

在 `mobile/src/features/inbox/components/InboxScreen.tsx:8-13` 的 `Props` 接口中添加 `onDelete`:

```typescript
interface Props {
  items: InboxItem[];
  onOpen: (item: InboxItem) => void;
  onAnswer: (item: InboxItem, ask_id: string, choice_id?: string, freeform?: string) => void;
  onAnswerMulti: (item: InboxItem, ask_id: string, choice_ids: Record<string, string>) => void;
  onDelete: (id: string) => void;
}
```

- [ ] **Step 2: 添加 Swipeable import 和 onDelete 解构**

在文件顶部 import 区域添加 `Swipeable`，并在函数签名中解构 `onDelete`:

```typescript
import { Swipeable } from 'react-native-gesture-handler';
```

函数签名改为:
```typescript
export default function InboxScreen({ items, onOpen, onAnswer, onAnswerMulti, onDelete }: Props) {
```

- [ ] **Step 3: 实现 renderRightActions — DELETE 按钮**

在 `FlatList` 的 `renderItem` 内，将 `<View style={s.rowWrap}>` 替换为 `Swipeable` 包裹，并添加 `renderRightActions`:

```typescript
const renderDeleteAction = (id: string) => (
  <TouchableOpacity style={s.deleteBtn} onPress={() => onDelete(id)}>
    <Text style={s.deleteBtnText}>DELETE</Text>
  </TouchableOpacity>
);

// renderItem 内:
return (
  <Swipeable renderRightActions={() => renderDeleteAction(item.id)}>
    <View style={s.rowWrap}>
      {/* 原有内容不变 */}
    </View>
  </Swipeable>
);
```

- [ ] **Step 4: 添加 DELETE 按钮样式**

在 `StyleSheet.create` 末尾添加:

```typescript
deleteBtn: {
  width: 72,
  justifyContent: 'center',
  alignItems: 'center',
  backgroundColor: '#3D0000',
  borderWidth: 1,
  borderColor: '#5C0000',
  borderRadius: 0,
},
deleteBtnText: {
  fontFamily: 'Anton',
  fontSize: 11,
  color: '#FF3333',
  letterSpacing: 1,
},
```

- [ ] **Step 5: 运行 typecheck 确认无类型错误**

```bash
cd mobile && pnpm typecheck
```

Expected: 无错误（或仅有与本次修改无关的已有错误）

- [ ] **Step 6: Commit**

```bash
git add mobile/src/features/inbox/components/InboxScreen.tsx
git commit -m "feat(inbox): add swipe-to-delete with Swipeable, onDelete prop"
```

---

### Task 2: 修改 inbox.tsx tab — 传入 onDelete handler

**Files:**
- Modify: `mobile/app/(tabs)/inbox.tsx`

- [ ] **Step 1: 在 InboxTab 中添加 onDelete handler**

在 `mobile/app/(tabs)/inbox.tsx` 的 `InboxTab` 函数中，`removeItem` 已经从 store 取出（第14行），直接在 JSX 中传入 `onDelete`:

```typescript
<InboxScreen
  items={items}
  onOpen={handleOpen}
  onAnswer={(item, ask_id, choice_id, freeform) => {
    void handleAnswer(item, ask_id, choice_id, freeform);
  }}
  onAnswerMulti={(item, ask_id, choice_ids) => {
    void handleAnswerMulti(item, ask_id, choice_ids);
  }}
  onDelete={(id) => void removeItem(id)}
/>
```

- [ ] **Step 2: 运行 typecheck 确认无类型错误**

```bash
cd mobile && pnpm typecheck
```

Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add mobile/app/(tabs)/inbox.tsx
git commit -m "feat(inbox): wire onDelete handler in InboxTab"
```

---

### Task 3: 手动验收测试

- [ ] **Step 1: 启动 dev server（手动在终端运行）**

```bash
cd mobile && pnpm start
```

- [ ] **Step 2: 验收清单**

1. Inbox 有条目时，左滑任意条目 → 露出红色 DELETE 按钮（宽72px，Anton字体，#FF3333文字）
2. 点击 DELETE → 条目从列表消失，无弹窗
3. 进入该条目对应的 chat → 消息列表无变化，`ask_question` 消息仍显示未回答状态
4. 正常回答问题流程（点击 TAP TO ANSWER → 选择选项 → Confirm）仍正常工作，回答后条目消失
5. `complex_done` / `complex_failed` 类型条目同样可左滑删除
