# 归档 Idea 永久删除 SPEC

## 1. 背景与目标

Ideas to Specs 重构后，Specs Tab 的 Ideas 段支持 Archive / Unarchive，但 Archived 区只能恢复、不能永久删除。`save-spec` 成功后 Idea 会自动归档；用户手动归档的废弃草稿也会持续堆积。当前本地 SQLite 虽有 `deleteIdea()` repository 方法，但未接入 `specStore`、UI 或 CLI REST API。

本规格目标是为 **已归档** 的 Idea 增加永久删除能力，减轻 Archived 区负担，并与 Spec 列表左滑 DELETE 保持一致的交互心智。

```text
Archived Idea 左滑 Delete → 二次确认 → 本地 + CLI 永久删除 → 列表刷新
```

## 2. 范围

### 2.1 In Scope

- 仅 `status === 'archived'` 的 Idea 可删除。
- 删除入口：Specs Tab → Ideas → 展开 Archived 区后，列表行左滑 Delete。
- 删除前弹出 iOS `Alert` 二次确认。
- 本地 SQLite 删除 Idea 记录，并同步 CLI `DELETE /api/v1/spec-ideas/:id`。
- CLI 级联删除 `spec_idea_notes`、`spec_idea_attachments`。
- 删除成功后广播 `spec_changed`，手机端列表即时刷新。

### 2.2 Out of Scope

- `open`、`interviewing`、`converted`、`failed` 状态的 Idea 删除。
- Idea 详情页 Delete 按钮。
- 删除关联 Spec（repo 内 `docs/product-specs/*.md` 与 artifact 快照不动）。
- 删除 Interview Chat 会话记录。
- 批量删除、软删除 / 回收站、自动过期清理。
- 删除后 Undo 恢复（V1 与 Spec 删除一致，不做 Undo）。

## 3. 用户与使用场景

### 3.1 典型用户

- 使用 MultiSoul 在手机端捕捉需求想法、经采访生成 Spec 的个人开发者。
- Archived 区积累了误归档草稿、测试数据或已不再需要追溯的 Idea，希望清理列表的用户。

### 3.2 关键场景

1. 用户进入 Specs Tab → Ideas，展开 Archived 区。
2. 用户对某条 archived Idea 左滑，看到 Delete action。
3. 用户点击 Delete，弹出确认对话框。
4. 用户确认后，Idea 从 Archived 列表消失，计数更新。
5. 若该 Idea 曾关联 Spec，Spec 仍可正常打开与实施；来源 Idea 链接显示为已删除或不可跳转。

## 4. 业务流程

### 4.1 删除流程

```text
1. 用户展开 Archived 区
2. 左滑 archived Idea 行
3. 点击 Delete（红色 destructive action）
4. Alert 确认：
   - Cancel → 关闭对话框，无变化
   - Delete → 执行删除
5. Mobile 校验 status === 'archived'
6. 本地 SQLite 删除 Idea（及 notes、attachments 行）
7. 调用 CLI DELETE /api/v1/spec-ideas/:id
8. CLI 校验 archived 状态，级联删除子表，广播 spec_changed
9. Mobile 刷新 Ideas 列表，Archived 计数减 1
```

### 4.2 与现有能力的关系

| 操作 | open / converted 等 | archived |
|------|---------------------|----------|
| Archive | ✅ 左滑 | — |
| Unarchive | — | ✅ 左滑 |
| Delete | ❌ V1 不支持 | ✅ 左滑（本规格） |

## 5. 边界情况

