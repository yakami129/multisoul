# MultiSoul — Mobile UI Design System

本文档定义 MultiSoul iOS App 的视觉语言与交互规范。它以 `docs/brand-design/02-identity-system.png` 为品牌源头，把品牌手册中的 Logo、Color、Type、Signal Kit 转译为移动端可执行规则。

---

## 1. 设计哲学

MultiSoul 是个人 AI Agent 随身控制台。它不是营销页，也不是普通聊天 App；它是一块可以远程操控本机 Agent 的小型任务仪表盘。

1. **Ink Console.** 主界面以 Ink Black 为底，像一块随身控制台，信息密度高但不压迫。
2. **Cream as Breath.** Cream 只用于品牌露出、空状态、说明性容器和高价值确认场景，让黑色界面有呼吸感。
3. **Signal, Not Decoration.** Cyan、Coral、Lime 是状态信号，不做大面积装饰；每次出现都必须回答“发生了什么”。
4. **Friendly Machine.** 图标和 mascot 可以有手绘感，但控件结构必须像 Apple 工具：直接、稳定、可扫描。

---

## 2. 颜色体系

### 2.1 Brand Core Palette

以下颜色来自品牌识别系统，是新 UI 的主色板。移动端新增颜色必须优先从这里选。

| Token | 色值 | 语义 | 使用场景 |
|------|------|------|----------|
| `brand.cream` | `#F6F3EC` | 纸感底色 / 品牌呼吸 | 品牌区、空状态、说明卡、浅色 icon variant |
| `brand.ink` | `#0D0D0D` | 主背景 / 主文字 | App 背景、深色表面、浅底文字 |
| `brand.cyan` | `#00E5FF` | 直播流 / 消息 / 连接 | stream、message、同步、网络可达 |
| `brand.coral` | `#FF5A3C` | 决策 / 注意 / 中断 | AskQuestion、需要用户判断、危险前置提示 |
| `brand.lime` | `#C6FF00` | 完成 / 可执行 / 远程控制 | Done、primary ready、成功完成、远程在线 |
| `brand.sage` | `#B7C9AE` | 本地 Agent / 稳定中性 | local agent、secondary surface、冷静状态 |
| `brand.silver` | `#E6E6E8` | 边界 / 次级底 | divider、muted surface、浅底描边 |

### 2.2 App Surfaces

| Token | 色值 | 用途 |
|------|------|------|
| `surface.app` | `#0D0D0D` | 页面底色、状态栏底色 |
| `surface.panel` | `#141414` | 主内容卡片、列表行、输入框 |
| `surface.raised` | `#1A1A1A` | 浮层、Tab Bar、底部 Sheet |
| `surface.deep` | `#111111` | 未读行、压暗区域、代码块 |
| `surface.option` | `#252525` | 未选中选项、次级按钮 |
| `surface.line` | `#1E1E1E` | 列表分割线、卡片描边 |
| `surface.lineStrong` | `#2A2A2A` | Sheet 分割线、强边界 |
| `surface.handle` | `#333333` | Bottom Sheet handle |
| `surface.scrim` | `#000000` 55% | Modal / Sheet 背景遮罩 |

### 2.3 Text Palette

| Token | 色值 | 用途 |
|------|------|------|
| `text.primary` | `#FFFFFF` | 深色底主标题、重要正文 |
| `text.secondary` | `#DDDDDD` | 正文、问题内容、列表摘要 |
| `text.muted` | `#888888` | 时间、说明、辅助标签 |
| `text.disabled` | `#666666` | 占位符、不可用控件、轻提示 |
| `text.dim` | `#555555` | 非激活图标、低优先级时间 |
| `text.onCream` | `#0D0D0D` | Cream / Lime / Silver 底上的文字 |

### 2.4 Signal Palette

