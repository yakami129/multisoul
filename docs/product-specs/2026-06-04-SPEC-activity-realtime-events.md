# Activity Realtime Events SPEC

## 1. 背景与目标

Activity 已经改为 DB-backed 全局索引：mobile 请求每个 configured endpoint 的 `/api/v1/activity`，由 CLI 从本机 SQLite 派生 `Needs Attention`、`Running`、`Done` 三段列表。该方案解决了 Activity 对 mobile 本地 `inbox` / `chatStore` 内存态的依赖，但当前列表更新仍主要依赖 Activity 页面可见时的 15 秒轮询。

用户希望 Activity 状态更实时，尤其是：

- Agent 进入 `awaiting_question` 后，Activity 尽快出现 Pending
- 用户回答问题后，Activity 尽快移除 Pending
- Agent 完成或失败后，Activity 尽快从 Running 转到 Done / Failed
- Abort、Delete、Read state 等本地操作后，Activity 尽快反映最新状态

本规格目标是在不引入中心后端、不复制 Activity 派生逻辑、不做后台常驻连接的前提下，为 Activity 增加轻量事件监听：事件只作为刷新信号，REST 快照继续作为权威数据。

## 2. 已确认决策

以下决策来自 2026-06-04 的问答卡片：

- 优先实时性：Activity 状态实时
- 改动范围：中等演进可扩展
- 连接生命周期：仅 Activity 页面可见时保持连接
- 事件粒度：只推刷新信号，不推完整列表或单行 delta
- 兜底策略：保留低频兜底轮询

## 3. 范围

### In Scope

- CLI 新增 Activity 事件通道，用于通知 mobile 某个 endpoint 的 Activity 快照需要刷新
- Activity 页面可见且 App 前台时，mobile 为每个 configured endpoint 建立事件监听
- Activity 页面失焦、卸载或 App 进入后台时，mobile 关闭事件监听
- 收到 Activity 事件后，mobile debounce 刷新当前 endpoint 的 Activity 第一屏快照
- Socket open / reconnect 后刷新第一屏快照，补齐断线期间状态变化
- 保留低频轮询兜底，替代当前高频 15 秒轮询
- REST `/api/v1/activity` 继续作为 Activity 列表权威数据源
- 覆盖影响 Activity 分段或可见性的主要 CLI 写路径

### Out of Scope

- 后台常驻 Activity WebSocket
- Push notification 策略重做
- 中心云端 Activity 服务
- 持久化 event log 或 cursor API
- Activity item delta 合并
- WebSocket 直接推完整 Activity 列表
- Activity 详情页
- Activity 内直接回答决策
- Chat timeline 消息渲染重写

## 4. 产品语义

### 4.1 权威数据仍是 REST 快照

Activity 事件不承载可展示列表数据。Mobile 收到事件后应重新拉取 `/api/v1/activity`，并用后端返回的快照更新 UI。

这样可以保证：

- `Needs Attention` 仍由 `messages`、`ask_answers` 和 `conversations.status` 统一判定
- `Running` / `Done` 仍以后端 DB 中的 conversation 状态为准
- workflow metadata、read state、failed endpoint fallback 等现有逻辑不需要复制到事件层
- 断线重连后可以用快照恢复正确状态

### 4.2 事件只是刷新信号

事件建议使用如下语义：

```json
{
  "type": "activity_changed",
  "conversation_id": "conv-123",
  "reason": "awaiting_question",
  "timestamp": 1760000000000
}
```

字段语义：

- `type`：固定为 `activity_changed`
- `conversation_id`：发生变化的 conversation；若是 endpoint 级变化可为空或省略
- `reason`：变化原因，用于日志、测试和后续优化；mobile MVP 不依赖 reason 做业务分支
- `timestamp`：事件产生时间，毫秒时间戳

推荐首批 reason：

| Reason | 触发语义 |
|--------|----------|
| `conversation_created` | 新 conversation 创建 |
| `user_message` | 用户消息使 conversation 进入 Running |
| `awaiting_question` | runtime 或 `msctl ask-question` 产生待回答问题 |
| `answer_accepted` | 用户回答成功，pending 状态解除 |
| `task_terminal` | runtime 完成或失败 |
| `aborted` | conversation 被 abort 后退出 Running |
| `deleted` | conversation 被删除 |
| `read_state_changed` | Done item 已读状态变化 |
| `workflow_changed` | workflow run 影响 Activity 可见状态 |

### 4.3 连接生命周期

Activity 事件监听只在用户正在看 Activity 时运行：

1. Activity tab 获得焦点
2. App state 为 active
3. 至少存在一个 configured endpoint
4. Mobile 为每个 endpoint 建立 Activity 事件连接
5. Activity tab 失焦、组件卸载、endpoint 移除或 App 进入后台时关闭连接

