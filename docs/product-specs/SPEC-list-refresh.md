# Chat & Inbox 列表刷新 SPEC

## 1. 背景与目标

Chat 列表和 Inbox 列表目前缺少「打开页面自动刷新」和「下拉刷新」能力，导致用户切换 tab 或从子页面返回后看到的是旧数据。本次补齐这两个交互，提升数据及时性。

## 2. 范围

### 2.1 In Scope
- Chat 列表：focus 刷新 + 下拉刷新
- Inbox 列表：focus 刷新（重读本地 DB）+ 下拉刷新（重读本地 DB）

### 2.2 Out of Scope
- Inbox 远程 HTTP 拉取（后端暂无接口）
- Inbox 实时推送机制（已有 WebSocket，不变）
- Chat 列表轮询间隔调整（保持 30s 不变）

## 3. 业务流程

### Chat 列表刷新流程
1. 用户切到 Chat tab（或从子页面返回）→ `useFocusEffect` 触发 `refetch`
2. 用户下拉列表 → `refreshing=true`，触发 `refetch`
3. 请求完成 → `refreshing=false`，列表更新

### Inbox 列表刷新流程
1. 用户切到 Inbox tab（或从子页面返回）→ `useFocusEffect` 触发 `loadInboxItems()` 重读 SQLite
2. 用户下拉列表 → `refreshing=true`，触发 `loadInboxItems()`
3. 读取完成 → 同步到 Zustand store，`refreshing=false`，列表更新

## 4. 技术实现

### Chat（`mobile/app/(tabs)/chat.tsx`）
- 从 `useQuery` 返回值中取 `refetch` 和 `isFetching`
- 用 `useFocusEffect(useCallback(() => { refetch() }, [refetch]))` 触发 focus 刷新
- 将 `isFetching` 和 `refetch` 传给 `ChatHomeScreen`

### ChatHomeScreen（`mobile/src/features/chat/components/ChatHomeScreen.tsx`）
- Props 新增 `isRefreshing: boolean` 和 `onRefresh: () => void`
- `FlatList` 加 `refreshing={isRefreshing}` 和 `onRefresh={onRefresh}`
- `RefreshControl` 用 `tintColor="#20C20E"`

### Inbox（`mobile/app/(tabs)/inbox.tsx`）
- 新增本地 `refreshing` state
- `useFocusEffect` 触发 `loadInboxItems()` → `setItems()`
- 下拉时同样调用 `loadInboxItems()`

### InboxScreen（`mobile/src/features/inbox/components/InboxScreen.tsx`）
- Props 新增 `isRefreshing: boolean` 和 `onRefresh: () => void`
- `FlatList` 加 `refreshing` / `onRefresh` / `tintColor="#20C20E"`

## 5. 状态与边界情况

| 场景 | 处理 |
|------|------|
| 网络请求失败（Chat） | `useQuery` 已有错误处理，`isFetching` 恢复 false，不崩溃 |
| DB 读取失败（Inbox） | try/catch，`refreshing` 恢复 false，store 不变 |
| 快速连续下拉 | `isFetching` 为 true 时不重复发请求（React Query 自动去重） |
| 空列表下拉 | 正常触发，显示 spinner 后恢复 |

## 6. UI/UX

- `RefreshControl` `tintColor="#20C20E"`（PIP-BOY 绿）
- 无额外 loading 状态文字，保持现有极简风格

## 7. 验收标准

- [ ] 切到 Chat tab，网络请求被触发（可在 network 面板观察）
- [ ] Chat 列表下拉，spinner 出现（绿色），松手后列表刷新
- [ ] 切到 Inbox tab，`loadInboxItems` 被调用
- [ ] Inbox 列表下拉，spinner 出现（绿色），松手后列表刷新
- [ ] 网络断开时 Chat 下拉不崩溃
- [ ] DB 读取失败时 Inbox 下拉不崩溃
