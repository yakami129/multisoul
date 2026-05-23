# DB-backed Activity Aggregation SPEC

## 1. 背景与目标

当前 `Activity` 页面由 mobile 端把本地 `inbox`、`chatStore.conversations` 和已加载的 chat messages 拼成全局索引。这会导致 Activity 数据依赖用户此前是否打开过某个 Project 或 Chat，`Running` / `Done` 状态也可能停留在 Zustand 内存旧值。

MultiSoul 没有中心云后端。每个 `msctl serve` endpoint 都拥有自己的本机 SQLite DB。因此新的 Activity 数据权威为：

- CLI 后端负责提供单 endpoint 的权威 Activity 查询
- Mobile 负责并发请求所有已配置 endpoint，并在本机合并排序
- Activity 页面不再以 mobile 本地 `inbox` 或 `chatStore` 作为权威数据源

目标：

- Activity 从 CLI 后端 DB 派生加载，避免内存态造成的缺项和陈旧状态
- 单 endpoint 内由后端统一判定 `Needs Attention` / `Running` / `Done`
- 多 endpoint 由 mobile 聚合为一个全局 Activity 列表
- 打开 Activity、获得焦点、下拉刷新或前台轮询时拉取最新数据
- 保持 Activity 作为全局索引，不替代 Chat timeline

## 2. 范围

### In Scope

- 新增 CLI Activity 查询接口：`GET /api/v1/activity?limit_per_section=50`
- Activity item 从 CLI SQLite 的 `conversations`、`messages` 和 ask answer 持久状态派生
- CLI 后端持久化 ask answer 状态，作为 pending decision 是否仍需处理的权威事实
- CLI 后端支持 `awaiting_question` 状态语义
- Mobile Activity 页面进入前台、获得焦点、下拉刷新或轮询 tick 时请求所有已配置 endpoints
- Mobile 将每个 endpoint 返回的 item 注入 `endpoint_id`、`endpoint_label` 后合并排序
- Activity item 点击后仍进入对应 Chat Detail；pending decision 仍带 `focus_ask_id`
- 旧 mobile `inbox` 仅保留通知兼容，不再作为 Activity 权威来源

### Out of Scope

- 中心云端 Activity 服务
- 跨设备同步多个手机本地状态
- 新增独立 `activity` 物化表
- Activity 详情页
- Activity 内直接回答决策
- 全局 Activity WebSocket 实时推送
- 后台轮询
- Chat timeline 消息渲染重写

## 3. 数据权威

Activity 不新增独立 `activity` 表。后端接口按请求从现有 DB 派生：

| Section | 权威来源 | 判定规则 |
|---------|----------|----------|
| `Needs Attention` | `messages.role = 'ask_question'` + 后端 ask answer 状态 + conversation 状态 | 有未回答 ask，且 conversation 当前为 `awaiting_question` |
| `Running` | `conversations.status` | `status = 'running'` |
| `Done` | `conversations.status` + 最近消息摘要 | `status IN ('completed', 'failed')` |

`Needs Attention` 不显示 `completed` / `failed` conversation 下的历史未回答 ask，避免过期问题永久挂在 Activity。

推荐新增后端 DB 表或等价结构：

```sql
ask_answers(
  ask_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  answered_at INTEGER NOT NULL,
  choice_id TEXT,
  choice_ids TEXT,
  freeform TEXT,
  PRIMARY KEY (conversation_id, ask_id)
)
```

## 4. 状态流转

CLI 后端必须维护以下 conversation 状态流转：

1. 用户发送消息后，conversation 进入 `running`
2. Runtime 发出 `ask_question` 后，CLI 插入消息，并将 conversation 更新为 `awaiting_question`
3. 用户提交 answer 后，CLI 确认 answer 已成功交给等待中的 runtime session
4. answer 被接受后，CLI 持久化 `ask_answers`，并将 conversation 更新为 `running`
5. Runtime 完成后，conversation 更新为 `completed` 或 `failed`

若 answer 无法交给等待中的 runtime session：

- CLI 不应把该 ask 标记为已回答
- Activity 刷新后该 pending item 仍应保留
- Mobile 应能收到失败反馈，避免用户误以为已处理

## 5. API 形态