本功能不要求用户在其它 tab 时也实时更新 Activity badge 或缓存。若用户离开 Activity 后再回来，页面应通过首屏快照刷新恢复最新状态。

### 4.4 刷新策略

Activity 页面刷新来源按优先级分为：

1. 首次进入或重新获得焦点：刷新第一屏快照
2. Activity event socket open / reconnect：刷新第一屏快照
3. 收到 `activity_changed`：debounce 后刷新第一屏快照
4. 用户下拉刷新：刷新第一屏快照，并保留现有分页语义
5. 低频兜底轮询：Activity 可见时周期性刷新第一屏快照

低频兜底默认建议为 60 秒。若后续实测耗电或请求压力仍偏高，可调整为 120 秒；不得继续依赖 15 秒轮询作为主要实时来源。

Debounce 应避免事件风暴导致重复请求。连续多个事件在短窗口内到达时，mobile 应合并为一次快照刷新。

## 5. 用户场景

### 5.1 Agent 请求用户决策

1. 用户在 Chat 发起任务后离开 Chat，进入 Activity
2. Agent 运行中发出问题
3. CLI 将 conversation 置为 `awaiting_question`
4. CLI 发送 `activity_changed(reason=awaiting_question)`
5. Activity 页面收到事件并刷新快照
6. `Needs Attention` 在短时间内出现对应 Pending item
7. 用户点击 item 进入 Chat 并定位到问题卡片

### 5.2 用户回答决策后返回 Activity

1. 用户从 Activity 进入 Chat 并回答问题
2. CLI 接受 answer，写入 `ask_answers`，conversation 回到 `running`
3. CLI 发送 `activity_changed(reason=answer_accepted)`
4. 用户返回 Activity 或 Activity 仍可见时，列表刷新
5. 原 Pending item 不再出现在 `Needs Attention`

### 5.3 Agent 完成或失败

1. Activity 显示某个 conversation 为 Running
2. Agent 完成或失败
3. CLI 更新 conversation status，并插入 `task_status`
4. CLI 发送 `activity_changed(reason=task_terminal)`
5. Activity 刷新后 Running item 移除，Done / Failed item 出现在 Done

### 5.4 Socket 断线后恢复

1. Activity 页面可见，事件 socket 临时断开
2. 断线期间 CLI 状态发生变化
3. Mobile 自动重连事件 socket
4. Socket open 后立即刷新第一屏快照
5. Activity 恢复为后端 DB 的最新状态

### 5.5 事件未送达

1. Activity 页面可见，但某次事件未送达或 socket 长时间不可用
2. 低频兜底轮询触发
3. Mobile 重新拉取 `/api/v1/activity`
4. Activity 最终收敛到正确状态

## 6. CLI 事件覆盖范围

CLI 中所有会影响 Activity 分段、排序或可见性的写路径都应发送 Activity 变化事件。

首批必须覆盖：

- 创建 conversation
- 用户发消息，conversation 进入 `running`
- 插入 `ask_question`，conversation 进入 `awaiting_question`
- answer 成功交付并持久化，conversation 回到 `running`
- runtime 写入 terminal `task_status`，conversation 进入 `completed` 或 `failed`
- abort conversation，conversation 退出 `running`
- delete conversation，Activity item 消失
- mark done read / mark all done read，Done read state 变化
- workflow run 创建、完成、失败或跳过时影响 Activity 可见状态

若某个写路径暂时无法精确定位到 conversation，允许发送 endpoint 级刷新事件，但 mobile 仍只做快照刷新，不做业务分支。

## 7. Mobile 行为要求

### 7.1 多 endpoint 监听

Activity 页面应基于当前 configured endpoints 建立多个独立事件连接。

- 单个 endpoint 事件 socket 失败，不影响其它 endpoint 的 Activity 展示和监听
- endpoint 配置变化后，应关闭旧 endpoint 连接并建立新连接
- endpoint token 或 base URL 变化后，应重新连接
- 所有 endpoint 都不可用时，沿用当前 Activity 全局错误态和 Retry 入口

### 7.2 刷新第一屏而非重置全部分页

收到事件后，应优先刷新第一屏 Activity 快照。若用户已经加载了更多历史 Done item，事件刷新不应无故丢失当前分页上下文，除非现有 pagination helper 的一致性要求必须重建第一页。

具体分页合并策略可在执行计划中细化，但用户体验目标是：

- 新 Pending / Running / Done 状态尽快可见
- 用户正在浏览的已加载内容不应因频繁事件产生明显跳动
- 下拉刷新仍可以显式重置和重新请求第一页

### 7.3 状态与错误体验

Activity event socket 不应引入新的主界面错误噪音。

