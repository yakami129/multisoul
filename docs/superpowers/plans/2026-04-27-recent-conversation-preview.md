# Recent 会话列表预览优化 SPEC

**日期：** 2026-04-27  
**状态：** 已完成

---

## 背景与目标

Recent 列表原本用后端生成的 `title` 字段作为预览文字，信息量低、辨识度差。  
目标：让每条会话一眼就能看出"问了什么、AI 回了什么"。

---

## 范围

### In Scope
- `Conversation` 类型新增两个可选字段
- `ChatHomeScreen` 列表行展示逻辑更新
- 搜索过滤覆盖新字段

### Out of Scope
- 后端接口改动（后端已返回字段，本次纯前端消费）
- 其他使用 `Conversation` 类型的页面

---

## 数据模型变更

**文件：** `mobile/src/types.ts`

```typescript
export interface Conversation {
  // ...existing fields...
  first_user_message?: string;  // 用户第一条消息内容（后端返回）
  last_ai_reply?: string;       // 最后一条 AI 回复内容（后端返回）
}
```

两个字段均为可选，兼容旧数据。

---

## UI 变更

**文件：** `mobile/src/features/chat/components/ChatHomeScreen.tsx`

### 列表行布局（每行 3 行文字）

| 位置 | 内容 | 样式 |
|------|------|------|
| 顶行左 | `agent_name` | Anton 14px `#20C20E` |
| 顶行右 | 时间戳 | Inter 11px `#0F6B0F` |
| 第二行 | `first_user_message`（为空时留白） | Geist 13px `#2D8B2D` |
| 第三行 | `last_ai_reply`（无回复时不渲染） | Geist 12px `#147A16` |

### 省略规则
- `last_ai_reply` 超过 **50 字符**截断加 `...`
- 两行均使用 `numberOfLines={1}` 防止换行溢出

### 行高
- 72px → **80px**（容纳第三行）

### 搜索
- 过滤条件新增 `first_user_message` 字段

---

## 实现细节

```typescript
// 截断 helper
const truncate = (s: string, max = 50) =>
  s.length > max ? s.slice(0, max) + '...' : s;

// 渲染
<Text style={s.lastMessage} numberOfLines={1}>
  {item.first_user_message ?? ''}
</Text>
{item.last_ai_reply ? (
  <Text style={s.description} numberOfLines={1}>
    {truncate(item.last_ai_reply)}
  </Text>
) : null}
```

---

## 边界情况

| 场景 | 处理 |
|------|------|
| 会话刚创建，无用户消息 | 标题行留白 |
| AI 尚未回复 | 描述行不渲染 |
| AI 回复超 50 字符 | 截断 + `...` |
| 旧数据无新字段 | 两个字段均为 `undefined`，等同上述两种情况 |

---

## 文件变更清单

- `mobile/src/types.ts` — `Conversation` 接口新增 2 个可选字段
- `mobile/src/features/chat/components/ChatHomeScreen.tsx` — 展示逻辑、样式、搜索更新
