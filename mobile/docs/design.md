# MultiSoul — Mobile UI Design System

本文档定义 MultiSoul iOS App 的视觉语言与交互规范。所有 UI 开发以此为准。

---

## 1. 设计哲学

三条核心原则：

1. **深色优先。** 界面以近黑色（`#0D0D0D`）为基底，减少视觉疲劳，突出内容层次。
2. **橙色是行动信号。** `#FF6B35` 仅用于主要行动点（CTA、未读徽章、强调状态），不做装饰。
3. **克制的现代感。** 圆角适度，间距宽松，字重分明——每个元素服务于信息传达，不堆砌特效。

---

## 2. 颜色体系

### 2.1 背景色阶

| 角色 | 色值 | 用途 |
|------|------|------|
| 主背景 | `#0D0D0D` | 页面底色、屏幕背景 |
| 卡片/组件表面 | `#1A1A1A` | 卡片、输入框、Tab Bar、底部 Sheet |
| 深层表面 | `#111111` | 列表行高亮背景（未读状态） |
| 次级表面 | `#161616` | 底部 Sheet 背景 |
| 深色卡片 | `#141414` | 锁定选项背景 |
| 选项选中背景 | `#1F2A1F` | AskQuestion 已选中选项背景 |
| 未选中选项背景 | `#252525` | AskQuestion 未选中选项背景 |
| 分割线 | `#1E1E1E` | 列表分割线、卡片内分割线 |
| Sheet 分割线 | `#2A2A2A` | 底部 Sheet 内分割线 |
| 遮罩 | `#000000` 55% | 底部 Sheet 背景遮罩 |

### 2.2 文字色阶

| 角色 | 色值 | 用途 |
|------|------|------|
| 主要文字 | `#FFFFFF` | 标题、主要内容、激活状态 |
| 次要文字 | `#DDDDDD` | 问题正文、列表内容 |
| 辅助文字 | `#888888` | 时间戳、副标题、空状态说明 |
| 禁用/占位文字 | `#666666` | 搜索框占位符、搜索图标、过滤图标 |
| 极暗文字 | `#555555` | 时间戳（非高亮行） |

### 2.3 强调色

| 色值 | 含义 | 使用场景 |
|------|------|----------|
| `#FF6B35` | 主强调 / 行动 | CTA 按钮、未读徽章、Pending 数量提示、选中边框、进度条 |
| `#FF6B3588` | 主强调半透明（53%） | textShadowColor 光晕效果 |
| `#FF6B3599` | 主强调半透明（60%） | textShadowColor 光晕效果 |
| `#FF6B35CC` | 主强调半透明（80%） | textShadowColor 光晕效果 |
| `#FF8C42` | 渐变终点 | Avatar 渐变（与 `#FF6B35` 组合） |
| `#4CAF50` | 成功 / 已选中 | AskQuestion 选中选项边框、空状态 check 图标 |
| `#FF4444` | 错误 / 危险 | 停止按钮边框、删除操作文字、错误提示 |

### 2.4 Avatar 色板

列表中每个 Agent 使用固定颜色 Avatar（圆形）：

| 色值 | 用途 |
|------|------|
| `#FF6B35` → `#FF8C42`（135° 渐变） | Agent 1（默认第一位） |
| `#7C3AED` | Agent 2 |
| `#2563EB` | Agent 3 |
| `#059669` | Agent 4 |

---

## 3. 字体规范

### 3.1 字体家族

| 角色 | 字体 | 用途 |
|------|------|------|
| 展示标题 | Anton | 大标题、品牌名 |
| 界面文字 | Inter | 导航、标签、正文、按钮、时间戳 |

### 3.2 字号规范

| 场景 | 字号 | 字体 | 字重 | 用途 |
|------|------|------|------|------|
| 品牌大标题 | 32px | Inter | 700 | Home 页顶部品牌名（"Grok"） |
| 页面标题 | 28px | Inter | 700 | Inbox 页标题 |
| 空状态标题 | 22px | Inter | 700 | 空状态主文字 |
| 问题正文 | 15–16px | Inter | 600/normal | AskQuestion 问题文字、列表问题 |
| 搜索框 | 16px | Inter | normal | 搜索框占位符 |
| 对话名称 | 15px | Inter | 600 | 列表行主标题 |
| 对话摘要 | 14px | Inter | normal | 列表行副标题、Pending 数量提示 |
| 标签/提示 | 13px | Inter | normal/600 | Section 标签（"RECENT"）、选项提示 |
| 时间戳 | 12px | Inter | normal | 列表行时间 |
| 徽章文字 | 11px | Inter | 700 | 未读数量徽章 |
| 空状态提示 | 12px | Inter | normal | 空状态 hint 文字 |

