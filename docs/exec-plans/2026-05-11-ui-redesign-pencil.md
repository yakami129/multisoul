# UI Redesign (Pencil Design System) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 iOS app 所有屏幕的样式从旧 Vault-Tec 绿色系（`#040D04`/`#20C20E`）完整迁移到 Pencil 设计的深色+橙色系（`#0D0D0D`/`#FF6B35`），不改动任何功能逻辑。

**Architecture:** 纯样式替换——只修改 `StyleSheet.create` 中的颜色、字号、圆角、间距等视觉属性，以及 Expo Tabs 的 `screenOptions`。所有业务逻辑、props 接口、状态管理、hooks 保持不变。

**Tech Stack:** React Native StyleSheet, Expo Router Tabs, NativeWind（Settings 页），Lucide React Native icons

---

## 新设计色板速查

| Token | 值 | 用途 |
|-------|----|------|
| `BG` | `#0D0D0D` | 页面背景 |
| `SURFACE` | `#1A1A1A` | 卡片/Tab Bar/搜索框/输入框 |
| `SURFACE_DEEP` | `#111111` | 未读行背景 |
| `SURFACE_SHEET` | `#161616` | Bottom Sheet |
| `DIVIDER` | `#1E1E1E` | 分割线 |
| `TEXT_PRIMARY` | `#FFFFFF` | 主要文字 |
| `TEXT_SECONDARY` | `#DDDDDD` | 次要文字 |
| `TEXT_MUTED` | `#888888` | 辅助文字 |
| `TEXT_DISABLED` | `#666666` | 占位符/禁用 |
| `TEXT_DIM` | `#555555` | 时间戳 |
| `ACCENT` | `#FF6B35` | CTA/未读徽章/选中 |
| `SUCCESS` | `#4CAF50` | 已选中选项边框/空状态图标 |
| `ERROR` | `#FF4444` | 错误/停止按钮 |

---

## 文件清单

| 文件 | 改动类型 |
|------|---------|
| `mobile/app/(tabs)/_layout.tsx` | 修改 Tab Bar screenOptions 颜色 |
| `mobile/src/features/agents/components/AgentList.tsx` | 重写 StyleSheet |
| `mobile/src/features/agents/components/AgentCard.tsx` | 重写 StyleSheet + Avatar 改圆形 |
| `mobile/src/features/chat/components/ChatHomeScreen.tsx` | 重写 StyleSheet |
| `mobile/app/chat/styles.ts` | 重写 StyleSheet |
| `mobile/app/chat/[id].tsx` | 修改内联颜色常量 STATUS_BADGE |
| `mobile/src/features/chat/components/MessageBubble.tsx` | 重写 StyleSheet |
| `mobile/src/features/chat/components/AskQuestionCard.tsx` | 重写 StyleSheet |
| `mobile/src/features/chat/components/MultiAskQuestionCard.tsx` | 重写 StyleSheet |
| `mobile/src/features/inbox/components/InboxScreen.tsx` | 重写 StyleSheet |
| `mobile/app/(tabs)/settings.tsx` | 重写 StyleSheet |
| `mobile/src/features/settings/components/EndpointList.tsx` | 重写 StyleSheet |
| `mobile/src/features/settings/components/AddEndpointModal.tsx` | 重写 StyleSheet |

---

## Task 1: Tab Bar

**Files:**
- Modify: `mobile/app/(tabs)/_layout.tsx`

- [ ] **Step 1: 替换 Tab Bar screenOptions**

将 `tabBarStyle` 改为新色板，激活/非激活色改为白色/暗灰：

```tsx
screenOptions={{
  headerShown: false,
  tabBarStyle: {
    backgroundColor: '#1A1A1A',
    borderTopWidth: 0,
    height: 62,
    marginHorizontal: 20,
    marginBottom: 34,
    borderRadius: 36,
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  tabBarActiveTintColor: '#FFFFFF',
  tabBarInactiveTintColor: '#555555',
  tabBarLabelStyle: {
    fontFamily: 'Inter',
    fontSize: 11,
  },
}}
```

- [ ] **Step 2: 验证**

```bash
cd mobile && pnpm typecheck
```

Expected: 无类型错误。

---

## Task 2: AgentList 屏幕

**Files:**
- Modify: `mobile/src/features/agents/components/AgentList.tsx`

- [ ] **Step 1: 替换 StyleSheet 及内联颜色**

将文件末尾 `const s = StyleSheet.create({...})` 整体替换，同时修改内联颜色引用：

