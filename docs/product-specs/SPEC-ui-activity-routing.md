# Activity Routing SPEC

## 1. 背景与目标

新版导航将旧 `Inbox Tab` 合并为 `Activity`。Activity 不再只是待回答 inbox，而是全局状态索引：用户可以快速看到需要处理的决策、运行中的任务和已完成结果，并一跳回到对应 Chat 工作现场。

本规格承接 `SPEC-ui-projects-navigation.md` 与 `SPEC-ui-project-detail-chat.md`，定义 Activity 的分段、展示内容和跳转行为。

**目标：**

- Activity 按状态分段：`Needs Attention`、`Running`、`Done`
- 旧 Inbox 的 pending decision 合并进 `Needs Attention`
- `Needs Attention` item 跳到对应 Chat 决策卡片
- `Running` item 跳到对应 Chat 最新消息
- Activity 作为全局索引，不替代 Chat timeline

## 2. 范围

### In Scope

- `Activity` 页面三段结构：`Needs Attention`、`Running`、`Done`
- Pending decision 从旧 Inbox 迁移到 `Needs Attention`
- Running session/task 进入 `Running`
- 已完成或失败的近期结果进入 `Done`
- Activity item 点击后跳转到对应 `Chat Detail`
- `Needs Attention` 跳转后定位到对应决策卡片
- `Running` 跳转后定位到 Chat 最新消息
- 视觉对照 pencli 第四排 Activity UI

### Out of Scope

- 新 activity 数据模型
- Activity 详情页
- Inline 展开完整日志
- Activity 内直接处理决策的 bottom sheet
- Push notification 策略调整
- Chat timeline 消息渲染重写
- 后端协议变更

## 3. Activity 分段

Activity 使用状态分段，而不是按 project 分组或纯时间线。

| Section | 内容 | 交互 |
|---------|------|------|
| `Needs Attention` | pending 决策请求、需要用户输入的事项 | 点击进入对应 Chat，并滚动到决策卡片 |
| `Running` | 正在运行的 chat/session/task | 点击进入对应 Chat 最新消息 |
| `Done` | 近期完成、失败、取消的结果 | 点击进入对应 Chat 最新消息或结果位置 |

`Needs Attention` 优先显示在顶部。每段内部可按时间倒序排列。

## 4. Needs Attention

`Needs Attention` 继承旧 `Inbox Tab` 的核心价值，但不保留旧 Inbox 作为全局 Tab。

每个 item 至少展示：

- Project 名称
- 决策标题或问题摘要
- Agent 类型或状态辅助信息
- 相对时间

点击后：

1. 进入对应 `Chat Detail`
2. 滚动到对应决策卡片
3. 决策卡片保持 timeline 内嵌形态
4. 用户在 Chat 中完成选择

Activity 不使用强制 bottom sheet 直接处理决策。

## 5. Running

`Running` 展示正在执行中的 chat/session/task。

每个 item 至少展示：

- Project 名称
- 当前任务标题或最近 agent 动作
- 运行状态
- 相对时间

点击后进入对应 `Chat Detail`，定位到最新消息或最新运行状态。

## 6. Done

`Done` 展示近期完成、失败、取消的结果，用于回看。

每个 item 至少展示：

- Project 名称
- 完成/失败摘要
- 状态，例如 `Done`、`Failed`、`Canceled`
- 相对时间

点击后进入对应 `Chat Detail`。如果能定位到结果消息，优先定位结果消息；否则定位最新消息。

## 7. 与 Chat 的关系

Chat 是工作现场，Activity 是全局索引。

- 决策请求的权威交互仍在 Chat timeline
- 工具调用仍在 Chat timeline
- Activity 只展示摘要和入口
- Activity item 状态应随 Chat 内状态变化同步更新

当用户在 Chat 中完成决策后，对应 Activity item 应从 `Needs Attention` 移除，或转入 `Done`。

## 8. 视觉规范

视觉以 pencli 第四排 Activity UI 为基准：

- 页面标题使用大标题 `Activity`
- 顶部可显示 pending/running 计数摘要
- 分段控件或 section header 使用 `Needs Attention / Running / Done`
- 橙色用于需要用户注意的状态，不做装饰
- 列表密度保持中等，避免日志墙

实现时必须遵守 `mobile/docs/design.md` 的颜色、字号、间距、Apple 设计哲学约束。

## 9. 验收标准

- [ ] 旧 `Inbox Tab` 不再作为全局 Tab 出现
- [ ] Activity 显示 `Needs Attention / Running / Done` 三段
- [ ] Pending decision 出现在 `Needs Attention`
- [ ] Running chat/session/task 出现在 `Running`
- [ ] 完成或失败结果出现在 `Done`
- [ ] 点击 `Needs Attention` item 进入对应 Chat 并定位到决策卡片
- [ ] 点击 `Running` item 进入对应 Chat 最新消息
- [ ] 在 Chat 中处理决策后，Activity 状态同步更新
- [ ] Activity 视觉与 pencli 第四排 Activity UI 基本一致

## 10. 测试要求

至少覆盖：

- Pending decision 渲染在 `Needs Attention`
- Running item 渲染在 `Running`
- `Needs Attention` item 点击跳转到对应 Chat
- `Running` item 点击跳转到对应 Chat
- 旧 Inbox 全局 Tab 不再出现

如滚动定位难以在单元测试中稳定断言，应覆盖跳转参数，并在 PR Test plan 中补充手工验证滚动行为。
