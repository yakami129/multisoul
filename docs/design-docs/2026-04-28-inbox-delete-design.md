# Inbox 条目删除 Design

## 背景与目标

Inbox 已有 `removeItem` store action 和 `deleteInboxItem` service，但没有暴露给用户操作。
目标：让用户可以手动删除任意 inbox 条目，不触发 chat 侧的任何状态变更。

## 范围

**In Scope**
- 左滑露出红色 DELETE 按钮，点击即删（参考微信，无二次确认弹窗）
- 所有 kind（`pending_question`、`complex_done`、`complex_failed`）均可删除
- 删除仅调用 `inboxStore.removeItem`，不调用 `chatStore.markAnswered`

**Out of Scope**
- 批量删除
- 撤销（undo）
- 删除后的任何 chat 侧副作用

## 技术实现

### 组件层

`InboxScreen` 的 `FlatList` 每行用 `react-native-gesture-handler` 的 `Swipeable` 包裹（Expo SDK 54 已内置，零额外依赖）。

```
InboxScreen
└── FlatList
    └── Swipeable (每行)
        ├── renderRightActions → DELETE 按钮（红色，PIP-BOY 风格）
        └── 原有 TouchableOpacity 行内容（不变）
```

### 删除流程

```
用户左滑 → 露出 DELETE 按钮 → 点击
→ inboxStore.removeItem(id)
  → inboxService.deleteInboxItem(id)  [SQLite DELETE]
  → set({ items: items.filter(i => i.id !== id) })
→ 列表更新，chat 侧无任何变化
```

### Chat 隔离保证

- `pending_question` 删除后，chat 里对应的 `ask_question` 消息保持 `answered: false`
- 不调用 `markAnswered`，不发送任何网络请求
- 这是预期行为：用户选择忽略该问题，agent 侧超时或继续等待

### UI 规范（PIP-BOY 风格）

| 属性 | 值 |
|------|-----|
| 按钮背景 | `#3D0000`（深红） |
| 按钮文字 | `DELETE`，`#FF3333`，Anton 字体，11px |
| 按钮宽度 | 72px |
| 边框 | `#5C0000`，1px |
| 圆角 | 0（terminal 风格） |

### 修改文件

- `mobile/src/features/inbox/components/InboxScreen.tsx` — 唯一需要修改的文件
  - 引入 `Swipeable` from `react-native-gesture-handler`
  - 将每行 `View` 包裹进 `Swipeable`，添加 `renderRightActions`
  - `Props` 新增 `onDelete: (id: string) => void`
- `mobile/app/(tabs)/inbox.tsx` — 传入 `onDelete` handler，调用 `removeItem`

## 验收标准

1. 左滑任意 inbox 条目，露出红色 DELETE 按钮
2. 点击 DELETE，条目从列表消失，SQLite 中删除
3. 进入对应 chat，消息列表无变化，`ask_question` 仍显示未回答状态
4. 回答问题的正常流程（`onAnswer` / `onAnswerMulti`）不受影响