| Token | 色值 | 语义 | 使用场景 |
|------|------|------|----------|
| `signal.live` | `#00E5FF` | 正在流动的信息 | 实时消息、同步中、工具输出 |
| `signal.decide` | `#FF5A3C` | 需要判断 | AskQuestion、待确认、用户注意 |
| `signal.done` | `#C6FF00` | 已完成 / 可继续 | 完成状态、primary ready、成功徽章 |
| `signal.local` | `#B7C9AE` | 本机稳定 | Local Agent、idle、低风险运行 |
| `signal.error` | `#FF4444` | 错误 / 危险 | 删除、失败、停止运行 |
| `signal.legacyAction` | `#FF6B35` | 旧行动强调兼容色 | 已有代码中的 CTA、未读徽章、进度条 |
| `signal.legacyActionSoft` | `#FF6B3588` / `#FF6B3599` / `#FF6B35CC` | 旧强调透明层 | 已有 glow / shadow 兼容 |
| `signal.legacyWarm` | `#FF8C42` | 旧渐变终点 | 已有 avatar 渐变兼容 |
| `signal.successCompat` | `#4CAF50` | 旧成功色 | 已有 Running / Completed 状态兼容 |

### 2.5 Runtime Avatar / Mascot

Projects 列表中的 Agent Avatar 为 40×40px、9px 圆角的像素/mascot 画布。优先按 runtime 显示第一组生成的 mascot PNG：

| Runtime | 背景语义 | 资产 | 用途 |
|---------|----------|------|------|
| `claude-code` | `surface.option` | `mobile/assets/agent-icons/runtime-claude-code.png` | Claude runtime |
| `codex` | `signal.decide` 或兼容 `signal.legacyAction` | `mobile/assets/agent-icons/runtime-codex.png` | Codex / 代码执行 |
| `cursor-cli` | `#2563EB` | `mobile/assets/agent-icons/runtime-cursor-cli.png` | Cursor / 编辑器语义 |
| `custom` | fallback 色板 | 无固定 PNG | 自定义 runtime |

Fallback 色板：`#FF5A3C`、`#00E5FF`、`#C6FF00`、`#B7C9AE`、`#7C3AED`、`#2563EB`、`#059669`。

---

## 3. 字体规范

### 3.1 字体家族

| 角色 | 字体 | 用途 |
|------|------|------|
| 品牌展示 | Space Grotesk | MultiSoul 字标、页面大标题、数字强调 |
| 界面文字 | Inter | 导航、列表、按钮、正文、时间戳 |
| 等宽信息 | SF Mono / ui-monospace | token、命令、日志片段 |

### 3.2 字号规范

| 场景 | 字号 | 字体 | 字重 | 用途 |
|------|------|------|------|------|
| App 品牌标题 | 32px | Space Grotesk | 700 | Home / Splash 品牌名 |
| 页面标题 | 28px | Space Grotesk | 700 | Inbox、Agents、Settings |
| Sheet 标题 | 20px | Space Grotesk | 700 | Bottom Sheet / Modal |
| 空状态标题 | 22px | Space Grotesk | 700 | 空状态主文字 |
| 列表主标题 | 15px | Inter | 600/700 | Agent / Conversation 名称 |
| 正文 / 问题 | 15-16px | Inter | 400/600 | AskQuestion、Inbox 问题 |
| 摘要 | 14px | Inter | 400 | 列表 preview、说明文案 |
| 标签 / Chip | 12-13px | Inter | 600/700 | 状态标签、section 标签 |
| 时间戳 | 12px | Inter | 400 | 列表时间、事件时间 |
| 徽章文字 | 11px | Inter | 700 | 未读数、状态短词 |

### 3.3 排版规则

- Display 字体只用于标题、数字、品牌，不用于长段正文。
- 字母间距默认为 0；只有极短 label 可使用 1-3px tracking。
- 正文 lineHeight 使用 1.35-1.45；聊天长文本优先可读性。
- 深色底上避免 100% 大段白字；正文优先 `text.secondary`。

---

## 4. 间距体系

基于 4px 网格，控件密度偏工具型，不做营销页式大留白。

### 4.1 Gap

