# Projects-First Navigation Refactor SPEC

## 1. 背景与目标

当前 mobile 旧 UI 以 `Agents / Chat / Inbox / Settings` 为全局入口，用户需要先理解 agent、chat、inbox 三个技术视角，再定位当前工作。新版交互需要切换为 **Projects-first**：把一个 agent 工作空间作为用户的主要对象，用户先进入 project，再进入聊天、运行状态和决策处理。

pencli 中第一排 UI 标记为旧版 UI，第四排 UI 标记为新版本 UI。本规格以第四排 `Projects / Activity / Settings` 为视觉和交互基准，并遵循 Apple 设计哲学：清晰、克制、内容优先、直接操控、尊重 iOS 系统习惯。

**目标：**

- App 默认进入 `Projects`
- 全局底部导航收敛为 `Projects / Activity / Settings`
- 旧 `Agents` 列表迁移为 `Projects` 列表
- 旧全局 `Agents / Chat / Inbox` Tab 不再出现
- 第一阶段不引入新的 project 数据模型，复用现有 agents 数据完成信息架构迁移

## 2. 范围

### In Scope

- Mobile 底部 Tab 改为三项：`Projects / Activity / Settings`
- Tab 顺序固定为：`Projects`、`Activity`、`Settings`
- Tab 图标使用：`layers`、`inbox`、`settings`
- App 默认首页改为 `Projects`
- `Projects` 列表复用旧 `Agents Tab` 数据源，将 agent 呈现为 project/workspace
- Project 行点击进入 `Project Detail`
- `Projects`、`Activity`、`Settings` 顶部标题使用第四排新 UI 的大标题风格
- `Projects` 空状态为 `Connect a machine`，引导添加 machine
- 移除旧全局 `Agents / Chat / Inbox` Tab 入口
- 保留必要的旧入口跳转兼容，避免历史导航入口直接崩溃

### Out of Scope

- 新 project 数据模型
- Project Detail 完整交互
- `New Chat` 创建流程
- Activity item 跳转到 Chat
- Chat 决策卡行为调整
- Settings 功能重构
- 后端 API 或 CLI 协议变更

## 3. 信息架构

新版全局导航：

| Tab | 语义 | 迁移来源 |
|-----|------|----------|
| `Projects` | Agent 工作空间列表，默认首页 | 旧 `Agents Tab` |
| `Activity` | 全局待处理、运行中、已完成状态索引 | 旧 `Inbox Tab` 后续迁移 |
| `Settings` | Machines、通知、诊断等配置 | 旧 `Settings` |

旧 `Chat Tab` 不再作为全局 Tab。最近聊天入口只出现在 `Project Detail` 的 `Recent Chats` 区域，本规格不实现该详情页内容。

## 4. Projects 列表

`Projects` 列表第一阶段复用旧 `Agents Tab` 数据源。每个 agent 在 UI 上呈现为一个 project/workspace。

每个 project 行展示以下信息：

- Project 名称
- 当前状态，例如 `Running`、`Awaiting answer`、`Idle`
- Agent 类型，例如 `Claude Code`、`Codex`
- 最近任务标题

不在列表主信息中展示 machine 名称或 pending 数量。machine 信息后续放在 Project Detail 或 Settings 中。

点击 project 行进入 `Project Detail`。不根据 running 状态自动跳转到 Chat。

## 5. 空状态

当没有可展示 project/workspace 时，`Projects` 页面显示 `Connect a machine` 空状态。

空状态应提供清晰入口，引导用户添加 machine，例如扫描 QR 或粘贴 connection string。具体添加流程复用 Settings / machine 连接能力；本规格只要求入口存在，不重写连接流程。

## 6. 视觉规范

视觉以 pencli 第四排新 UI 为基准：

- 深色背景
- 卡片式列表
- 橙色只作为 action / 状态强调
- 中等信息密度
- 更矮、更克制的底部 Tab
- 主界面不显示 `MULTISOUL` 大品牌字
- 页面标题使用大标题风格，例如 `Projects`、`Activity`、`Settings`

实现时必须遵守 `mobile/docs/design.md` 的颜色、字号、间距、Apple 设计哲学约束。

## 7. 路由与兼容

- 新默认路由进入 `Projects`
- 删除旧全局 `Agents / Chat / Inbox` Tab 入口
- 旧 route path 如仍可能被历史导航或 deep link 访问，应提供必要兼容：跳转到对应新版页面或安全返回默认首页
- 不保留隐藏旧 Tab 作为回滚 UI

## 8. 验收标准

- [ ] 打开 App 默认进入 `Projects`
- [ ] 底部 Tab 仅显示 `Projects / Activity / Settings`
- [ ] Tab 图标为 `layers / inbox / settings`
- [ ] 旧 `Agents / Chat / Inbox` 全局 Tab 不再出现
- [ ] `Projects` 列表使用旧 agents 数据源展示 project/workspace
- [ ] Project 行点击进入 `Project Detail`
- [ ] 最近聊天入口不出现在全局 Tab，只保留给后续 `Project Detail`
- [ ] 空状态显示 `Connect a machine`，并提供添加 machine 的入口
- [ ] `Projects / Activity / Settings` 视觉与 pencli 第四排新 UI 基本一致

## 9. 测试要求

至少覆盖：

- 默认首页为 `Projects`
- 底部 Tab 路由从旧四项收敛为新三项

如现有测试工具能稳定覆盖导航渲染，应优先增加自动化测试；否则在 PR Test plan 中记录手工验证步骤和截图。

## 10. 后续规格

本规格完成后，后续独立规格继续拆分：

- `SPEC-ui-project-detail-chat.md`：Project Detail、New Chat、Chat Detail 保留对话和决策逻辑
- `SPEC-ui-activity-routing.md`：Activity 的 `Needs Attention / Running / Done` 分段，以及跳转到 Chat 对应位置