### 3.3 行高

| 场景 | lineHeight | 用途 |
|------|-----------|------|
| 问题正文 | 1.4 | Inbox 列表问题文字 |

---

## 4. 间距体系

基于 4px 网格。

### 4.1 组件内间距（gap）

| 间距 | 用途 |
|------|------|
| 2px | 对话名称与摘要行间距 |
| 3px | Tab 图标与标签间距 |
| 4px | 页面标题与副标题间距 |
| 6px | 打字指示器点间距 |
| 8px | 搜索框图标与文字间距、输入框内元素间距、选项列表间距 |
| 10px | Inbox 卡片内行间距 |
| 12px | 列表行 Avatar 与内容间距 |
| 14px | AskQuestion 卡片内行间距 |
| 16px | 操作按钮组间距、卡片头部元素间距 |
| 20px | 聊天消息间距 |
| 24px | 聊天区域消息间距 |

### 4.2 容器 Padding

| 容器 | Padding | 说明 |
|------|---------|------|
| 列表行 | `[0, 16]` | 上下0，左右16 |
| 搜索框包装 | `[0, 16, 8, 16]` | 上0，右16，下8，左16 |
| Section 标签行 | `[4, 16, 8, 16]` | 上4，右16，下8，左16 |
| 导航栏 | `[0, 16]` | 上下0，左右16 |
| 聊天区域 | `[12, 16]` 或 `16` | 聊天消息区 |
| 输入框区域 | `[8, 16, 34, 16]` | 上8，右16，下34（Home Indicator），左16 |
| Tab 包装 | `[0, 20, 34, 20]` | 上0，右20，下34，左20 |
| AskQuestion 卡片 | `24px` | 四边均24 |
| AskQuestion 选项 | `[12, 16]` | 上下12，左右16 |
| Inbox 卡片 | `16px` | 四边均16 |
| Inbox 卡片 chip | `[4, 8]` | 上下4，左右8 |
| 底部 Sheet | `[16, 20, 20, 20]` | 上16，右20，下20，左20 |
| 底部 Sheet handle 行 | `[12, 0, 8, 0]` | 上12，下8 |
| 底部 Sheet 头部 | `[0, 20, 12, 20]` | 上0，右20，下12，左20 |
| 空状态 hint | `[10, 16]` | 上下10，左右16 |
| 未读徽章 | `[2, 6]` | 上下2，左右6 |

---

## 5. 布局结构

### 5.1 iOS App 屏幕尺寸

所有屏幕：390×844px（iPhone 14 标准尺寸）

### 5.2 Home 页（对话列表）

```
┌─────────────────────────────┐
│ Status Bar (44px)            │
├─────────────────────────────┤
│ Header                       │
│  "Grok" (32px/700)  [pencil] │
├─────────────────────────────┤
│ Search Bar (44px, r=12)      │
│  🔍 Search                   │
├─────────────────────────────┤
│ Section: RECENT  [badge?]    │
├─────────────────────────────┤
│ Conv Row (72px)              │
│  [Avatar] Name    2m         │
│           Preview            │
│ Conv Row (72px)              │
│  ...                         │
├─────────────────────────────┤
│ (spacer)                     │
├─────────────────────────────┤
│ Tab Bar (62px, r=36)         │
│  [Chat] [Inbox] [Profile]    │
│ (34px Home Indicator)        │
└─────────────────────────────┘
```

### 5.3 Chat 页

```
┌─────────────────────────────┐
│ Status Bar (44px)            │
├─────────────────────────────┤
│ Nav Bar (56px)               │
│  ← Back  Model Name  ⋯ ⊕   │
├─────────────────────────────┤
│ Chat Area (fill)             │
│  AI message bubble           │
│  User message bubble (right) │
│  AI message + typing...      │
├─────────────────────────────┤
│ Input Area                   │
│  [input row (52px, r=26)]    │
│  [suggestion chips]          │
│ (34px Home Indicator)        │
└─────────────────────────────┘
```

### 5.4 Inbox 页

