# Image Render & Fullscreen View SPEC

## 1. 背景与目标

AI（Claude Code 等）执行任务时会生成图片文件（截图、图表、可视化输出等），并在回复中以 Markdown 语法 `![alt](path)` 引用本地文件路径。当前 Mobile 端无法渲染这些图片，用户只能看到原始文本。

**目标**：
1. AI 知道如何正确输出图片引用（通过 `msctl agent register` 注入的模板告知）
2. msctl 能将本地图片文件通过 HTTP 提供给手机访问
3. Mobile 端能渲染图片缩略图并支持点击全屏查看

## 2. 范围

### 2.1 In Scope

- `cli/src/templates/commands.md` 新增「Image Output」段落，随 `msctl agent register` 注入到 AI 的 `CLAUDE.md`/`AGENTS.md`
- msctl 新增 `GET /api/v1/files?path=<encoded>` 接口（Bearer auth，防目录遍历）
- `MarkdownMessage` 新增 `image` render rule：缩略图 + 全屏 Modal
- Mobile 端 URL 转换：本地绝对路径 → `http://<endpoint>/api/v1/files?path=<encoded>`（带 Bearer token）
- 远程 HTTPS URL 图片直接渲染，不经过 msctl

### 2.2 Out of Scope

- 保存图片到 iOS 相册
- 图片分享
- 双指缩放（pinch-to-zoom）
- 非图片文件（PDF、视频、音频）
- 图片缓存/预加载优化
- Base64 内嵌图片

## 3. 用户与使用场景

**典型场景**：
1. 用户让 AI 生成一张架构图或数据可视化图表 → AI 保存为 `/tmp/chart.png` → 回复中包含 `![架构图](/tmp/chart.png)` → 手机上显示缩略图 → 点击全屏查看细节
2. AI 执行截图任务 → 保存到本地 → 回复中引用 → 用户在手机上查看截图

## 4. 技术实现

### 4.1 模板注入（`cli/src/templates/commands.md`）

在 `<!-- msctl-inject-end -->` 前新增段落：

```markdown
### Image Output

When generating images (charts, screenshots, diagrams), save them as files and
reference them in your reply using standard Markdown image syntax:

![description](/absolute/path/to/image.png)

Supported formats: png, jpg, jpeg, gif, webp.
The MultiSoul mobile app will automatically render these images inline.
```

### 4.2 CLI：文件服务接口

**路由**：`GET /api/v1/files`

**参数**：
- `path`（query string）：URL-encoded 绝对文件路径

**认证**：`Authorization: Bearer <token>`（与其他接口一致）

**响应**：
- 200：文件字节流，`Content-Type` 按扩展名推断（`image/png`、`image/jpeg`、`image/gif`、`image/webp`）
- 400：路径包含 `..` 或为空
- 404：文件不存在
- 415：文件类型不在允许列表（非图片）
- 401：未认证

**安全约束**：
- 拒绝包含 `..` 的路径（防目录遍历）
- 只允许图片扩展名：`png`、`jpg`、`jpeg`、`gif`、`webp`
- 路径必须为绝对路径（以 `/` 开头）

### 4.3 Mobile：URL 转换

在 `MarkdownMessage` 的 `image` render rule 中，检测图片 `src`：

| src 格式 | 处理方式 |
|---------|---------|
| 以 `/` 开头（绝对路径） | 转换为 `http://<currentEndpoint>/api/v1/files?path=<encoded>`，附带 Bearer token header |
| `https://` 开头 | 直接使用，无需 token |
| `http://` 开头 | 直接使用，无需 token |
| 其他 | 显示占位符 |

`currentEndpoint` 和 `token` 从 Zustand store（`useEndpointStore`）读取。

### 4.4 Mobile：图片渲染（`MarkdownMessage.tsx`）

**缩略图**：
- 宽度撑满气泡（`width: '100%'`），高度 200px
- `resizeMode="contain"`
- 外层 `<Pressable>` 点击触发全屏 Modal
- 加载失败时显示灰色占位符 + "Image unavailable" 文字

**全屏 Modal**：
- 黑色背景（`rgba(0,0,0,0.95)`）
- 图片 `resizeMode="contain"` 占满屏幕
- 右上角 X 按钮（与 `user_text` 全屏 Modal 样式一致）
- 底部显示 alt 文字（`#888888`，Inter 11px）

**状态管理**：
- `image` rule 是独立组件（`MarkdownImage`），内部持有 `previewVisible` state
- 避免将 Modal state 提升到 `MarkdownMessage` 层（每张图片独立管理）

## 5. 数据流

```
AI 回复: "![架构图](/Users/alan/tmp/arch.png)"
    ↓
react-native-markdown-display 解析 image 节点
    ↓
MarkdownImage 组件：检测 src 为绝对路径
    ↓
URL 转换: /Users/alan/tmp/arch.png
    → http://192.168.x.x:8765/api/v1/files?path=%2FUsers%2Falan%2Ftmp%2Farch.png
    + Authorization: Bearer <token>
    ↓
Image 组件加载
    ↓
msctl 验证 token → 读取本地文件 → 返回图片字节
    ↓
手机显示缩略图
```

## 6. 验收标准

- [ ] `msctl agent register` 后，项目的 `CLAUDE.md`/`AGENTS.md` 包含「Image Output」段落
- [ ] `GET /api/v1/files?path=/tmp/test.png`（有效 token）返回 200 + 图片字节
- [ ] `GET /api/v1/files?path=../etc/passwd` 返回 400
- [ ] `GET /api/v1/files?path=/tmp/test.txt` 返回 415
- [ ] `GET /api/v1/files?path=/tmp/nonexistent.png` 返回 404
- [ ] `GET /api/v1/files` 无 token 返回 401
- [ ] AI 回复中 `![alt](/path/to/img.png)` 在手机上显示为缩略图，不显示原始文本
- [ ] 点击缩略图弹出全屏 Modal，右上角 X 关闭，底部显示 alt 文字
- [ ] 远程 HTTPS URL 图片直接渲染，不经过 msctl
- [ ] 图片加载失败时显示占位符，不崩溃
- [ ] `pnpm typecheck` 通过
- [ ] `pnpm test -- --watchAll=false` 通过
- [ ] `cargo test` 通过
- [ ] `cargo build` 通过
