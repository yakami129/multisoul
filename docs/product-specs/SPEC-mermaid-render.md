# Mermaid 流程图渲染 SPEC

## 1. 背景与目标

chat 对话中经常出现 Mermaid 格式的流程图代码，目前只能显示原始代码，无法直观理解。本功能让 ` ```mermaid ` 代码块在 chat 消息中直接渲染为可交互的图形。

## 2. 范围

### 2.1 In Scope

- 识别消息内容中的 ` ```mermaid ` 代码块并渲染为图形
- 支持所有常见 Mermaid 图表类型（flowchart、sequenceDiagram、classDiagram、gantt、stateDiagram 等）
- 消息气泡内显示缩略图（内容自适应高度）
- 点击缩略图进入全屏模式
- 全屏模式支持：双指缩放、平移、重置按钮、关闭退出
- 语法错误时回退显示原始代码块

### 2.2 Out of Scope

- 图形编辑（只读渲染）
- 图形导出/分享
- 其他图表库（D3、ECharts 等）

## 3. 用户与使用场景

**典型场景**：用户与 AI Agent 讨论系统架构、工作流程时，Agent 回复包含 Mermaid 流程图，用户需要直观查看图形内容，并在全屏下仔细阅读细节。

## 4. 技术实现

### 4.1 渲染方案：WebView + mermaid.js

- 使用 `react-native-webview`（项目已有或需新增依赖）
- WebView 内加载 mermaid.js（本地 bundle，不依赖 CDN，离线可用），渲染 SVG 输出
- 渲染完成后通过 `postMessage` 将 SVG 尺寸回传给 RN 层，用于自适应高度

### 4.2 组件结构

```
MermaidBlock
├── MermaidPreview（内联缩略图，WebView 渲染）
│   └── 点击 → 打开 MermaidFullscreen
└── MermaidFullscreen（Modal 全屏）
    ├── WebView（同一 Mermaid 代码，全屏渲染）
    ├── 手势层（react-native-gesture-handler：双指缩放 + 平移）
    ├── 重置按钮
    └── 关闭按钮
```

### 4.3 消息解析

在现有 Markdown 渲染管道中，识别 ` ```mermaid ` 代码块，替换为 `MermaidBlock` 组件，其余代码块保持原有渲染。

### 4.4 错误处理

- mermaid.js 渲染失败时，WebView 通过 `postMessage` 上报错误
- RN 层捕获后切换为原始代码块展示（与普通 ` ```code ` 块样式一致）

## 5. UI/UX 规范

遵循 `mobile/docs/design.md` 设计系统：

| 元素 | 规范 |
|------|------|
| 缩略图背景 | `#1A1A1A`（card surface） |
| 缩略图圆角 | 12px |
| 缩略图高度 | 内容自适应，最小 80px |
| 全屏背景 | `#0D0D0D` |
| 重置/关闭按钮 | Lucide 图标，16×16px，颜色 `#888888` |
| 点击提示 | 缩略图右下角显示放大图标（`#FF6B35`） |

## 6. 边界情况

| 场景 | 处理 |
|------|------|
| Mermaid 语法错误 | 回退显示原始代码块 |
| 网络不可用 | 使用本地 bundle，不依赖网络 |
| 超大图形（节点极多） | 全屏模式下可缩放查看，缩略图按比例缩小 |
| 消息列表滚动性能 | WebView 懒加载，仅可见区域渲染 |

## 7. 非功能性需求

- mermaid.js 使用本地 bundle，不依赖外部 CDN，离线可用
- WebView 渲染不阻塞消息列表滚动（异步渲染）
- 新增依赖：`react-native-webview`（如未安装）、`react-native-gesture-handler`（如未安装）

## 8. 验收标准

- [ ] ` ```mermaid ` 代码块渲染为图形，不显示原始代码
- [ ] 点击图形弹出全屏 Modal
- [ ] 全屏支持双指缩放和平移
- [ ] 全屏有重置按钮，点击后图形回到初始大小和位置
- [ ] 全屏可通过关闭按钮或返回手势退出
- [ ] Mermaid 语法错误时显示原始代码块
- [ ] flowchart、sequenceDiagram 等常见类型均可正常渲染