| 间距 | 用途 |
|------|------|
| 2px | 名称与状态副文案 |
| 4px | 标题与副标题、图标与短标签 |
| 6px | 呼吸点、微型状态组 |
| 8px | 搜索框、选项列表、chip 内部 |
| 10px | Inbox 卡片信息组 |
| 12px | Avatar 与内容、按钮组 |
| 14px | AskQuestion 内容组 |
| 16px | 卡片头部、主要操作区 |
| 20px | 聊天消息组 |
| 24px | 页面主分区间距 |

### 4.2 Padding

| 容器 | Padding | 说明 |
|------|---------|------|
| 页面水平边距 | `16px` | iPhone 标准内容边距 |
| 列表行 | `[0, 16]` | 上下0，左右16 |
| 搜索框包装 | `[0, 16, 8, 16]` | 与 header 对齐 |
| Section 标签行 | `[4, 16, 8, 16]` | 保持扫描节奏 |
| 导航栏 | `[0, 16]` | 左右安全区内对齐 |
| 聊天区域 | `[12, 16]` 或 `16px` | 消息区 |
| 输入框区域 | `[8, 16, 34, 16]` | 包含 Home Indicator |
| Tab 包装 | `[0, 20, 34, 20]` | 浮动胶囊 |
| AskQuestion 卡片 | `24px` | 高优先级决策容器 |
| AskQuestion 选项 | `[12, 16]` | 便于触控 |
| Inbox 卡片 | `16px` | 信息密度适中 |
| Bottom Sheet | `[16, 20, 20, 20]` | 稳定阅读 |
| 空状态 hint | `[10, 16]` | 小型说明 |
| 徽章 | `[2, 6]` | 紧凑数字 |

---

## 5. 形状与材质

| 元素 | 半径 | 材质 |
|------|------|------|
| App Icon / mascot frame | 18-24px | Cream / Ink 高对比 |
| Runtime Avatar | 9px | 圆角方形，不用纯圆 |
| 标准卡片 | 12px | `surface.panel` + 1px line |
| 高优先级卡片 | 16px | `surface.raised` + signal 边 |
| 按钮 | 8-12px | 根据密度决定，不超过 12px |
| 输入框 | 26px | 胶囊 |
| Tab Bar | 36px | 浮动胶囊 |
| Bottom Sheet | `[20, 20, 0, 0]` | 仅顶部圆角 |

材质规则：

- 深色表面通过明度差和 1px 线分层，不依赖重阴影。
- Cream / Silver 容器需要 1px `brand.silver` 或 `surface.line` 边界。
- Lime 和 Cyan 可做小面积 fill；大面积使用时必须降低饱和占比或只做描边/状态条。

---

## 6. 布局结构

### 6.1 iOS App 屏幕尺寸

默认设计基准：390×844px（iPhone 14 标准尺寸）。实现需适配动态高度和 Safe Area。

### 6.2 Home / Agents

```text
Status Bar (44)
Header: MultiSoul + compose/control
Connection rail: Local / Remote / Live signal
Search / Filter row
Section: ACTIVE NOW
Agent row (72): avatar, name, runtime, status, action
Section: RECENT
Conversation rows
Floating Tab Bar (62 + Home Indicator)
```

### 6.3 Chat Detail

```text
Status Bar (44)
Nav Bar (56): back, conversation/runtime, actions
Event stream: agent messages, tool calls, decisions
Question card, when pending
Composer: input capsule + send / inject controls
Home Indicator
```

### 6.4 Activity / Inbox

```text
Status Bar
Header: Inbox / Activity + filters
Segmented control: Attention / Done or Running / All
Question or event list
Bottom action sheet for answering
Floating Tab Bar
```

---

## 7. 组件规范

### 7.1 Tab Bar

- 高度：62px，cornerRadius 36px
- 背景：`surface.raised`
- 布局：horizontal，space_between，padding `[0, 28]`
- 图标：Lucide，16×16px
- 标签：Inter 11px/600
- 激活：`text.primary` + 可选 2px `signal.done` 指示点
- 非激活：`text.dim`

