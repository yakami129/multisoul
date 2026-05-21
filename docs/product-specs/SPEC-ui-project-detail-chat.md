# Project Detail and Chat Flow SPEC

## 1. 背景与目标

`Projects-first` 导航把 agent 工作空间作为主入口。用户进入某个 project 后，最重要的动作是开始一次新的对话或任务，并在 Chat 中继续处理 agent 输出、工具调用和决策请求。

本规格承接 `SPEC-ui-projects-navigation.md`，定义 `Project Detail`、`New Chat` 和 `Chat Detail` 的核心交互。视觉以 pencli 第四排 `Project Detail` 与 `Chat Detail` 为基准，交互遵循 Apple 设计哲学：路径短、语义清楚、内容优先。

**目标：**

- Project 行进入 `Project Detail`
- `Project Detail` 只保留 `New Chat` 作为主要发起入口
- `New Chat` 直接进入新的 `Chat Detail`
- Chat 保留原有对话和决策能力
- 决策请求既保留在 Chat timeline，也可被 Activity 索引

## 2. 范围

### In Scope

- `Project Detail` 页面结构
- `Project Detail` 顶部/主区域的 `New Chat` 入口
- `Recent Chats` 区域作为最近聊天入口
- `New Chat` 创建并进入新的 `Chat Detail`
- `Chat Detail` 保留原有消息流、输入框、工具调用、决策请求卡片能力
- Chat 决策请求可被 Activity 的 `Needs Attention` 同步索引
- 视觉对照 pencli 第四排 project detail / chat detail

### Out of Scope

- 独立 `Invoke` 入口
- 独立 Invoke screen 或 Invoke bottom sheet
- 新 project 数据模型
- Activity 页面完整实现
- Activity item 跳转滚动逻辑
- 后端协议变更
- Chat 消息渲染能力重写

## 3. Project 语义

本阶段 `Project` 表示 **Agent 工作空间**，不是纯代码目录，也不是普通 chat folder。

底层数据第一阶段仍复用既有 agent/session 数据，但 UI 语言面向用户呈现为 workspace/project：

- Project 名称来自 agent/workspace 的可读名称
- Agent 类型可展示为辅助信息，例如 `Claude Code`、`Codex`
- 当前状态来自 agent/session 的运行态
- 最近任务标题来自最近 chat/session

## 4. Project Detail

`Project Detail` 是某个 agent 工作空间的主页。

页面应展示：

- Project 名称
- 当前状态，例如 `Running`、`Awaiting answer`、`Idle`
- Agent 类型
- 主要操作：`New Chat`
- `Recent Chats` 列表

不再显示独立 `Invoke` 主按钮。发起新工作统一通过 `New Chat`。

`Recent Chats` 是旧全局 `Chat Tab` 的主要迁移位置。全局 Tab 不再提供最近聊天入口。

## 5. New Chat

用户点击 `New Chat` 后：

1. 直接创建新的 chat/session draft
2. 立即进入新的 `Chat Detail`
3. Chat 输入框为空并聚焦到可输入状态
4. 用户在 Chat 中输入任务或自由对话

不需要先弹 bottom sheet，不需要任务模板，不需要单独命名 chat。

如果创建 chat 失败，应在当前页面给出错误反馈，并允许用户重试。错误反馈使用现有 mobile 设计系统，不引入新的弹窗模式。

## 6. Chat Detail

`Chat Detail` 保留原有 Chat 逻辑：

- 用户可继续对话
- agent 回复进入同一 timeline
- 工具调用进入同一 timeline
- 决策请求以卡片形式嵌入 timeline
- 用户可在决策卡片上选择选项并提交

决策请求不改为强制 bottom sheet。Chat 是实际工作现场，Activity 只是全局索引。

## 7. 决策请求同步

当 Chat 中出现 pending 决策请求时：

- 决策卡片保留在 Chat timeline
- 同一决策也应出现在 Activity 的 `Needs Attention`
- 用户在 Chat 中处理决策后，Activity 中对应项应消失或转为完成态

本规格只定义同步语义；Activity 页面和跳转细节由 `SPEC-ui-activity-routing.md` 定义。

## 8. 视觉规范

视觉以 pencli 第四排为基准：

- Project Detail 使用大标题和克制卡片布局
- `New Chat` 是唯一主要 action
- `Recent Chats` 使用列表/卡片形式展示，信息密度中等
- Chat Detail 保持深色背景、清晰消息气泡、工具调用条目和决策卡片
- 主界面不显示 `MULTISOUL` 大品牌字

实现时必须遵守 `mobile/docs/design.md` 的颜色、字号、间距、Apple 设计哲学约束。

## 9. 验收标准

- [ ] Projects 列表点击 project 后进入 `Project Detail`
- [ ] `Project Detail` 显示 project 名称、状态、agent 类型
- [ ] `Project Detail` 只提供 `New Chat` 作为主要发起入口
- [ ] `Project Detail` 不显示独立 `Invoke` 主入口
- [ ] `Recent Chats` 出现在 `Project Detail`
- [ ] 点击 `New Chat` 直接进入新的 `Chat Detail`
- [ ] 新 Chat 输入框为空，可直接输入任务或对话
- [ ] Chat timeline 保留消息、工具调用、决策请求卡片
- [ ] Chat 内 pending 决策可同步到 Activity 的 `Needs Attention`
- [ ] 视觉与 pencli 第四排 Project Detail / Chat Detail 基本一致

## 10. 测试要求

至少覆盖：

- Project 行进入 `Project Detail`
- `New Chat` 进入新的 `Chat Detail`
- `Project Detail` 不渲染独立 `Invoke` 主入口
- Chat 决策请求仍能在 timeline 中展示并提交

如现有测试无法稳定覆盖聚焦输入框，可在 PR Test plan 中补充手工验证。
