# MultiSoul — Vault-Tec Terminal UI Design System

本文档定义 MultiSoul PIP-BOY 终端界面的视觉语言与交互规范。所有 UI 开发以此为准。

---

## 1. 设计哲学

三条核心原则：

1. **终端即美学。** 界面模拟 Fallout 系列 PIP-BOY 3000 MKIV 的 CRT 绿色磷光屏风格。每个元素都应强化"你在操作一台真实终端"的沉浸感。
2. **层次靠亮度，颜色是信号。** 界面主体是深绿色调。亮绿（`#20C20E`）用于主要内容和强调，中绿（`#2D8B2D`）用于次要信息，暗绿（`#147A16`、`#0F6B0F`）用于辅助文字。
3. **克制的复古感。** 不过度堆砌特效。CRT 扫描线、角落标记符、等宽字体——每个细节都有意义，不做无谓装饰。

---

## 2. 颜色体系

所有颜色基于磷光绿 CRT 显示器的色彩模拟。

### 2.1 背景色阶

| 角色 | 色值 | 用途 |
|------|------|------|
| 主背景 | `#040D04` | 页面底色、文字面板背景 |
| 卡片表面 | `#061206` | 卡片、导航栏、状态栏背景 |
| 深层表面 | `#0A1A0A` | 卡片头部、交替行背景 |
| 边框/分割线 | `#0F2B0F` | 所有边框、分割线、分隔矩形 |

### 2.2 文字色阶

| 角色 | 色值 | 用途 |
|------|------|------|
| 主要文字 | `#20C20E` | 标题、主要内容、激活状态 |
| 高亮文字 | `#33FF33` | 数值、徽章文字、强调数据 |
| 次要文字 | `#2D8B2D` | 图标、次要标签、eyebrow 文字 |
| 正文文字 | `#147A16` | 段落正文、导航项、描述文字 |
| 辅助文字 | `#0F6B0F` | 页脚文字、键盘提示、版本号 |

### 2.3 语义色

| 色值 | 含义 | 使用场景 |
|------|------|----------|
| `#20C20E` | 激活/主要 | 主按钮背景、主标题、激活状态 |
| `#33FF33` | 数据/在线 | 实时数值、ONLINE 徽章、进度数据 |
| `#040D04` | 按钮文字 | 主按钮上的反色文字 |

---

## 3. 字体规范

### 3.1 字体家族

| 角色 | 字体 | 用途 |
|------|------|------|
| 展示标题 | Anton | 大标题、卡片标题、按钮文字 |
| 界面文字 | Inter | 导航、标签、eyebrow、辅助文字 |
| 正文内容 | Geist | 段落描述、设置项、正文 |
| 终端输入 | Geist Mono | 命令行输入框、等宽数据 |

### 3.2 字号规范

| 场景 | 字号 | 字体 | 字重 | 用途 |
|------|------|------|------|------|
| 超大标题 | 120px | Anton | normal | Hero 主标题（VAULT-TEC） |
| 大标题 | 52px | Anton | normal | 内容区块标题 |
| 卡片标题 | 13–14px | Anton | normal | 卡片头部、按钮文字 |
| 品牌标识 | 18px | Anton | 700 | 导航栏 Logo |
| 副标题 | 16px | Inter | normal | Hero 副标题 |
| 正文 | 15px | Geist | normal | 内容区段落 |
| 界面默认 | 13px | Inter/Geist | normal | 导航项、设置项、列表 |
| 终端文字 | 16px | Geist Mono | normal | 命令行输入框 |
| 状态栏 | 12px | Inter | normal | 状态栏统计数据 |
| 辅助标签 | 11px | Inter | 500 | Eyebrow 标签 |
| 最小文字 | 10px | Inter | normal/600 | 徽章、页脚提示、键盘快捷键 |

### 3.3 字间距（Letter Spacing）

| 场景 | 值 | 用途 |
|------|-----|------|
| 超大标题 | 8px | Hero 主标题 |
| 品牌/标题 | 2px | Logo、卡片标题 |
| 导航/标签 | 1–1.5px | 导航项、eyebrow、状态栏 |
| 徽章 | 1.5px | ONLINE 徽章文字 |

