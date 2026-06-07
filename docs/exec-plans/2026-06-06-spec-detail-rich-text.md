# Exec Plan: Spec 详情 Artifact Snapshot 富文本渲染

**Date**: 2026-06-06  
**Spec**: `docs/product-specs/2026-06-06-SPEC-spec-detail-rich-text.md`  
**Status**: pending

---

## 背景

`SpecMarkdownReader` 当前用行级解析器（`lineKind` / `cleanLine`），仅支持 h1/h2/bullet/code 粗粒度样式，不支持内联格式（粗体、斜体、行内代码、链接）、表格等 GFM 特性。

Chat 模块已有 `MarkdownMessage`（`react-native-markdown-display` + 自定义规则），可直接复用。

---

## 涉及文件

| 文件 | 改动类型 |
|------|----------|
| `mobile/src/features/chat/index.ts` | 新增 `MarkdownMessage` 公开导出 |
| `mobile/src/features/specs/components/SpecMarkdownReader.tsx` | 核心重写 |
| `mobile/src/features/specs/components/SpecDetailScreen.test.tsx` | 更新断言（适应新渲染行为） |

不改动：`SpecDetailScreen.tsx`（Props 接口不变）、`MarkdownMessage.tsx`（不修改上游）

---

## 任务

### Task 1 — 公开导出 `MarkdownMessage`

**文件**: `mobile/src/features/chat/index.ts`

在文件末尾添加一行：

```ts
export { MarkdownMessage } from './components/MarkdownMessage';
```

原因：`features/specs` 跨域引用 `features/chat` 必须走公共入口，不能深路径 import。

---

### Task 2 — 重写 `SpecMarkdownReader.tsx`

**文件**: `mobile/src/features/specs/components/SpecMarkdownReader.tsx`

**移除**：
- `lineKind` / `cleanLine` 函数
- 行级 `Text` 渲染逻辑
- `StyleSheet`（保留 empty state 样式即可）

**新增**：
- `COLLAPSED_CHAR_LIMIT = 600`（常量）
- `truncateMarkdown(md, limit)` 纯函数：
  - 原文 ≤ 600 字符 → 返回原文
  - 原文 > 600 字符 → 从第 600 字符往前找最近 `\n`，截断后追加 `\n\n*…full snapshot continues below.*`
- 从 `@/features/chat` import `MarkdownMessage`

**渲染逻辑**：
```tsx
function SpecMarkdownReader({ markdown, collapsed = false }: Props) {
  const md = markdown ?? '';
  if (md.trim().length === 0) return <EmptyState />;
  const content = collapsed ? truncateMarkdown(md, COLLAPSED_CHAR_LIMIT) : md;
  return <MarkdownMessage content={content} />;
}
```

**样式**：外层不加背景色（由 SpecDetailScreen Section 卡片提供）。保留 empty state 的 View 样式（`borderRadius`, `borderWidth`, `borderColor`, `backgroundColor: brandRgba.ink08`）。

**字号**：接受 `MarkdownMessage` 默认 15px body（spec 文档注明"视 API 而定"；MarkdownMessage 不对外暴露 style 覆盖，接受 15px 是合规选择）。

---

### Task 3 — 更新 `SpecDetailScreen.test.tsx`

**文件**: `mobile/src/features/specs/components/SpecDetailScreen.test.tsx`

**问题根因**：`react-native-markdown-display` mock 把整段 markdown 渲染为单一 Text 节点，`getByText('Persist the asset snapshot.')` 精确匹配失败。

**修改**：将 line 62 的断言改为 regex 匹配：

```tsx
// before
expect(getByText('Persist the asset snapshot.')).toBeTruthy();
// after
expect(getByText(/Persist the asset snapshot/)).toBeTruthy();
```

无需其他测试改动（其余断言检查标题、metadata、按钮，不涉及 markdown 内容）。

---

## 验证步骤

全部完成后统一运行：

```bash
cd mobile && pnpm typecheck
cd mobile && pnpm test -- --watchAll=false
```

两项全通过后执行一次 `git commit`。

---

## 风险评估

| 风险 | 程度 | 说明 |
|------|------|------|
| Props 接口破坏 | 无 | `SpecDetailScreen` Props 不变 |
| 颜色合规 | 低 | `MarkdownMessage` 已在 chat 中通过 CI；empty state 沿用原有颜色 |
| Mermaid 触发 | 可接受 | Spec 内容通常无 mermaid；即便有也是 lazy load，不影响性能 |
| 字号差异 | 可接受 | 15px vs 13px，spec 注明"视 API 而定" |