```txt
GET /api/v1/activity?limit_per_section=50
Authorization: Bearer <token>
```

`limit_per_section` 表示单 endpoint 内每个 section 最多返回 N 条，而不是三个 section 共用 N 条。这样大量 `Done` 不会挤掉 `Needs Attention`。

返回结构建议：

```json
{
  "items": [
    {
      "id": "attention:conv-1:ask-1",
      "section": "attention",
      "conversation_id": "conv-1",
      "agent_id": "agent-1",
      "agent_name": "Deploy Project",
      "title": "Deploy now?",
      "subtitle": "Ship release notes",
      "status_label": "Pending",
      "tone": "attention",
      "timestamp": 1760000000000,
      "ask_id": "ask-1"
    }
  ]
}
```

字段语义：

- `id`：单 endpoint 内稳定唯一
- `section`：`attention`、`running`、`done`
- `conversation_id`：点击进入 Chat Detail 所需
- `agent_id` / `agent_name`：点击路由和展示所需
- `title`：优先使用决策问题、首条用户消息或 conversation title
- `subtitle`：优先使用最近 agent 回复或 conversation 摘要
- `status_label`：例如 `Pending`、`Running`、`Done`、`Failed`
- `tone`：例如 `attention`、`running`、`done`、`failed`
- `timestamp`：毫秒时间戳
- `ask_id`：仅 pending decision 必填，用于 `focus_ask_id`

## 6. Mobile 聚合与刷新策略

Activity 页面读取本机已配置 endpoints，并发请求每个 endpoint 的 `/api/v1/activity`。

聚合规则：

1. 对每个 endpoint 返回 item 注入 `endpoint_id`、`endpoint_label`、必要路由上下文
2. 按 `section` 分入 `Needs Attention`、`Running`、`Done`
3. 每个 section 内按 `timestamp DESC` 排序
4. 不同 endpoint 返回相同 `conversation_id` 或 `ask_id` 时，用 `endpoint_id:item.id` 保证全局唯一
5. 单个 endpoint 请求失败时，不阻断其它 endpoint 的 Activity 展示
6. 所有 endpoint 均失败时，展示全局错误状态和 Retry
7. 部分 endpoint 失败时，展示失败 endpoint label 和低干扰 Retry 入口

刷新策略：

- Activity 首次打开时拉取
- Activity 获得焦点时拉取
- 用户下拉刷新时拉取
- Activity 页面处于前台且可见时轮询拉取
- App 进入后台、Activity 失焦或用户离开 Activity 页面时停止轮询
- 轮询间隔默认 15 秒，后续可根据耗电和服务端压力调整
- 若某次轮询仍在进行中，不启动下一次并发轮询，避免请求堆积
- 本阶段不做全局 WS

## 7. 与现有 Inbox 的关系

旧 mobile `inbox` 保留以下职责：

- 接收 foreground push notification 时的本地兼容记录
- 支持通知入口跳转
- 支持历史版本升级后的临时兜底展示，但不参与 Activity 权威判定

Activity 页面不应再从 mobile `inbox` 生成 pending item。

历史版本中只存在于 mobile 本地 `answered_asks` 的状态，本阶段不做跨设备迁移。升级后的 Activity 以 CLI 后端 DB 为准。若旧 ask 在 CLI DB 中没有 answer 记录，但 conversation 已完成或失败，也不会显示在 `Needs Attention`。

## 8. 与 Chat 的关系

Chat 仍是工作现场，Activity 仍是入口索引。

- 决策卡片仍在 Chat timeline 内展示和处理
- Activity pending item 点击后进入 Chat Detail，并带 `focus_ask_id`
- 用户在 Chat 中提交 answer 后，CLI 后端 DB 记录该 ask 已回答
- Chat history 从 CLI 后端 `ask_answers` 恢复 `answered` / `answeredChoiceId` / `answeredChoiceIds`，避免换设备、重装或本地 DB 丢失后把已回答 ask 重新显示为可回答
- 刷新 Activity 后，该 pending item 不应继续出现在 `Needs Attention`
- Running / Done 状态以后端 `conversations.status` 为准

## 9. 验收标准

