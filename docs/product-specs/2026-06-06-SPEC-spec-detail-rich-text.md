# SPEC: Spec 详情 Artifact Snapshot 富文本渲染

**Date**: 2026-06-06  
**Status**: Draft  
**Slug**: spec-detail-rich-text

---

## 背景与问题

`SpecMarkdownReader` 目前使用自定义行级解析器，仅支持 h1/h2、bullet、code block 的粗粒度样式，**不支持内联格式**（粗体、斜体、行内代码、链接）、表格、嵌套列表等 GFM 特性。

用户在 "Artifact Snapshot" 区域看到的是纯文本效果，丢失了 AI 生成 spec 文件中的结构与强调信息，可读性差。

Chat 模块已用 `react-native-markdown-display` + 自定义 `MarkdownMessage` 实现完整 GFM 渲染，可直接复用。

---

## 目标

用 `MarkdownMessage` 组件替换 `SpecMarkdownReader` 内部的行级解析器，使 Spec 详情的 Artifact Snapshot 区域支持完整 GFM 富文本渲染。

---

## 非目标

- Idea 详情页的 Notes / body 区域（`IdeaDetailScreen`）——不在本次范围
- 新增 Mermaid 渲染（specs 内容通常无 Mermaid，维持现状不调用 Mermaid 路径）
- 修改 "Read full snapshot / Collapse snapshot" 触发逻辑（按钮和 `showFullMarkdown` 状态保持不变）
- 修改 `SpecDetailScreen` 的 Props 接口

---

## 受影响范围

| 文件 | 改动 |
|------|------|
| `mobile/src/features/specs/components/SpecMarkdownReader.tsx` | 核心重写：移除行级解析器，改用 `MarkdownMessage` |
| `mobile/src/features/specs/components/SpecDetailScreen.test.tsx` | 若有快照测试需要更新 |

调用 `SpecMarkdownReader` 的地方（`SpecDetailScreen.tsx`）接口不变，无需改动。

---

## 主要流程

### 渲染流程

1. `SpecDetailScreen` 传入 `markdown?: string` 和 `collapsed: boolean` 给 `SpecMarkdownReader`
2. `SpecMarkdownReader` 内部：
   - 若 `collapsed=true`：截取 markdown 字符串前 **600 字符**，末尾追加 `\n\n…` 省略标记
   - 若 `collapsed=false`：使用完整 markdown 字符串
3. 将处理后的字符串传给 `MarkdownMessage` 渲染
4. 外层用 `View` 包裹，背景色跟随设计系统（白色卡片，与 chat 气泡深色背景解耦）

### collapsed 截断规则

- 目标字符数：600（可在常量中定义，便于调整）
- 截断点：从第 600 字符往前找最近的换行符 `\n`，避免在 markdown 语法中间截断
- 若原文不足 600 字符，直接显示全文（不加省略标记）
- 若有截断，在末尾追加 `\n\n*…full snapshot continues below.*`

---

## UI / UX 要求

| 特性 | 要求 |
|------|------|
| 内联粗体 `**text**` | 加粗显示 |
| 内联斜体 `*text*` | 斜体显示 |
| 内联代码 `` `code` `` | 高亮背景，与 chat 一致 |
| 链接 `[text](url)` | 可点击，点击后 `Linking.openURL` 打开系统浏览器 |
| 表格 | 正确渲染；宽表格支持横向滚动（`ScrollView horizontal`） |
| 嵌套列表 | 正确缩进 |
| 代码块 ` ``` ` | 背景卡片 + Copy 按钮（右上角），与 chat 保持一致 |
| 背景色 | 外层 View 使用 `brandRgba.white88` / `brandColors.cream`，适配白色卡片 |
| 文字颜色 | 继承 `brandColors.ink`，与卡片其他文本一致 |
| 字号 | body 文字 13px，与当前 `SpecMarkdownReader` 保持一致（可通过覆盖 `mdStyles` 实现）|

---

## 边界情况

| 场景 | 处理方式 |
|------|----------|
| `markdown` 为空或 undefined | 显示 "No markdown snapshot is cached yet."（保持现有 empty state）|
| markdown 内含图片 `![alt](src)` | 不注入 serverUrl/token（specs 内容一般无服务器相对路径图片），图片回退到默认 `<Image>` 渲染 |
| markdown 内含 mermaid 代码块 | 渲染为普通代码块（不触发 Mermaid 渲染路径） |
| 非常长的表格（宽列数多） | 横向 ScrollView 兜底，不截断 |
| collapsed 截断落在代码块内 | 找最近换行截断后，末尾追加省略标记；可能留下不完整代码块，可接受（展开后完整显示）|

---

## 验收标准

1. **内联格式**：Artifact Snapshot 区域中 `**粗体**`、`*斜体*`、`` `inline code` `` 均正确渲染（视觉可区分）
2. **链接**：`[text](url)` 渲染为可点击文字，点击后打开系统浏览器；URL 不会直接裸显
3. **表格**：Markdown 表格正确渲染行/列；宽表格左右可滚动
4. **代码块**：代码块显示复制按钮，点击后系统剪贴板中含代码内容
5. **collapsed 截断**：
   - 原文 > 600 字符时，collapsed 模式显示截断后内容 + 省略提示
   - 原文 ≤ 600 字符时，collapsed 与 expanded 显示相同，无省略提示
6. **expand**："Read full snapshot" 点击后显示完整 markdown 内容
7. **empty state**：`markdown` 为空时显示占位文字，不崩溃
8. **回归**：`pnpm typecheck` 与 `pnpm test --watchAll=false` 全部通过
9. **颜色合规**：新增颜色仅使用 `mobile/docs/design.md §2` 白名单内的色值

---

## 实现说明（给开发者）

### SpecMarkdownReader 改动要点

```tsx
// 移除：自定义 lineKind / cleanLine 逻辑
// 新增：import { MarkdownMessage } from '@/features/chat/components/MarkdownMessage'

const COLLAPSED_CHAR_LIMIT = 600;

function truncateMarkdown(md: string, limit: number): string {
  if (md.length <= limit) return md;
  const cutoff = md.lastIndexOf('\n', limit);
  const end = cutoff > 0 ? cutoff : limit;
  return md.slice(0, end) + '\n\n*…full snapshot continues below.*';
}
```

- 外层 View 不设背景色（由 `SpecDetailScreen` 的 Section 卡片提供）
- 字号覆盖：在 `MarkdownMessage` 外包一层，或通过 `style` prop 覆盖 body fontSize 为 13px（视 API 而定）

### 跨 feature 引用说明

`MarkdownMessage` 位于 `features/chat/components/`，从 `features/specs/components/` 引用属于跨 feature 访问。  
需检查 `mobile/docs/design.md` 与 feature 边界约束：若需要，将 `MarkdownMessage` 提升至 `src/components/` 共享目录，或通过 `features/chat/index.ts` 公共入口导出后再引用。