```ts
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0D0D0D' },
  header: {
    height: 52,
    backgroundColor: '#0D0D0D',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1E1E1E',
  },
  headerLeft: { gap: 2 },
  headerTitle: { fontFamily: 'Anton', fontSize: 20, color: '#FFFFFF' },
  headerSub: { fontFamily: 'Inter', fontSize: 11, color: '#888888', letterSpacing: 1.5 },
  headerSubError: { fontFamily: 'Inter', fontSize: 11, color: '#FF6B35', letterSpacing: 1.5 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  loadingText: { fontFamily: 'Inter', fontSize: 11, color: '#888888', letterSpacing: 2 },
  errorIconWrap: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: '#1A1A1A', alignItems: 'center', justifyContent: 'center',
  },
  errorTitle: { fontFamily: 'Anton', fontSize: 20, color: '#FF6B35' },
  errorDesc: { fontFamily: 'Inter', fontSize: 13, color: '#888888', textAlign: 'center', maxWidth: 260 },
  retryBtn: {
    height: 44, paddingHorizontal: 24, borderRadius: 8,
    backgroundColor: '#FF6B35', alignItems: 'center', justifyContent: 'center',
  },
  retryText: { fontFamily: 'Inter', fontSize: 14, fontWeight: '600', color: '#FFFFFF' },
  listContent: { paddingVertical: 8 },
  emptyContainer: { flex: 1 },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24 },
  emptyTitle: { fontFamily: 'Anton', fontSize: 18, color: '#FFFFFF' },
  emptyDesc: { fontFamily: 'Inter', fontSize: 13, color: '#888888', textAlign: 'center', maxWidth: 260 },
});
```

内联颜色修改（JSX 中）：
- `<SlidersHorizontal size={20} color="#2D8B2D" />` → `color="#888888"`
- `<ActivityIndicator size="large" color="#20C20E" />` → `color="#FF6B35"`
- `<AlertCircle size={36} color="#FFB000" />` → `color="#FF6B35"`
- `RefreshControl tintColor="#20C20E"` → `tintColor="#FF6B35"`

- [ ] **Step 2: 验证**

```bash
cd mobile && pnpm typecheck
```

---

## Task 3: AgentCard 组件

**Files:**
- Modify: `mobile/src/features/agents/components/AgentCard.tsx`

- [ ] **Step 1: 替换 StyleSheet**

Avatar 改为圆形（`borderRadius: 20`），颜色全部迁移到新色板：

```ts
const s = StyleSheet.create({
  wrap: { paddingHorizontal: 12, paddingVertical: 6 },
  wrapPressed: { opacity: 0.7 },
  card: { backgroundColor: '#1A1A1A', borderRadius: 12, overflow: 'hidden' },
  cardHeader: {
    height: 52, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', paddingHorizontal: 16,
    borderBottomWidth: 1, borderBottomColor: '#1E1E1E',
  },
  cardHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, marginRight: 8 },
  avatar: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: '#FF6B35', alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontFamily: 'Anton', fontSize: 14, color: '#FFFFFF' },
  nameLine: { flex: 1 },
  agentName: { fontFamily: 'Inter', fontSize: 15, fontWeight: '600', color: '#FFFFFF' },
  runtimeBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: '#0D0D0D' },
  runtimeText: { fontFamily: 'Inter', fontSize: 11, fontWeight: '600', color: '#888888', letterSpacing: 0.5 },
  endpointRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 16, paddingTop: 10, paddingBottom: 4,
  },
  endpointText: { fontFamily: 'Inter', fontSize: 12, color: '#888888', flex: 1 },
  machineRow: { paddingHorizontal: 16, paddingBottom: 10 },
  machineText: { fontFamily: 'Inter', fontSize: 11, color: '#555555', letterSpacing: 1 },
});
```

内联颜色修改：`<Zap size={12} color="#0F6B0F" />` → `color="#555555"`

- [ ] **Step 2: 验证**

```bash
cd mobile && pnpm typecheck
```

Expected: 无类型错误。

---

## Task 4: ChatHomeScreen（对话列表）

**Files:**
- Modify: `mobile/src/features/chat/components/ChatHomeScreen.tsx`

- [ ] **Step 1: 替换 StyleSheet**