### 3.4 行高

| 场景 | lineHeight | 用途 |
|------|-----------|------|
| 大标题 | 1.1 | 52px 内容标题 |
| 正文 | 1.6 | 15px 段落描述 |
| 提示文字 | 1.5 | 13px tips 列表 |

---

## 4. 间距体系

基于 4px 网格。

### 4.1 组件内间距

| 间距 | 用途 |
|------|------|
| 4px | 品牌名与副标题间距（footerLeft gap） |
| 6px | 链接图标与文字间距 |
| 8px | Eyebrow 图标与文字间距 |
| 12px | Tips 列表项间距、卡片内行间距 |
| 14px | 卡片 Body 内行间距 |
| 16px | 按钮组间距、卡片间距 |
| 20px | 内容区块 gap（eyebrow/heading/body/action） |
| 24px | 导航项间距、Hero 中心区 gap、键盘提示间距 |
| 32px | 状态栏项间距、页脚左右 padding |

### 4.2 容器 Padding

| 容器 | Padding | 说明 |
|------|---------|------|
| 导航栏 | `[0, 32]` | 上下0，左右32 |
| Hero 中心区 | `[40, 80]` | 上下40，左右80 |
| 内容行面板 | `60px` | 四边均60 |
| 卡片 Body | `20px` | 四边均20 |
| 卡片头部/页脚 | `[0, 16]` | 上下0，左右16 |
| 主按钮 | `[12, 24]` | 上下12，左右24 |
| 徽章 | `[4, 10]` | 上下4，左右10 |
| 终端输入框 | `[16, 20]` | 上下16，左右20 |
| 页脚 | `[0, 80]` | 上下0，左右80 |

---

## 5. 布局结构

### 5.1 Hero Section（`dTC73`）— 1440×900px

```
┌─────────────────────────────────────────────────────┐
│ NavBar (48px)                                        │
│  Logo ←————————————————————→ Nav Items + CTA Button │
├─────────────────────────────────────────────────────┤
│ Center Area (fill)                                   │
│  [+]                                           [+]  │
│                                                      │
│              VAULT-TEC  (120px Anton)                │
│       PIP-BOY 3000 MKIV TERMINAL v2.1.0             │
│         ┌──────────────────────────┐                 │
│         │ > ENTER COMMAND_         │                 │
│         └──────────────────────────┘                 │
│  [+]                                           [+]  │
├─────────────────────────────────────────────────────┤
│ Status Bar (36px)                                    │
│  CTX: ████░░ 78% | OUT: ██░░ 61% | CSH: ░░ 42% | $ │
└─────────────────────────────────────────────────────┘
```

**Scanlines overlay：** 渐变矩形（透明→黑色33%→透明），opacity 0.4，绝对定位覆盖全区。

### 5.2 Content Section（`6yDen`）— 1440×1800px

每行高 480px，左右各 720px，交替排列图片面板与文字面板。

```
┌──────────────────────────────────────────────────────┐
│ Row1 - PIP-BOY Monitor (480px)                        │
│  [Image Panel: PIP-BOY Card] | [Text Panel]           │
├──────────────────────────────────────────────────────┤
│ Divider (1px, #0F2B0F)                                │
├──────────────────────────────────────────────────────┤
│ Row2 - Settings (480px)                               │
│  [Text Panel] | [Image Panel: Settings Dialog]        │
├──────────────────────────────────────────────────────┤
│ Divider (1px, #0F2B0F)                                │
├──────────────────────────────────────────────────────┤
│ Row3 - Tips (480px)                                   │
│  [Image Panel: Tips Card] | [Text Panel]              │
├──────────────────────────────────────────────────────┤
│ Divider (1px, #0F2B0F)                                │
├──────────────────────────────────────────────────────┤
│ Footer (80px)                                         │
│  Logo + Tagline ←——————————→ Nav Links               │
└──────────────────────────────────────────────────────┘
```

### 5.3 文字面板结构（通用）

每个文字面板包含四层，垂直排列，gap 20px：

