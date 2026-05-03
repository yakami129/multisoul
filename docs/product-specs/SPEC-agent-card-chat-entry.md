# Agent 卡片直达对话 SPEC

## 1. 背景与目标

Agents 模块目前点击 Agent 卡片会先打开 Agent 详情页，用户需要再点击 `OPEN CHAT` 才能进入对话。实际使用中，Agents 列表的主任务是快速选择一个 Agent 并开始对话；详情页成为多余的一跳。

本功能将 Agents 列表卡片的主点击行为改为直接进入该 Agent 的对话页，减少启动对话的操作成本。

## 2. 范围

### In Scope
- Agents tab 中点击 Agent 卡片直接进入 Chat 页面
- 进入 Chat 时保留当前 Agent 的 `agent_id`、`endpoint_id`，并传递 `agent_name`
- 保持 Chat 页面现有行为：无 `conv_id` 时创建新 conversation，有 `conv_id` 时加载已有 conversation
- 保留 Agent 详情页路由和现有 `OPEN CHAT` 行为，避免破坏已有深链或后续入口
- 更新相关测试，确保卡片点击触发的是 Chat 路由

### Out of Scope
- 移除 Agent 详情页
- 重新设计 Agent 卡片视觉样式
- 新增 Agent 设置、编辑、删除入口
- 调整 Chat tab 的 conversation 列表行为
- 修改 REST/WS API 或 CLI 数据模型

## 3. 用户与使用场景

**典型用户**：在手机上快速选择一个本地 Agent，并立即发起一次新对话。

**核心场景**：
1. 用户打开 Agents tab
2. 用户点击 `blog-fixer` Agent 卡片
3. App 直接进入 `blog-fixer` 的 Chat 页面
4. Chat 页面创建一个新的 conversation，用户可以立刻输入消息

## 4. 业务流程

### 当前流程
```
Agents tab
  ↓ 点击 Agent 卡片
Agent Detail
  ↓ 点击 OPEN CHAT
Chat
```

### 目标流程
```
Agents tab
  ↓ 点击 Agent 卡片
Chat
```

### 保留流程
```
Agent Detail
  ↓ 点击 OPEN CHAT
Chat
```

## 5. 行为要求

- 点击 Agent 卡片后导航到 `/agent/{agent_id}/chat?endpoint_id={endpoint_id}&agent_name={encoded_agent_name}`。
- `agent_name` 需 URL encode，避免空格、中文或特殊字符破坏路由参数。
- Chat 页面继续使用现有创建 conversation 逻辑，本功能不新增 conversation 复用策略。
- 如果 Agent 列表为空、加载中或加载失败，保持现有 UI 与交互不变。
- 下拉刷新、后台自动刷新、错误重试不受影响。

## 6. 状态与边界情况

| 场景 | 处理 |
|------|------|
| Agent 名称包含空格、中文或特殊字符 | 传入 Chat 路由前 encode，Chat 页面正常展示 |
| Agent 来自非默认 endpoint | 必须携带该卡片自己的 `endpoint_id` |
| 用户从 Agent 详情页点击 `OPEN CHAT` | 保持现有可用 |
| 用户从通知或 Inbox 进入已有 conversation | 不受影响，继续通过 `conv_id` 加载历史对话 |
| Agent 列表正在刷新时点击卡片 | 使用当前渲染卡片携带的 Agent 数据导航 |

## 7. 非功能性需求

- 点击卡片到 Chat 页面导航应在本地立即发生，不等待额外网络请求。
- 不新增 API 请求；Chat 页面自身创建 conversation 的请求保持现状。
- 不引入新的全局状态。

## 8. 验收标准

- [ ] 在 Agents tab 点击任一 Agent 卡片，直接进入该 Agent 的 Chat 页面，而不是 Agent Detail 页面
- [ ] Chat 页面能显示对应 Agent 名称
- [ ] Chat 页面能创建新 conversation，并允许用户发送消息
- [ ] 多 endpoint 场景下，点击某 endpoint 的 Agent 卡片后使用正确 endpoint 建立对话
- [ ] Agent 名称包含空格、中文或特殊字符时，跳转后名称显示正确
- [ ] Agent 详情页仍可通过已有路由打开，且 `OPEN CHAT` 仍能进入 Chat
- [ ] 下拉刷新和加载/错误/空列表状态行为不变