```ts
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0D0D0D' },
  header: {
    height: 52, backgroundColor: '#0D0D0D',
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', paddingHorizontal: 16,
    borderBottomWidth: 1, borderBottomColor: '#1E1E1E',
  },
  headerTitle: { fontFamily: 'Anton', fontSize: 32, color: '#FFFFFF' },
  searchWrap: { height: 68, backgroundColor: '#0D0D0D', padding: 12 },
  searchBar: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#1A1A1A', borderRadius: 12,
    paddingHorizontal: 12, gap: 8,
  },
  searchInput: { flex: 1, fontFamily: 'Inter', fontSize: 16, color: '#FFFFFF', height: 44 },
  sectionWrap: { height: 36, justifyContent: 'center', paddingHorizontal: 16 },
  sectionLabel: { fontFamily: 'Inter', fontSize: 13, fontWeight: '600', color: '#666666', letterSpacing: 1 },
  list: { flex: 1 },
  row: {
    height: 72, flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, gap: 12, backgroundColor: '#0D0D0D',
  },
  avatarWrap: { position: 'relative' },
  avatar: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: '#FF6B35', alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontFamily: 'Anton', fontSize: 14, color: '#FFFFFF' },
  unreadDot: {
    position: 'absolute', top: -2, right: -2,
    width: 10, height: 10, borderRadius: 5, backgroundColor: '#FF6B35',
  },
  rowContent: { flex: 1, gap: 3 },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  agentName: { fontFamily: 'Inter', fontSize: 15, fontWeight: '600', color: '#FFFFFF' },
  timestamp: { fontFamily: 'Inter', fontSize: 12, color: '#555555' },
  lastMessage: { fontFamily: 'Inter', fontSize: 14, color: '#888888' },
  description: { fontFamily: 'Inter', fontSize: 13, color: '#666666' },
  deleteAction: {
    width: 80, backgroundColor: '#1A1A1A',
    borderLeftWidth: 1, borderLeftColor: '#FF4444',
    alignItems: 'center', justifyContent: 'center',
  },
  deleteText: { fontFamily: 'Inter', fontSize: 13, fontWeight: '600', color: '#FF4444' },
});
```

内联颜色修改：
- `<Search size={16} color="#2D8B2D" />` → `color="#666666"`
- `<Pencil size={20} color="#20C20E" />` → `color="#FFFFFF"`
- `RefreshControl tintColor="#20C20E"` → `tintColor="#FF6B35"`
- `placeholderTextColor="#2D8B2D"` → `placeholderTextColor="#666666"`

- [ ] **Step 2: 验证**

```bash
cd mobile && pnpm typecheck
```

Expected: 无类型错误。

---

## Task 5: Chat 详情页样式（styles.ts + STATUS_BADGE）

**Files:**
- Modify: `mobile/app/chat/styles.ts`
- Modify: `mobile/app/chat/[id].tsx`（仅 STATUS_BADGE 常量及内联颜色）

- [ ] **Step 1: 替换 styles.ts**

```ts
import { StyleSheet } from 'react-native';

export const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0D0D0D' },
  nav: {
    height: 56, backgroundColor: '#0D0D0D',
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', paddingHorizontal: 16,
    borderBottomWidth: 1, borderBottomColor: '#1E1E1E',
  },
  navTitle: { fontFamily: 'Inter', fontSize: 17, fontWeight: '700', color: '#FFFFFF' },
  statusBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 8, backgroundColor: '#1A1A1A',
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusBadgeText: {
    fontFamily: 'Inter', fontSize: 11, fontWeight: '600',
    letterSpacing: 0.5, color: '#FFFFFF',
  },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, gap: 20 },
  inputBar: {
    backgroundColor: '#0D0D0D',
    flexDirection: 'row', alignItems: 'flex-end',
    paddingHorizontal: 16, paddingTop: 8, paddingBottom: 34, gap: 8,
  },
  inputField: {
    flex: 1, minHeight: 52, maxHeight: 120,
    backgroundColor: '#1A1A1A', borderRadius: 26,
    paddingHorizontal: 16, paddingVertical: 14, justifyContent: 'center',
  },
  inputDisabled: { opacity: 0.4 },
  input: { fontFamily: 'Inter', fontSize: 15, color: '#FFFFFF', minHeight: 20 },
  sendStopBtn: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: 'center' as const, justifyContent: 'center' as const,
  },
  sendBtn: { backgroundColor: '#FF6B35' },
  stopBtn: { backgroundColor: '#1A1A1A', borderWidth: 1, borderColor: '#FF4444' },
  previewRow: { backgroundColor: '#0D0D0D', maxHeight: 68 },
  previewRowContent: {
    paddingHorizontal: 16, paddingVertical: 8,
    gap: 8, flexDirection: 'row', alignItems: 'center',
  },
  thumbWrapper: { width: 52, height: 52, borderRadius: 8, overflow: 'hidden', backgroundColor: '#1A1A1A' },
  thumb: { width: 52, height: 52 },
  thumbOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center',
  },
  thumbFailed: { backgroundColor: 'rgba(255,68,68,0.4)' },
  thumbOverlayText: { color: '#FF4444', fontFamily: 'Inter', fontSize: 14 },
  removeBadge: {
    position: 'absolute', top: -4, right: -4,
    width: 18, height: 18, borderRadius: 9,
    backgroundColor: '#1A1A1A', borderWidth: 1, borderColor: '#555555',
    alignItems: 'center', justifyContent: 'center',
  },
  imageBtn: {
    width: 44, height: 44, backgroundColor: '#1A1A1A',
    borderRadius: 22, alignItems: 'center', justifyContent: 'center',
  },
  imageBtnDisabled: { opacity: 0.5 },
  waitText: { fontFamily: 'Inter', fontSize: 11, color: '#888888', letterSpacing: 1 },
});
```