```
┌─────────────────────────────┐
│ Status Bar (44px)            │
├─────────────────────────────┤
│ Header                       │
│  "Inbox"  [filter icon]      │
│  "3 pending responses"       │
├─────────────────────────────┤
│ Divider (1px, #1E1E1E)       │
├─────────────────────────────┤
│ Question Card                │
│  Agent · Time  [chip]        │
│  Question text               │
│  [Dismiss] [Answer]          │
│ Divider                      │
│ Question Card                │
│  ...                         │
├─────────────────────────────┤
│ Tab Bar (62px, r=36)         │
└─────────────────────────────┘
```

---

## 6. 组件规范

### 6.1 Tab Bar

- 高度：62px，cornerRadius 36px
- 背景：`#1A1A1A`
- 布局：horizontal，space_between，padding `[0, 28]`
- 每个 Tab：vertical，alignItems center，gap 3px
  - 图标：Lucide，16×16px
  - 标签：Inter 11px
  - 激活色：`#FFFFFF`；非激活色：`#555555`

### 6.2 搜索框

- 高度：44px，cornerRadius 12px
- 背景：`#1A1A1A`
- 布局：horizontal，alignItems center，gap 8px，padding `[0, 12]`
- 图标：lucide `search`，16×16px，`#666666`
- 文字：Inter 16px，`#666666`

### 6.3 对话列表行

- 高度：72px，padding `[0, 16]`
- 布局：horizontal，alignItems center，gap 12px
- Avatar：40×40px 圆形（ellipse），使用 §2.4 色板
- 内容区：vertical，gap 2–3px，width fill_container
  - 名称：Inter 15px/600，`#FFFFFF`
  - 摘要：Inter 14px，`#888888`
- 时间戳：Inter 12px，`#555555`
- 未读状态：行背景 `#111111`，时间戳旁显示橙色徽章

### 6.4 未读徽章

- 背景：`#FF6B35`，cornerRadius 10px，padding `[2, 6]`
- 文字：Inter 11px/700，`#FFFFFF`

### 6.5 导航栏（Chat 页）

- 高度：56px，padding `[0, 16]`，space_between
- 返回按钮：horizontal，alignItems center，gap 4px，`#FFFFFF`
- 模型标签：vertical，alignItems center，gap 2px（名称 + 状态）
- 操作区：horizontal，gap 16px，图标 `#FFFFFF`

### 6.6 输入框行

- 高度：52px，cornerRadius 26px
- 背景：`#1A1A1A`
- 布局：horizontal，alignItems center，gap 8px，padding `[0, 4, 0, 16]`
- 发送按钮：右侧，圆形，`#FF6B35` 背景

### 6.7 AskQuestion 卡片（单问题）

- 背景：`#1A1A1A`，cornerRadius 16px，padding 24px，gap 16px
- 头部：horizontal，space_between
  - 左：Agent 图标 + 名称（Inter 13px，`#888888`）
  - 右：info 图标（`#555555`）
- 问题文字：Inter 16px/600，`#FFFFFF`，width fill_container
- 提示：Inter 13px，`#666666`（"Select one option to continue"）
- 选项列表：vertical，gap 8px
  - 选项行：horizontal，alignItems center，gap 12px，cornerRadius 10px，padding `[12, 16]`
  - 已选中：背景 `#1F2A1F`，边框 `#4CAF50` 1.5px
  - 未选中：背景 `#252525`，无边框
- 操作行：horizontal，justifyContent end，gap 12px
  - 取消按钮：cornerRadius 8px，背景 `#252525`，padding `[10, 20]`
  - 确认按钮：cornerRadius 8px，背景 `#FF6B35`，padding `[10, 20]`

### 6.8 Multi AskQuestion 卡片

- 与单问题卡片结构相同，增加：
  - 进度行：horizontal，space_between（"1 / 3 answered" + 进度条）
  - 进度条：`#FF6B35` 填充，背景 `#2A2A2A`
  - 锁定问题：opacity 0.45，背景 `#141414`，边框 `#2A2A2A`

### 6.9 Inbox 问题卡片

- 背景：`#0D0D0D`，padding 16px，gap 10px，layout vertical
- 顶部行：horizontal，space_between
  - 左：Agent 名称（Inter 13px/600，`#FFFFFF`）+ 时间（Inter 12px，`#555555`）
  - 右：Agent 图标（16×16px，`#888888`）