### 7.2 搜索框

- 高度：44px，cornerRadius 12px
- 背景：`surface.panel`
- 图标：lucide `search`，16×16px，`text.disabled`
- 占位文字：Inter 16px，`text.disabled`
- 聚焦态：1px `signal.live` 边界；不改变高度

### 7.3 Agent / Conversation Row

- 高度：72px，padding `[0, 16]`
- 布局：horizontal，alignItems center，gap 12px
- Avatar：40×40px、9px 圆角，使用 runtime mascot
- 名称：Inter 15px/600，`text.primary`
- 摘要：Inter 14px，`text.muted`
- 时间戳：Inter 12px，`text.dim`
- 未读 / attention：行背景 `surface.deep`，右侧显示 `signal.decide` 徽章

### 7.3.1 Active Now Running Breath

- 仅 `Agents > Active Now` 中状态为 `running` 的 Agent 行显示呼吸生命感；同一 Agent 在 `All Agents` 中的重复行不显示。
- `awaiting_question` 不使用呼吸特效，使用 pending badge 和 `Running · Awaiting answer` 文案表达需要用户关注。
- 动画母题：`Signal Ribbon`。一条低透明横向光带从 Avatar 右侧向状态区域缓慢漂移。
- `running` 用 `signal.live` 或兼容 `signal.successCompat`；`awaiting_question` 用 `signal.decide`；`completed` 用 `signal.done`。
- 节奏约 2.6 秒一次完整呼吸。Reduce Motion 开启时关闭循环动画，仅保留静态边框与状态点。

### 7.4 Status Badge

- 高度：20-24px，cornerRadius 10-12px
- Padding：`[2, 6]` 或 `[4, 8]`
- 文案：Inter 11px/700，全大写短词
- `LIVE` / `STREAM`：`signal.live`
- `DECIDE` / `PENDING`：`signal.decide`
- `DONE` / `READY`：`signal.done`
- `LOCAL` / `IDLE`：`signal.local`

### 7.5 输入框行

- 高度：52px，cornerRadius 26px
- 背景：`surface.raised`
- 布局：horizontal，alignItems center，gap 8px，padding `[0, 4, 0, 16]`
- 发送按钮：圆形；默认 `signal.done`，待确认注入时使用 `signal.decide`
- 禁用态：按钮背景 `surface.option`，图标 `text.dim`

### 7.6 AskQuestion 卡片

- 背景：`surface.raised`，cornerRadius 16px，padding 24px，gap 16px
- 顶部 label：`DECISION REQUIRED`，Inter 11px/700，`signal.decide`
- 问题文字：Inter 16px/600，`text.primary`
- 提示：Inter 13px，`text.disabled`
- 选项行：cornerRadius 10px，padding `[12, 16]`
- 已选中：背景 `#1F2A1F` 或低透明 `signal.done`，边框 `signal.done`
- 未选中：背景 `surface.option`
- 确认按钮：优先 `signal.done`；危险选择使用 `signal.decide`

### 7.7 Multi AskQuestion 卡片

- 与单问题卡片结构相同，增加进度行。
- 进度条：已答 `signal.done`，当前待答 `signal.decide`，背景 `surface.lineStrong`
- 锁定问题：opacity 0.45，背景 `surface.deep`，边框 `surface.lineStrong`
- 不把所有问题同时做成强卡片；当前问题视觉优先级最高。

### 7.8 Inbox / Activity Card

- 背景：`surface.app` 或 `surface.panel`，padding 16px，gap 10px
- 顶部：Agent 名称 + 时间 + 状态 chip
- 问题文字：Inter 15px，`text.secondary`，lineHeight 1.4
- Dismiss：Inter 13px，`text.disabled`
- Answer：Inter 13px/600，`signal.decide`
- 已完成：Answer 替换为 `DONE` chip，使用 `signal.done`

### 7.9 Bottom Sheet