- [ ] **Step 2: 替换 [id].tsx 中的 STATUS_BADGE 常量及内联颜色**

```ts
const STATUS_BADGE: Record<string, { label: string; bg: string; dot: string }> = {
  running:           { label: 'RUNNING',   bg: '#1A1A1A', dot: '#FF6B35' },
  awaiting_question: { label: 'AWAITING',  bg: '#1A1A1A', dot: '#FF6B35' },
  completed:         { label: 'COMPLETED', bg: '#1A1A1A', dot: '#4CAF50' },
  failed:            { label: 'FAILED',    bg: '#1A1A1A', dot: '#FF4444' },
  idle:              { label: 'IDLE',      bg: '#1A1A1A', dot: '#555555' },
};
```

同时修改内联颜色：
- `<ChevronLeft size={24} color="#20C20E" />` → `color="#FFFFFF"`
- `<ImageIcon size={16} color={composerDisabled ? '#2D8B2D' : '#20C20E'} />` → `color={composerDisabled ? '#555555' : '#FFFFFF'}`
- `placeholderTextColor="#2D8B2D"` → `placeholderTextColor="#555555"`
- `badge = isOffline ? { label: 'OFFLINE', bg: '#1A0000', dot: '#FFB000' }` → `{ label: 'OFFLINE', bg: '#1A1A1A', dot: '#FF4444' }`

- [ ] **Step 3: 验证**

```bash
cd mobile && pnpm typecheck
```

Expected: 无类型错误。

---

## Task 6: MessageBubble 消息气泡

**Files:**
- Modify: `mobile/src/features/chat/components/MessageBubble.tsx`

- [ ] **Step 1: 替换 StyleSheet**

```ts
const s = StyleSheet.create({
  userWrap: { width: '100%', alignItems: 'flex-end' },
  aiWrap: { width: '100%', alignItems: 'flex-start' },
  userBubble: {
    maxWidth: 280, backgroundColor: '#FF6B35',
    borderTopLeftRadius: 16, borderTopRightRadius: 4,
    borderBottomLeftRadius: 16, borderBottomRightRadius: 16, padding: 14,
  },
  aiBubble: {
    maxWidth: 280, backgroundColor: '#1A1A1A',
    borderTopLeftRadius: 4, borderTopRightRadius: 16,
    borderBottomLeftRadius: 16, borderBottomRightRadius: 16, padding: 14,
  },
  waitingBubble: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 14, gap: 6, width: 64,
  },
  analyzingText: { fontFamily: 'Inter', fontSize: 11, color: '#888888', letterSpacing: 0.5, marginTop: 4 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#888888' },
  typingBubble: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, width: 64, gap: 6 },
  userText: { fontFamily: 'Inter', fontSize: 15, color: '#FFFFFF', lineHeight: 22 },
  aiText: { fontFamily: 'Inter', fontSize: 15, color: '#FFFFFF', lineHeight: 22 },
  typingText: { color: '#FFFFFF' },
  waitingText: { fontFamily: 'Inter', fontSize: 14, color: '#888888', lineHeight: 20 },
  waitingTextWrap: { overflow: 'hidden', position: 'relative', width: 112 },
  waitingShine: { position: 'absolute', top: 0, bottom: 0, width: 48, overflow: 'hidden' },
  waitingTextHighlight: { color: '#FFFFFF', width: 112 },
  thumbImage: { width: 120, height: 120, borderRadius: 8, marginBottom: 4 },
  attachmentPlaceholder: { fontFamily: 'Inter', fontSize: 12, color: '#FFFFFF', marginBottom: 4 },
  imageCaption: { marginTop: 4 },
  enlargeHint: { fontFamily: 'Inter', fontSize: 10, color: 'rgba(255,255,255,0.6)', marginTop: 4 },
  fullscreenClose: {
    position: 'absolute', top: 56, right: 20,
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: '#1A1A1A', alignItems: 'center', justifyContent: 'center', zIndex: 10,
  },
  previewFilename: { fontFamily: 'Inter', fontSize: 11, color: '#888888', marginTop: 12 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center' },
  previewImage: { width: '100%', height: '80%' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  statusLine: { flex: 1, height: 1 },
  statusText: { fontFamily: 'Inter', fontSize: 11, letterSpacing: 1 },
});
```

内联颜色修改：`<X size={18} color="#20C20E" />` → `color="#FFFFFF"`