| 场景 | 行为 |
|------|------|
| Idea 有 `convertedSpecId` | 允许删除 Idea；关联 Spec 保留；Spec 详情「来源 Idea」显示已删除或不可跳转 |
| Idea 有 `interviewConversationId` | 只删除 Idea 资产；Interview Chat 保留 |
| 离线删除 | 本地先删除，标记 `pending_mutation: 'delete'`；恢复网络后同步 CLI |
| CLI 同步失败 | 保留本地删除结果，记录 `lastSyncError`，后续重试 |
| 非 archived 状态请求删除 | Mobile 不展示 Delete action；CLI 返回 409 Conflict |
| Archived 区为空 | 保持现有空态文案 *"Archived ideas stay here for traceability."* |
| 删除进行中重复点击 | 禁用 action 或忽略重复请求，避免双删错误 |

## 6. 数据模型与接口

### 6.1 Mobile

- `SpecIdeaPendingMutation` 增加 `'delete'`。
- `specStore.deleteArchivedIdea(id)`：校验 `status === 'archived'` 后删除本地记录并触发同步。
- `specAssetService.deleteSpecIdea(endpoint, id)`：调用 CLI DELETE API。

### 6.2 CLI

新增路由：

```text
DELETE /api/v1/spec-ideas/:id
```

行为：

- 校验 Idea 存在且 `status === 'archived'`；否则返回 `409 Conflict`。
- 级联删除 `spec_idea_notes`、`spec_idea_attachments`、`spec_ideas`。
- 返回 `204 No Content`。
- 广播 `spec_changed` 事件。

错误码：

| 状态码 | 场景 |
|--------|------|
| 404 | Idea 不存在 |
| 409 | Idea 非 archived 状态 |
| 401 | Bearer auth 失败 |

## 7. UI/UX 需求

- 遵循 `mobile/docs/design.md` 深色设计系统。
- Archived 区左滑显示 **Unarchive** 与 **Delete** 两个 action。
- Delete action 使用 `brandColors.error` 背景，文案 `DELETE`，对齐 `SpecsListScreen` 删除样式。
- 确认对话框（英文，与现有 Specs 模块一致）：
  - Title: `Delete idea?`
  - Message: `This idea will be permanently removed. This cannot be undone.`
  - Buttons: `Cancel` / `Delete`（destructive）
- `accessibilityLabel` 含 idea 标题，例如 `Delete ${idea.title}`。
- 参考 Apple HIG：destructive 操作需明确确认，取消应无副作用。

## 8. 验收标准

- [ ] 仅 `archived` 状态的 Idea 在 Archived 列表左滑可见 Delete action。
- [ ] `open`、`interviewing`、`converted`、`failed` 状态的 Idea 不显示 Delete action。
- [ ] 点击 Delete 弹出二次确认；Cancel 不删除。
- [ ] 确认后 Idea 从 Archived 列表消失，Archived 计数正确减少。
- [ ] 有关联 `convertedSpecId` 的 archived Idea 删除后，Spec 仍可打开与实施。
- [ ] CLI `DELETE /api/v1/spec-ideas/:id` 对非 archived Idea 返回 409。
- [ ] CLI 级联删除 notes 与 attachments 子表。
- [ ] 离线删除在恢复网络后完成 CLI 同步，不产生幽灵记录。
- [ ] 单元测试覆盖：repository 删除、store 状态校验、Archived 列表 Swipeable UI。
- [ ] `cd mobile && pnpm typecheck` 与相关测试通过。
- [ ] `cd cli && cargo test` 通过。

## 9. 非功能性需求

- 删除为硬删除，不可恢复；V1 不提供 Undo。
- Bearer auth 与现有 REST 体系一致。
- 不新增中心化后端；数据边界仍为用户本机 SQLite 与本地 CLI serve DB。
- 删除操作应在 1 秒内完成本地反馈；CLI 同步可异步重试。

## 10. 依赖关系

- 基于 [`2026-06-06-SPEC-ideas-to-specs-refactor.md`](2026-06-06-SPEC-ideas-to-specs-refactor.md) 的 Idea 模型、Archived 区 UI 与 `spec_changed` 同步机制。
- 参考 `SpecsListScreen` 左滑 DELETE 实现作为交互范本。