- [ ] CLI 提供 `GET /api/v1/activity?limit_per_section=50`，并要求 Bearer auth
- [ ] Activity API 无 Bearer token 返回 401
- [ ] 单 endpoint Activity 返回 `Needs Attention`、`Running`、`Done` 所需字段
- [ ] CLI 插入 `ask_question` 时，conversation 状态变为 `awaiting_question`
- [ ] `Needs Attention` 只包含 `awaiting_question` conversation 下未回答的 `ask_question`
- [ ] `completed` 或 `failed` conversation 下的未回答历史 ask 不出现在 `Needs Attention`
- [ ] 用户在 Chat 中回答决策后，answer 成功交给 runtime 才会被 CLI 持久化
- [ ] answer 失败交付时，该 ask 不应被标记为已回答
- [ ] Chat 重新加载历史消息时，已持久化到后端 `ask_answers` 的 ask 应显示为已回答
- [ ] 回答决策后重新打开、刷新或轮询 Activity，该 ask 不再出现在 `Needs Attention`
- [ ] `Running` 只包含后端 DB 中 `conversations.status = 'running'` 的会话
- [ ] `Done` 包含后端 DB 中 `completed` 和 `failed` 会话，并区分 `Done` / `Failed`
- [ ] `limit_per_section` 不允许 `Done` 挤掉 `Needs Attention`
- [ ] Mobile Activity 打开时并发请求所有已配置 endpoints
- [ ] Mobile 将多个 endpoint 的 Activity items 合并到同一个 `Activity` 页面
- [ ] Mobile 使用 `endpoint_id:item.id` 保证跨 endpoint item 唯一
- [ ] 单个 endpoint 离线时，其它 endpoint 的 Activity 仍正常展示
- [ ] 部分 endpoint 离线时，页面显示失败 endpoint label 和 Retry 入口
- [ ] 所有 endpoint 离线时，Activity 展示可重试的全局错误状态
- [ ] 下拉刷新会重新请求所有 endpoints 并更新列表
- [ ] Activity 前台可见时按默认 15 秒间隔轮询刷新
- [ ] Activity 失焦、页面卸载或 App 进入后台时停止轮询
- [ ] 轮询请求未完成时不会启动下一轮重复请求
- [ ] 点击 pending item 进入对应 endpoint 的 Chat Detail，并带 `focus_ask_id`
- [ ] 点击 running/done item 进入对应 endpoint 的 Chat Detail
- [ ] Activity 页面不再依赖 `chatStore.conversations` 是否已被 Project Detail 预加载
- [ ] Activity 页面不再以 mobile 本地 `inbox` 作为权威 pending 数据源

## 10. 测试要求

CLI 至少覆盖：

- 未回答 ask + `awaiting_question` conversation 出现在 Activity `attention`
- 未回答 ask + `completed` conversation 不出现在 Activity `attention`
- 已回答 ask 不出现在 Activity `attention`
- `running` conversation 出现在 Activity `running`
- `completed` conversation 出现在 Activity `done`
- `failed` conversation 出现在 Activity `done` 且 tone/status 为 failed
- answer 无等待 session 时不写入 `ask_answers`
- answer channel 存在但没有匹配 pending `ask_id` 时不写入 `ask_answers`
- message history 对已回答 `ask_question` 返回 backend answered 状态
- `limit_per_section` 分别限制每个 section
- Activity API 无 Bearer token 返回 401

Mobile 至少覆盖：

- Activity 打开时请求所有 configured endpoints
- 多 endpoint 返回 items 后按 section 和 timestamp 合并
- 跨 endpoint 相同 item id 不冲突
- 单 endpoint 失败不影响其它 endpoint items 渲染
- 全部 endpoint 失败时展示错误状态
- Activity 前台可见时启动轮询
- Activity 失焦、卸载或 App 进入后台时停止轮询
- 轮询请求未完成时不发起重叠请求
- pending item 路由包含正确 `endpoint_id`、`agent_id`、`conversation_id`、`focus_ask_id`
- running/done item 路由包含正确 `endpoint_id`、`agent_id`、`conversation_id`

如跨 endpoint 失败状态或 App 前后台切换难以在单元测试完整覆盖，应在 PR Test plan 中补充手工验证步骤。