- [ ] **Step 2: 验证**

```bash
cd mobile && pnpm typecheck
```

Expected: 无类型错误。

---

## Task 7: AskQuestionCard

**Files:**
- Modify: `mobile/src/features/chat/components/AskQuestionCard.tsx`

- [ ] **Step 1: 替换 StyleSheet**

```ts
const s = StyleSheet.create({
  card: { backgroundColor: '#1A1A1A', borderRadius: 16, width: 320, overflow: 'hidden' },
  header: {
    height: 44, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', paddingHorizontal: 16,
    borderBottomWidth: 1, borderBottomColor: '#1E1E1E',
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headerLabel: { fontFamily: 'Inter', fontSize: 12, fontWeight: '600', color: '#FF6B35' },
  body: { padding: 16, gap: 12 },
  question: { fontFamily: 'Inter', fontSize: 16, fontWeight: '600', color: '#FFFFFF', lineHeight: 22 },
  subtitle: { fontFamily: 'Inter', fontSize: 13, color: '#888888' },
  hint: { fontFamily: 'Inter', fontSize: 13, color: '#666666' },
  optsList: { gap: 8 },
  option: {
    flexDirection: 'row', alignItems: 'center',
    borderRadius: 10, backgroundColor: '#252525',
    paddingHorizontal: 16, paddingVertical: 12, gap: 12,
  },
  optionSelected: { backgroundColor: '#1F2A1F', borderWidth: 1.5, borderColor: '#4CAF50' },
  optionReadonly: { opacity: 0.6 },
  optionLabelMuted: { color: '#666666' },
  radio: { width: 16, height: 16, borderRadius: 8, borderWidth: 1.5, borderColor: '#444444', backgroundColor: '#252525' },
  radioSelected: { borderColor: '#4CAF50', backgroundColor: '#4CAF50' },
  checkbox: {
    width: 16, height: 16, borderRadius: 4, borderWidth: 1.5,
    borderColor: '#444444', backgroundColor: '#252525',
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxSelected: { borderColor: '#4CAF50', backgroundColor: '#4CAF50' },
  checkboxTick: { width: 8, height: 8, backgroundColor: '#FFFFFF', borderRadius: 1 },
  optionLabel: { fontFamily: 'Inter', fontSize: 15, color: '#FFFFFF' },
  customEditor: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  customInput: { flex: 1, fontFamily: 'Inter', fontSize: 14, color: '#FFFFFF', paddingVertical: 0 },
  useAnswerBtn: {
    height: 28, borderRadius: 6, backgroundColor: '#FF6B35',
    paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center',
  },
  useAnswerBtnOff: { opacity: 0.4 },
  useAnswerText: { fontFamily: 'Inter', fontSize: 12, fontWeight: '600', color: '#FFFFFF' },
  actions: {
    flexDirection: 'row', gap: 12, justifyContent: 'flex-end',
    paddingTop: 8, borderTopWidth: 1, borderTopColor: '#1E1E1E',
  },
  cancelBtn: {
    borderRadius: 8, backgroundColor: '#252525',
    paddingHorizontal: 20, paddingVertical: 10,
    alignItems: 'center', justifyContent: 'center',
  },
  cancelText: { fontFamily: 'Inter', fontSize: 14, color: '#888888' },
  confirmBtn: {
    borderRadius: 8, backgroundColor: '#FF6B35',
    paddingHorizontal: 20, paddingVertical: 10,
    alignItems: 'center', justifyContent: 'center',
  },
  confirmBtnDisabled: { opacity: 0.4 },
  confirmText: { fontFamily: 'Inter', fontSize: 14, fontWeight: '600', color: '#FFFFFF' },
});
```

内联颜色修改：
- `<Bot size={16} color="#20C20E" />` → `color="#FF6B35"`
- `<Info size={16} color="#2D8B2D" />` → `color="#555555"`
- `placeholderTextColor="#0F6B0F"` → `placeholderTextColor="#555555"`

- [ ] **Step 2: 验证**

```bash
cd mobile && pnpm typecheck
```

Expected: 无类型错误。

---

## Task 8: MultiAskQuestionCard

**Files:**
- Modify: `mobile/src/features/chat/components/MultiAskQuestionCard.tsx`

- [ ] **Step 1: 替换 StyleSheet**