1. **Eyebrow** — 图标 + 全大写标签（Inter 11px/500，#2D8B2D，letterSpacing 2）
2. **Heading** — 两行大标题（Anton 52px，#20C20E，lineHeight 1.1，width 540px）
3. **Body** — 描述段落（Geist 15px，#147A16，lineHeight 1.6，width 540px）
4. **Action** — 主按钮 + 文字链接（gap 16px）

---

## 6. 组件规范

### 6.1 导航栏（NavBar）

- 高度：48px，宽度：fill_container
- 背景：`#061206`，底部边框：`#0F2B0F` 1px inside
- 布局：horizontal，space_between，padding `[0, 32]`
- Logo：Anton 18px/700，`#20C20E`，letterSpacing 2
- 导航项：Inter 13px，`#147A16`，letterSpacing 1，gap 24px
- 分隔符：`|`，Inter 13px，`#0F2B0F`
- CTA 按钮：Inter 12px/700，`#040D04` on `#20C20E`，cornerRadius 2，padding `[8, 16]`

### 6.2 主按钮（Primary Button）

- 背景：`#20C20E`，cornerRadius 2
- 文字：Anton 13px，`#040D04`，letterSpacing 1
- Padding：`[12, 24]`
- 无边框，无阴影

### 6.3 文字链接（Text Link）

- 布局：horizontal，alignItems center，gap 6px
- 文字：Inter 13px，`#2D8B2D`，letterSpacing 0.5
- 图标：lucide `arrow-right`，14×14px，`#2D8B2D`

### 6.4 Eyebrow 标签

- 布局：horizontal，alignItems center，gap 8px
- 图标：lucide 图标，14×14px，`#2D8B2D`
- 文字：Inter 11px/500，`#2D8B2D`，letterSpacing 2，全大写

### 6.5 卡片（Terminal Card）

- 背景：`#061206`，边框：`#0F2B0F` 1px inside
- 布局：vertical，width 480px
- **头部**：高度 44px，背景 `#0A1A0A`，padding `[0, 16]`，底部边框 `#0F2B0F`
  - 标题：Anton 13px，`#20C20E`，letterSpacing 1
  - 徽章：Inter 10px/600，`#33FF33`，背景 `#0F2B0F`，cornerRadius 2，padding `[4, 10]`
- **Body**：padding 20px，gap 14px，layout vertical
- **页脚**：高度 36px，背景 `#040D04`，顶部边框 `#0F2B0F`，padding `[0, 16]`
  - 文字：Inter 10px，`#0F6B0F`，letterSpacing 1

### 6.6 进度条行（Metric Row）

- 布局：vertical，gap 6px，width fill_container
- 标签行：horizontal，space_between
- 进度条：高度 8px，背景 `#0A1A0A`，cornerRadius 1

### 6.7 设置对话框（Settings Dialog）

- 与卡片相同的外框样式
- 设置行：高度 44px，padding `[0, 16]`，space_between
  - 标签：Geist 13px，`#20C20E`
  - 值/徽章：Geist 13px，`#33FF33` 或徽章组件
  - 交替行背景：`#040D04`（偶数行）
- 键盘提示页脚：Inter 10px，`#0F6B0F`，letterSpacing 1，gap 24px

### 6.8 Tips 卡片

- 与卡片相同外框，头部显示 "VAULT TIP" + 圆点指示器
- Tips 列表：vertical，gap 12px，padding 20px
- 每条 tip：horizontal，gap 12px
  - 圆点：`●`，Inter 10px，`#20C20E`
  - 文字：Geist 13px，`#147A16`，lineHeight 1.5，width 400px，fixed-width

### 6.9 终端输入框（Terminal Box）

- 背景：`#061206`，边框：`#0F2B0F` 1px inside，cornerRadius 2
- 文字：`> ENTER COMMAND_`，Geist Mono 16px，`#20C20E`，letterSpacing 1
- Padding：`[16, 20]`，width 600px

### 6.10 状态栏（Status Bar）

- 高度 36px，背景 `#061206`，顶部边框 `#0F2B0F`
- 布局：horizontal，center，gap 32px
- 统计项：Inter 12px，`#20C20E`，letterSpacing 1
- 分隔符：`|`，Inter 12px，`#0F2B0F`

