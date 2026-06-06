# 归档 Idea 永久删除 — 执行计划

Spec: [`docs/product-specs/2026-06-06-SPEC-archived-idea-delete.md`](../product-specs/2026-06-06-SPEC-archived-idea-delete.md)

---

## 变更范围（共 10 个文件）

### CLI（4 处）

| # | 文件 | 变更 |
|---|------|------|
| 1 | `cli/src/serve/spec_assets.rs` | 新增 `Conflict` variant → `status_code()` 返回 409，`code()` 返回 `"conflict"` |
| 2 | `cli/src/serve/spec_ideas.rs` | 新增 `delete_spec_idea(state, idea_id)` + 单元测试 |
| 3 | `cli/src/serve/routes/spec_ideas.rs` | 新增 `delete` handler（检查 archived → 删除 → emit_spec_changed → 204） |
| 4 | `cli/src/serve/router.rs` | `/api/v1/spec-ideas/:id` 路由链上 `.delete(spec_ideas::delete)` |

### Mobile（6 处）

| # | 文件 | 变更 |
|---|------|------|
| 5 | `mobile/src/features/specs/types.ts` | `SpecIdeaPendingMutation` 加 `'delete'` |
| 6 | `mobile/src/features/specs/services/specAssetService.ts` | 新增 `deleteSpecIdea(endpoint, id)` |
| 7 | `mobile/src/store/specStore.ts` | `SpecState` 加 `deleteArchivedIdea(id, endpoint?)`；实现乐观删除 + CLI 同步 |
| 8 | `mobile/src/features/specs/components/SpecsHomeRows.tsx` | `IdeaRows` 加 `onDelete?: (id: string) => void`；archived 行渲染 Unarchive + Delete 两个 action；新增 `RowDeleteAction` 组件 |
| 9 | `mobile/src/features/specs/components/SpecsHomeStyles.ts` | 新增 `rowDeleteAction` / `rowDeleteText` 样式（参考 SpecsListScreen.deleteAction） |
| 10 | `mobile/src/features/specs/components/SpecsHomeScreen.tsx` | Props 加 `onDeleteArchivedIdea?`；在 Archived `IdeaRows` 传入；Alert 确认放在 `SpecsHomeScreen` 内（Title: `Delete idea?` / Message: `...` / Cancel + Delete destructive） |
| 11 | `mobile/app/(tabs)/specs.tsx` | 取 `deleteArchivedIdea` 从 store，找匹配 endpoint，传给 `onDeleteArchivedIdea` |

---

## 具体实现细节

### CLI — `delete_spec_idea`

```rust
pub fn delete_spec_idea(state: &AppState, idea_id: &str) -> Result<(), SaveSpecError> {
    let db = state.db.lock().map_err(|_| SaveSpecError::Internal)?;
    let idea = load_idea_base(&db, idea_id)?.ok_or(SaveSpecError::NotFound)?;
    if idea.status != "archived" {
        return Err(SaveSpecError::Conflict);
    }
    db.execute("DELETE FROM spec_ideas WHERE id = ?1", [idea_id])
        .map_err(|_| SaveSpecError::Internal)?;
    Ok(())
    // spec_idea_notes / spec_idea_attachments 已有 ON DELETE CASCADE，无需手动删
}
```

### CLI — `delete` handler

```rust
pub async fn delete(
    State(state): State<AppState>,
    Path(idea_id): Path<String>,
) -> Result<StatusCode, (StatusCode, Json<serde_json::Value>)> {
    delete_spec_idea(&state, &idea_id).map_err(error_response)?;
    emit_spec_changed(&state, &idea_id, "");
    Ok(StatusCode::NO_CONTENT)
}
```

### Mobile — store action

```ts
deleteArchivedIdea: async (ideaId, endpoint?) => {
  const idea = get().ideas.find((item) => item.id === ideaId);
  if (!idea || idea.status !== 'archived') return;
  // 乐观更新
  set((state) => ({ ideas: state.ideas.filter((item) => item.id !== ideaId) }));
  await deleteIdea(ideaId);
  // 尽力同步 CLI（失败不影响本地状态）
  if (endpoint) {
    const { deleteSpecIdea } = await import('@/features/specs/services/specAssetService');
    try {
      await deleteSpecIdea(endpoint, ideaId);
    } catch (_) {
      // best-effort; local already deleted
    }
  }
},
```

### Mobile — `IdeaRows` swipe（archived 行）

archived 行同时显示 Unarchive 和 Delete：
```tsx
<Swipeable
  renderRightActions={() => (
    <>
      <RowAction label="Unarchive" onPress={() => onUnarchive(idea.id)} />
      <RowDeleteAction
        accessibilityLabel={`Delete ${idea.title}`}
        onPress={() => onDelete(idea.id)}
      />
    </>
  )}
>
  {row}
</Swipeable>
```

`RowDeleteAction` 样式参照 `SpecsListScreen.deleteAction`：error 背景 + `DELETE` 文字。

### Mobile — Alert（放在 `SpecsHomeScreen`）

```ts
const handleDelete = (ideaId: string) => {
  const idea = ideas.find((item) => item.id === ideaId);
  Alert.alert(
    'Delete idea?',
    'This idea will be permanently removed. This cannot be undone.',
    [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => onDeleteArchivedIdea?.(ideaId) },
    ],
  );
};
```

---

## 测试（必须）

### CLI 单元测试（`cli/src/serve/spec_ideas.rs`）

- `delete_archived_idea_succeeds` — 创建 → 归档 → 删除 → list 为空
- `delete_open_idea_returns_conflict` — 创建未归档 → 删除 → `Err(SaveSpecError::Conflict)`
- `delete_nonexistent_idea_returns_not_found` — 删除不存在的 id → `Err(SaveSpecError::NotFound)`

### Mobile UI 测试（`SpecsHomeScreen.test.tsx`）

- `archived idea shows Delete action` — archived 展开后 Swipeable 渲染 "Unarchive" 和 "DELETE"
- `Delete shows confirmation alert` — 点击 DELETE → Alert.alert 被调用，`onDeleteArchivedIdea` 未被调用
- `confirming delete calls onDeleteArchivedIdea` — 模拟点击 Alert Delete → `onDeleteArchivedIdea('idea-1')` 被调用

---

## 验证步骤

```bash
cd cli && cargo test
cd cli && cargo build
cd mobile && pnpm typecheck
cd mobile && pnpm test -- --watchAll=false
```