```ts
const s = StyleSheet.create({
  card: {
    backgroundColor: '#1A1A1A', borderRadius: 16,
    borderWidth: 1, borderColor: '#FF6B35', width: 320, overflow: 'hidden',
  },
  header: {
    height: 44, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', paddingHorizontal: 16,
    borderBottomWidth: 1, borderBottomColor: '#1E1E1E',
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerLabel: { fontFamily: 'Inter', fontSize: 12, fontWeight: '600', color: '#FF6B35' },
  progress: { fontFamily: 'Inter', fontSize: 12, color: '#666666' },
  progressBarBg: { height: 3, backgroundColor: '#252525' },
  progressBarFill: { height: 3, backgroundColor: '#FF6B35' },
  body: {},
  section: { paddingVertical: 4 },
  sectionBorder: { borderBottomWidth: 1, borderBottomColor: '#1E1E1E' },
  qHeader: { flexDirection: 'row', alignItems: 'center', height: 40, paddingHorizontal: 14, gap: 8 },
  qText: { fontFamily: 'Inter', fontSize: 14, fontWeight: '600', color: '#FFFFFF', flex: 1 },
  opts: { paddingHorizontal: 14, paddingBottom: 12, paddingTop: 8, gap: 6 },
  opt: {
    flexDirection: 'row', alignItems: 'center',
    height: 40, borderRadius: 8, backgroundColor: '#252525',
    paddingHorizontal: 12, gap: 10,
  },
  optSelected: { borderWidth: 1, borderColor: '#4CAF50', backgroundColor: '#1F2A1F' },
  radio: { width: 16, height: 16, borderRadius: 8, borderWidth: 1.5, borderColor: '#555555', backgroundColor: '#252525' },
  radioSelected: { borderColor: '#4CAF50', backgroundColor: '#4CAF50' },
  optLabel: { fontFamily: 'Inter', fontSize: 14, color: '#CCCCCC' },
  customEditor: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  customInput: { flex: 1, fontFamily: 'Inter', fontSize: 13, color: '#FFFFFF', paddingVertical: 0 },
  useAnswerBtn: {
    height: 26, borderRadius: 6, backgroundColor: '#FF6B35',
    paddingHorizontal: 9, alignItems: 'center', justifyContent: 'center',
  },
  useAnswerBtnOff: { opacity: 0.4 },
  useAnswerText: { fontFamily: 'Inter', fontSize: 11, fontWeight: '600', color: '#FFFFFF' },
  editBtn: {
    marginLeft: 'auto', height: 26, borderRadius: 6,
    borderWidth: 1, borderColor: '#555555',
    paddingHorizontal: 9, alignItems: 'center', justifyContent: 'center',
  },
  editText: { fontFamily: 'Inter', fontSize: 11, fontWeight: '600', color: '#888888' },
  actions: {
    flexDirection: 'row', gap: 10,
    paddingHorizontal: 14, paddingVertical: 12,
    borderTopWidth: 1, borderTopColor: '#1E1E1E',
  },
  cancelBtn: {
    flex: 1, height: 44, borderRadius: 12,
    backgroundColor: '#252525', borderWidth: 1, borderColor: '#333333',
    alignItems: 'center', justifyContent: 'center',
  },
  cancelText: { fontFamily: 'Inter', fontSize: 15, fontWeight: '500', color: '#888888' },
  confirmBtn: { flex: 1, height: 44, borderRadius: 12, backgroundColor: '#FF6B35', alignItems: 'center', justifyContent: 'center' },
  confirmBtnDisabled: { opacity: 0.4 },
  confirmText: { fontFamily: 'Inter', fontSize: 15, fontWeight: '600', color: '#FFFFFF' },
});
```

内联颜色修改：
- `<Bot size={16} color="#20C20E" />` → `color="#FF6B35"`（header 中）
- `<Bot size={14} color="#20C20E" />` → `color="#FF6B35"`（qHeader 中）
- `<Info size={16} color="#2D8B2D" />` → `color="#555555"`
- `placeholderTextColor="#0F6B0F"` → `placeholderTextColor="#555555"`

- [ ] **Step 2: 验证**

```bash
cd mobile && pnpm typecheck
```

Expected: 无类型错误。

---

## Task 9: InboxScreen

**Files:**
- Modify: `mobile/src/features/inbox/components/InboxScreen.tsx`

- [ ] **Step 1: 替换 StyleSheet**