- 事件 socket 断开时，可静默重连
- REST 快照失败仍按现有 failed endpoint 体验展示
- 事件 socket 连不上时，不应把 endpoint 标记为 Activity 数据失败；低频轮询仍可工作
- 开发日志可记录 socket 状态，但 mobile 不得新增 `console.log`

## 8. 性能与资源约束

- Activity 可见时每个 endpoint 最多一个 Activity event socket
- Activity 失焦或 App 后台时不得保持事件连接
- 收到事件后的刷新必须 debounce，避免 runtime 高频工具事件造成请求堆积
- 若一次 Activity refetch 尚未完成，不应启动无限重叠请求
- 低频兜底轮询默认不低于 60 秒
- 事件 payload 应保持小体积，不包含完整 messages、tool output 或 Activity 列表

## 9. 验收标准

### 9.1 功能验收

- [ ] CLI 提供受 Bearer auth 保护的 Activity 事件通道
- [ ] 未授权访问 Activity 事件通道会被拒绝
- [ ] Activity 页面可见且 App active 时，mobile 为 configured endpoints 建立事件连接
- [ ] Activity 页面失焦、卸载或 App 进入后台时，mobile 关闭事件连接
- [ ] Socket open 后会刷新 Activity 第一屏快照
- [ ] Socket reconnect 后会刷新 Activity 第一屏快照
- [ ] 收到 `activity_changed` 后会 debounce 刷新 Activity 第一屏快照
- [ ] 用户发消息后，Activity 能及时看到 Running 状态
- [ ] Agent 发出 ask question 后，Activity 能及时看到 Pending 状态
- [ ] 用户回答成功后，Activity 能及时移除对应 Pending item
- [ ] Agent completed / failed 后，Activity 能及时转入 Done / Failed
- [ ] Abort 后，Activity 能及时移除或更新 Running item
- [ ] Delete 后，Activity 能及时移除对应 item
- [ ] Mark Done read / read all 后，Activity Done unread 状态能及时更新
- [ ] 事件 socket 不可用时，低频轮询仍能让 Activity 最终收敛到正确状态

### 9.2 非目标验收

- [ ] Activity event payload 不包含完整 Activity 列表
- [ ] Mobile 不基于 event payload 拼装 Activity item delta
- [ ] Activity 失焦或 App 后台时不保持 Activity event socket
- [ ] 不新增中心后端服务
- [ ] 不新增持久化 events 表作为本阶段必需依赖
- [ ] 不把 15 秒轮询作为主要实时机制保留

### 9.3 质量验收

- [ ] CLI 事件发送 helper 覆盖主要 Activity 写路径，避免零散重复代码
- [ ] CLI 测试覆盖至少一种 Activity 事件广播和未授权拒绝
- [ ] Mobile 测试覆盖可见时连接、失焦/后台关闭、收到事件刷新、重连刷新
- [ ] Mobile 测试覆盖事件 debounce，避免连续事件触发多次重复 refetch
- [ ] Mobile 测试覆盖 socket 失败不影响 REST Activity 展示
- [ ] 不新增硬编码 token 或 Bearer 样例泄漏
- [ ] 不新增 `console.log`
- [ ] 不使用 `#[allow(...)]`、`// eslint-disable`、`@ts-ignore` 或其它诊断压制作为实现手段
- [ ] 不让 `mobile/src|app`、`cli/src` 下单文件超过 500 行
- [ ] 修改 mobile 后执行 `cd mobile && pnpm typecheck`
- [ ] 修改 mobile 测试后执行 `cd mobile && pnpm test -- --watchAll=false`
- [ ] 修改 CLI 后执行 `cd cli && cargo test`
- [ ] 修改 CLI 编译面后执行 `cd cli && cargo build`

## 10. 与现有规格的关系

本规格是 [`SPEC-ui-activity-db-backed.md`](SPEC-ui-activity-db-backed.md) 的第二阶段增强。

前一阶段明确选择：

- Activity 由 CLI DB 派生
- Mobile 聚合多个 endpoint
- Activity 前台可见时轮询刷新
- 不做全局 Activity WebSocket

本阶段保留 DB-backed 权威模型，只把“可见时轮询”升级为“可见时事件驱动刷新 + 低频轮询兜底”。本规格不改变 [`SPEC-ui-activity-routing.md`](SPEC-ui-activity-routing.md) 定义的 Activity 信息架构：Activity 仍是全局索引，不替代 Chat timeline。

## 11. 后续可选演进

以下能力不属于本阶段，但本阶段设计应避免阻塞：

- App 前台全局 Activity badge 实时更新
- 持久化 event log + cursor，用于离线补偿
- endpoint 级事件批处理或压缩
- 对特定 reason 做更细粒度的 query invalidation
- Workflow list / detail 复用同一事件通道做实时刷新
- Settings 中展示 endpoint event socket 健康状态