### 6.11 页脚（Footer）

- 高度 80px，背景 `#061206`，padding `[0, 80]`
- 布局：horizontal，space_between，alignItems center
- 左侧：vertical，gap 4px
  - 品牌名：Anton 14px，`#20C20E`，letterSpacing 2
  - 副标语：Inter 10px，`#0F6B0F`，letterSpacing 1.5
- 右侧：horizontal，gap 32px
  - 链接：Inter 11px，`#2D8B2D`，letterSpacing 1

---

## 7. 图标规范

统一使用 **Lucide** 图标字体（`iconFontFamily: "lucide"`）。

| 场景 | 尺寸 | 颜色 |
|------|------|------|
| Eyebrow 图标 | 14×14px | `#2D8B2D` |
| 文字链接箭头 | 14×14px | `#2D8B2D` |
| 设置关闭按钮 | 16×16px | `#2D8B2D` |

图标颜色始终与同行文字颜色一致。

---

## 8. 特效规范

### 8.1 扫描线（Scanlines）

Hero Section 顶层覆盖一个渐变矩形模拟 CRT 扫描线：
- 类型：linear gradient，rotation 90°
- 颜色：`#00000000` → `#00000033`（50%）→ `#00000000`
- 尺寸：1440×900px，绝对定位 (0, 0)
- Opacity：0.4

### 8.2 文字发光（Glow）

Hero 主标题使用外发光阴影：
- type: shadow，shadowType: outer
- color: `#20C20E88`（50% 透明度绿色）
- blur: 24px
- offset: (0, 0)，spread: 0

### 8.3 角落标记符

Hero 中心区四角放置 `[+]` 文字标记（Inter 12px，`#147A16`），绝对定位：
- 左上：(0, 0)
- 右上：(1280, 0)
- 左下：(0, 720)
- 右下：(1280, 720)

---

## 9. 内容区块规范

### 9.1 交替布局规则

内容区三行采用左右交替排列：
- Row1（PIP-BOY Monitor）：图片面板左，文字面板右
- Row2（Settings）：文字面板左，图片面板右
- Row3（Tips）：图片面板左，文字面板右

### 9.2 图片面板

- 宽度：720px，高度：fill_container
- 背景：`#061206`
- 布局：vertical，justifyContent center，alignItems center，padding 60px，gap 16px

### 9.3 文字面板

- 宽度：720px，高度：fill_container
- 背景：`#040D04`
- 布局：vertical，justifyContent center，padding 60px，gap 20px

---

## 10. 反模式清单

| 禁止 | 原因 | 替代 |
|------|------|------|
| 使用非绿色系颜色 | 破坏终端沉浸感 | 坚持绿色色阶 |
| 使用圆角 > 2px（卡片除外） | 终端风格偏方正 | cornerRadius 2 |
| 使用阴影（发光除外） | 拟物风格 | 用边框分隔层级 |
| 使用 font-bold 在 Anton 字体上 | Anton 本身已有视觉重量 | fontWeight: normal |
| 使用白色或浅色背景 | 破坏 CRT 风格 | 深绿色背景 |
| 混用非指定字体 | 破坏终端一致性 | Anton / Inter / Geist / Geist Mono |
| 使用 px 以外的间距单位 | 设计系统基于 4px 网格 | 使用规定的间距值 |

---

## 11. 检查清单

在提交任何 UI 变更前，过一遍：

- [ ] 所有颜色是否在色阶范围内？有没有硬编码非绿色系色值？
- [ ] 字体是否只使用 Anton / Inter / Geist / Geist Mono？
- [ ] 字号是否符合规范（无随意像素值）？
- [ ] 卡片边框是否使用 `#0F2B0F` 1px inside？
- [ ] 主按钮是否 cornerRadius 2，无阴影？
- [ ] 图标是否使用 Lucide，尺寸是否与文字匹配？
- [ ] 内容行是否 480px 高，左右各 720px？
- [ ] 文字面板 gap 是否为 20px，padding 是否为 60px？
- [ ] 扫描线 overlay 是否在 Hero Section 顶层？
- [ ] Dark 模式（本设计即暗色模式）是否正常？