```ts
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0D0D0D' },
  header: {
    backgroundColor: '#0D0D0D',
    paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8, gap: 4,
  },
  headerTitle: { fontFamily: 'Inter', fontSize: 28, fontWeight: '700', color: '#FFFFFF' },
  headerSub: { fontFamily: 'Inter', fontSize: 14 },
  list: { padding: 0, gap: 0 },
  rowWrap: { gap: 0 },
  row: {
    flexDirection: 'column', backgroundColor: '#0D0D0D',
    borderBottomWidth: 1, borderBottomColor: '#1E1E1E',
  },
  rowInner: { padding: 16, gap: 10 },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowTopLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  agentName: { fontFamily: 'Inter', fontSize: 13, fontWeight: '600', color: '#FFFFFF' },
  timeText: { fontFamily: 'Inter', fontSize: 12, color: '#555555' },
  agentIcon: {},
  questionText: { fontFamily: 'Inter', fontSize: 15, color: '#DDDDDD', lineHeight: 21 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    alignSelf: 'flex-start', borderRadius: 6,
    backgroundColor: '#1A1A1A', paddingHorizontal: 8, paddingVertical: 4,
  },
  chipText: { fontFamily: 'Inter', fontSize: 12, color: '#888888' },
  actionRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  dismissBtn: { paddingHorizontal: 8, paddingVertical: 4 },
  dismissText: { fontFamily: 'Inter', fontSize: 13, color: '#666666' },
  answerBtn: { paddingHorizontal: 8, paddingVertical: 4 },
  answerText: { fontFamily: 'Inter', fontSize: 13, fontWeight: '600', color: '#FF6B35' },
  tapHint: { fontFamily: 'Inter', fontSize: 11, color: '#555555', letterSpacing: 0.5 },
  askWrap: { paddingHorizontal: 16, paddingBottom: 16 },
  emptyBody: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  emptyIconWrap: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: '#1A1A1A', alignItems: 'center', justifyContent: 'center',
  },
  emptyTitle: { fontFamily: 'Inter', fontSize: 22, fontWeight: '700', color: '#FFFFFF' },
  emptyDesc: { fontFamily: 'Inter', fontSize: 15, color: '#888888', textAlign: 'center', maxWidth: 260 },
  infoBox: {},
  infoRow: {
    flexDirection: 'row', gap: 8, alignItems: 'center',
    borderRadius: 12, backgroundColor: '#1A1A1A', paddingHorizontal: 16, paddingVertical: 10,
  },
  infoText: { fontFamily: 'Inter', fontSize: 12, color: '#555555', flex: 1 },
  deleteBtn: {
    width: 72, justifyContent: 'center', alignItems: 'center',
    backgroundColor: '#1A1A1A',
  },
  deleteBtnText: { fontFamily: 'Inter', fontSize: 12, fontWeight: '600', color: '#FF4444', letterSpacing: 0.5 },
});
```

同时修改 JSX 中的内联颜色：
- `<CircleCheck size={36} color="#33FF33" />` → `color="#4CAF50"`
- `<Info size={14} color="#2D8B2D" />` → `color="#555555"`
- `RefreshControl tintColor="#20C20E"` → `tintColor="#FF6B35"`
- `unreadCount > 0 ? '#FFB000' : '#2D8B2D'` → `unreadCount > 0 ? '#FF6B35' : '#888888'`
- `unreadBar backgroundColor: unread ? '#20C20E' : 'transparent'` → `unread ? '#FF6B35' : 'transparent'`

注意：InboxScreen 的 JSX 结构需要配合新 StyleSheet 调整——原来的 `unreadBar` 竖条设计可以保留（改颜色即可），或者按 Pencil 设计改为卡片式布局。**本任务只改颜色，不改结构。**

- [ ] **Step 2: 验证**

```bash
cd mobile && pnpm typecheck
```

Expected: 无类型错误。

---

## Task 10: Settings 页

**Files:**
- Modify: `mobile/app/(tabs)/settings.tsx`

- [ ] **Step 1: 替换 StyleSheet**

```ts
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0D0D0D' },
  nav: {
    height: 52, backgroundColor: '#0D0D0D',
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', paddingHorizontal: 16,
    borderBottomWidth: 1, borderBottomColor: '#1E1E1E',
  },
  navTitle: { fontFamily: 'Inter', fontSize: 17, fontWeight: '700', color: '#FFFFFF' },
  scroll: { flex: 1 },
  content: { padding: 16, gap: 12 },
  sectionLabel: { fontFamily: 'Inter', fontSize: 11, fontWeight: '600', color: '#666666', letterSpacing: 1.5 },
});
```

内联颜色修改：`<Plus size={20} color="#20C20E" />` → `color="#FFFFFF"`

- [ ] **Step 2: 验证**

```bash
cd mobile && pnpm typecheck
```

Expected: 无类型错误。

---

## Task 11: EndpointList 组件

**Files:**
- Modify: `mobile/src/features/settings/components/EndpointList.tsx`

- [ ] **Step 1: 替换 StyleSheet**

```ts
const s = StyleSheet.create({
  empty: { paddingVertical: 24, alignItems: 'center' },
  emptyText: { fontFamily: 'Inter', fontSize: 13, color: '#888888', letterSpacing: 1 },
  list: { gap: 8 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#1A1A1A', borderRadius: 12, padding: 14,
  },
  dot: { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  info: { flex: 1, gap: 3 },
  label: { fontFamily: 'Inter', fontSize: 14, fontWeight: '600', color: '#FFFFFF' },
  url: { fontFamily: 'Inter', fontSize: 12, color: '#888888' },
});
```