- 问题文字：Inter 15px，`#DDDDDD`，lineHeight 1.4
- Chip（来源标签）：cornerRadius 6px，背景 `#1A1A1A`，padding `[4, 8]`
  - 图标 + 文字：Inter 12px，`#888888`
- 操作行：horizontal，justifyContent end，gap 8px
  - Dismiss：Inter 13px，`#666666`
  - Answer：Inter 13px/600，`#FF6B35`

### 6.10 底部 Sheet（Answer Modal）

- 背景：`#161616`，cornerRadius `[20, 20, 0, 0]`（仅上方圆角）
- 高度：584px，绝对定位于屏幕底部
- 背后遮罩：`#000000` 55% opacity
- Handle：4×36px 圆角矩形，`#333333`，居中
- 头部：horizontal，space_between，padding `[0, 20, 12, 20]`
  - 标题组：vertical，gap 2px
  - 关闭按钮：32×32px 圆形，背景 `#252525`
- 分割线：1px，`#2A2A2A`
- 内容区：padding `[16, 20, 20, 20]`，gap 14px

### 6.11 空状态（Inbox Empty）

- 布局：vertical，alignItems center，justifyContent center，gap 16px
- 图标容器：80×80px 圆形，背景 `#1A1A1A`
  - check 图标：36×36px，`#4CAF50`
- 标题：Inter 22px/700，`#FFFFFF`
- 副标题：Inter 15px，`#888888`，textAlign center，width 260px
- Hint 行：horizontal，gap 8px，cornerRadius 12px，背景 `#1A1A1A`，padding `[10, 16]`
  - bell 图标：14×14px，`#555555`
  - 文字：Inter 12px，`#555555`

---

## 7. 图标规范

统一使用 **Lucide** 图标字体（`iconFontFamily: "lucide"`）。

| 场景 | 尺寸 | 颜色 |
|------|------|------|
| Tab Bar 图标 | 16×16px | `#FFFFFF`（激活）/ `#555555`（非激活） |
| 搜索图标 | 16×16px | `#666666` |
| 导航栏操作图标 | 22–26px | `#FFFFFF` |
| 列表过滤图标 | 22×22px | `#888888` |
| Inbox 卡片图标 | 16×16px | `#888888` |
| AskQuestion info 图标 | 14×14px | `#555555` |
| 空状态 check 图标 | 36×36px | `#4CAF50` |
| 空状态 bell 图标 | 14×14px | `#555555` |

---

## 8. 反模式清单

| 禁止 | 原因 | 替代 |
|------|------|------|
| 使用白色或浅色背景 | 破坏深色沉浸感 | 使用 `#0D0D0D` / `#1A1A1A` |
| 滥用橙色 `#FF6B35` | 橙色是行动信号，过多会失去意义 | 仅用于 CTA、未读徽章、选中状态 |
| 使用绿色系颜色（旧设计遗留） | 新设计已切换为深色+橙色体系 | 使用新色板 |
| Tab Bar cornerRadius < 36px | 破坏胶囊形态 | cornerRadius 36px |
| 输入框 cornerRadius < 26px | 破坏圆润输入框风格 | cornerRadius 26px |
| 混用非指定字体 | 破坏界面一致性 | Anton / Inter |
| 使用 px 以外的间距单位 | 设计系统基于 4px 网格 | 使用规定的间距值 |
| 在非行动场景使用 `#FF6B35` | 稀释强调色语义 | 使用 `#888888` 或 `#DDDDDD` |

---

## 9. 检查清单

在提交任何 UI 变更前，过一遍：

- [ ] 所有颜色是否在色阶范围内？有没有硬编码非规范色值？
- [ ] 字体是否只使用 Anton / Inter？
- [ ] 字号是否符合规范（无随意像素值）？
- [ ] Tab Bar 是否 cornerRadius 36px，高度 62px？
- [ ] 输入框是否 cornerRadius 26px，高度 52px？
- [ ] 橙色 `#FF6B35` 是否仅用于行动/强调场景？
- [ ] 图标是否使用 Lucide，尺寸是否与文字匹配？
- [ ] 列表行高度是否为 72px？
- [ ] 底部 Sheet 是否有 `[20, 20, 0, 0]` 圆角和 Handle？
- [ ] 空状态是否有 check 图标 + 标题 + 副标题 + hint 行？
- [ ] 深色模式（本设计即暗色模式）是否正常？