- 背景：`surface.raised`
- 高度：默认 584px，可随内容和键盘动态调整
- 圆角：`[20, 20, 0, 0]`
- 背后遮罩：`surface.scrim`
- Handle：4×36px，`surface.handle`
- 关闭按钮：32×32px 圆形，背景 `surface.option`
- 分割线：1px，`surface.lineStrong`

### 7.10 空状态

- 使用 Cream 或 Ink 两种模式：
  - 深色页内：`surface.panel` 图标容器 + mascot line icon
  - 品牌/引导：`brand.cream` 背景 + Ink mascot
- 标题：Space Grotesk 22px/700
- 副标题：Inter 15px，`text.muted`，textAlign center，maxWidth 260px
- Hint 行：cornerRadius 12px，背景 `surface.raised` 或 `brand.silver`

---

## 8. 图标与插画

- UI 图标统一使用 Lucide。
- 品牌 mascot 用于 App Icon、空状态、远程控制成功、连接引导。
- Mascot 不进入每个列表行；列表行优先 runtime avatar，避免噪声。
- Lucide 图标尺寸：
  - Tab：16×16px
  - 列表 / chip：14-16×16px
  - 导航操作：22-26px
  - 空状态：36px
- 手绘 mascot 与 UI 图标可以共存，但不要混在同一个小按钮里。

---

## 9. Motion Rhythm

品牌 Signal Kit 中的节奏转译为移动端动效：

| 语义 | 动效 | 时长 |
|------|------|------|
| Think | 轻微点状 pulse | 1600-2200ms |
| Process | Cyan ribbon 横向漂移 | 2200-3000ms |
| Decide | Coral 边框短促闪烁一次 | 180-260ms |
| Done | Lime fill / check 进入 | 240-360ms |
| Alert | Ink/Cream 高对比切换，不循环 | 120-180ms |

规则：

- 循环动效只允许出现在 running / live 状态。
- 决策提醒不循环闪烁；进入一次后保持稳定。
- 全部动效必须跟随 Reduce Motion。

---

## 10. 反模式清单

| 禁止 | 原因 | 替代 |
|------|------|------|
| 大面积使用 Cyan / Lime / Coral | 信号色失去语义 | 只用于状态、边、徽章、按钮 |
| 把 Cream 当普通页面背景 | App 会变成品牌页而非控制台 | Cream 用于品牌呼吸和高价值说明 |
| 所有状态都用同一种橙色 | 无法区分 live / decide / done | 使用 Signal Palette |
| 纯营销式 hero 布局进入 App 首屏 | App 是工具，不是 landing page | 首屏直接展示可操作控制台 |
| 卡片套卡片 | 层级混乱 | 用分割线、section、状态条 |
| 大圆角无差别滥用 | 控件显得幼稚且不稳定 | 按 §5 形状表选择半径 |
| 非 Lucide 图标随意混用 | 破坏一致性 | Lucide + mascot 分工 |
| 用未列入 §2 的 hex | 会触发颜色合规风险 | 先扩展 §2 并同步脚本 |

---

## 11. UI 检查清单

提交任何 UI 变更前，逐项确认：

- [ ] 所有 hex 是否在 §2 色板内，且 `scripts/check-mobile-colors.sh` 已同步新增色？
- [ ] Signal 色是否只表达状态，不做无语义装饰？
- [ ] 字体是否只使用 Space Grotesk / Inter / SF Mono？
- [ ] 页面是否仍是可扫描的工具界面，而非营销页？
- [ ] Tab Bar 是否 62px 高、cornerRadius 36px？
- [ ] 输入框是否 52px 高、cornerRadius 26px？
- [ ] 列表行是否稳定在 72px 左右，动态内容不会撑开布局？
- [ ] AskQuestion 是否明确突出“需要用户决策”？
- [ ] Bottom Sheet 是否有 handle、scrim、顶部圆角和安全区处理？
- [ ] 动效是否遵守 Reduce Motion？
- [ ] Cream / mascot 是否用于品牌呼吸，而不是到处填充？