内联颜色修改：
- `online ? '#33FF33' : '#2D8B2D'` → `online ? '#4CAF50' : '#555555'`
- `<Trash2 size={16} color="#2D8B2D" />` → `color="#888888"`

- [ ] **Step 2: 验证**

```bash
cd mobile && pnpm typecheck
```

Expected: 无类型错误。

---

## Task 12: AddEndpointModal

**Files:**
- Modify: `mobile/src/features/settings/components/AddEndpointModal.tsx`

- [ ] **Step 1: 替换 StyleSheet**

```ts
const s = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.8)',
    alignItems: 'center', justifyContent: 'center', padding: 24,
  },
  card: {
    width: '100%', backgroundColor: '#1A1A1A',
    borderRadius: 16, padding: 20, gap: 12,
  },
  heading: { fontFamily: 'Inter', fontSize: 17, fontWeight: '700', color: '#FFFFFF', marginBottom: 4 },
  tabs: { flexDirection: 'row', gap: 8, marginBottom: 4 },
  tab: {
    flex: 1, height: 36, alignItems: 'center', justifyContent: 'center',
    borderRadius: 8, backgroundColor: '#252525',
  },
  tabActive: { backgroundColor: '#FF6B35' },
  tabText: { fontFamily: 'Inter', fontSize: 13, color: '#888888' },
  tabTextActive: { color: '#FFFFFF', fontWeight: '600' },
  fieldLabel: { fontFamily: 'Inter', fontSize: 12, fontWeight: '600', color: '#888888', letterSpacing: 0.5 },
  input: {
    height: 44, backgroundColor: '#252525', borderRadius: 8,
    paddingHorizontal: 14, fontFamily: 'Inter', fontSize: 15, color: '#FFFFFF',
  },
  errText: { fontFamily: 'Inter', fontSize: 12, color: '#FF4444' },
  actions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  btnPrimary: {
    flex: 1, height: 44, backgroundColor: '#FF6B35',
    alignItems: 'center', justifyContent: 'center', borderRadius: 10,
  },
  btnPrimaryText: { fontFamily: 'Inter', fontSize: 15, fontWeight: '600', color: '#FFFFFF' },
  btnSecondary: {
    flex: 1, height: 44, backgroundColor: '#252525',
    alignItems: 'center', justifyContent: 'center', borderRadius: 10,
  },
  btnSecondaryText: { fontFamily: 'Inter', fontSize: 15, color: '#888888' },
  cameraWrap: { gap: 10 },
  camera: { width: '100%', height: 220, borderRadius: 10 },
  permBtn: {
    height: 220, backgroundColor: '#252525', borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
  },
  permText: { fontFamily: 'Inter', fontSize: 13, color: '#888888' },
});
```

内联颜色修改：
- `placeholderTextColor="#2D8B2D"` → `placeholderTextColor="#555555"`（所有 TextInput）
- `<ActivityIndicator size="small" color="#040D04" />` → `color="#FFFFFF"`

- [ ] **Step 2: 验证**

```bash
cd mobile && pnpm typecheck
```

Expected: 无类型错误。

---

## Task 13: 全量验证

**Files:** 无新增文件

- [ ] **Step 1: TypeScript 全量检查**

```bash
cd mobile && pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 2: 单元测试**

```bash
cd mobile && pnpm test -- --watchAll=false
```

Expected: 所有测试通过（样式变更不影响逻辑测试）。

- [ ] **Step 3: 颜色合规检查**

```bash
bash scripts/check-mobile-colors.sh
```

Expected: 无违规颜色（旧绿色系已全部替换）。

- [ ] **Step 4: Commit**

```bash
cd /Users/alan/Documents/codes/yakami0129/multisoul
git add mobile/app/(tabs)/_layout.tsx \
  mobile/src/features/agents/components/AgentList.tsx \
  mobile/src/features/agents/components/AgentCard.tsx \
  mobile/src/features/chat/components/ChatHomeScreen.tsx \
  mobile/app/chat/styles.ts \
  mobile/app/chat/[id].tsx \
  mobile/src/features/chat/components/MessageBubble.tsx \
  mobile/src/features/chat/components/AskQuestionCard.tsx \
  mobile/src/features/chat/components/MultiAskQuestionCard.tsx \
  mobile/src/features/inbox/components/InboxScreen.tsx \
  mobile/app/(tabs)/settings.tsx \
  mobile/src/features/settings/components/EndpointList.tsx \
  mobile/src/features/settings/components/AddEndpointModal.tsx
git commit -m "feat(mobile): migrate UI to Pencil design system (dark + orange)"
```

