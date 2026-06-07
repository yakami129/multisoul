# 归档 Idea 永久删除 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Archived 区 Idea 增加左滑永久删除能力（本地 SQLite + CLI `DELETE /api/v1/spec-ideas/:id`），交互对齐 Spec 列表 DELETE。

**Architecture:** CLI 新增 `delete_spec_idea`（仅 `archived` 可删，409 否则）并广播 `spec_changed`；Mobile 在 `specStore.deleteArchivedIdea` 乐观更新本地并调用 `deleteSpecIdea`；Archived 列表 `IdeaRows` 渲染 Unarchive + DELETE 双 action，`SpecsHomeScreen` 负责 Alert 二次确认。

**Tech Stack:** Rust (axum 0.7, rusqlite), React Native + Expo SDK 55, Zustand, expo-sqlite, Jest, cargo test

**Spec:** [`docs/product-specs/2026-06-06-SPEC-archived-idea-delete.md`](../product-specs/2026-06-06-SPEC-archived-idea-delete.md)

---

## 实施状态

| 阶段 | 状态 | 锚点 |
|------|------|------|
| Phase 1 — 核心删除（CLI + Mobile UI + 基础测试） | ✅ 已合并 | `9e40d1ae31c7757489a13479b8d950d349cf0a87` |
| Phase 2 — 规格缺口修补（离线同步、来源 Idea UX、补测） | ⏳ 待实施 | — |
| Phase 3 — 全量验证 | ⏳ 待实施 | — |

---

## Phase 1 — 核心删除（已完成，供复查）

### 变更文件

| 域 | 文件 | 职责 |
|----|------|------|
| CLI | `cli/src/serve/spec_assets.rs` | `SaveSpecError::Conflict` → 409 |
| CLI | `cli/src/serve/spec_ideas.rs` | `delete_spec_idea()` |
| CLI | `cli/src/serve/routes/spec_ideas.rs` | `delete` handler + `emit_spec_changed` |
| CLI | `cli/src/serve/router.rs` | `.delete(spec_ideas::delete)` |
| CLI | `cli/src/serve/spec_ideas_tests.rs` | 3 个删除单元测试 |
| Mobile | `mobile/src/features/specs/types.ts` | `SpecIdeaPendingMutation` 含 `'delete'` |
| Mobile | `mobile/src/features/specs/services/specAssetService.ts` | `deleteSpecIdea()` |
| Mobile | `mobile/src/store/specStore.ts` | `deleteArchivedIdea()` |
| Mobile | `mobile/src/features/specs/components/SpecsHomeRows.tsx` | `RowDeleteAction` + archived 双 action |
| Mobile | `mobile/src/features/specs/components/SpecsHomeStyles.ts` | `rowDeleteAction` / `rowDeleteText` |
| Mobile | `mobile/src/features/specs/components/SpecsHomeScreen.tsx` | Alert 确认 + `onDeleteArchivedIdea` |
| Mobile | `mobile/app/(tabs)/specs.tsx` | 接线 store action |
| Mobile | `mobile/src/features/specs/components/SpecsHomeScreen.test.tsx` | 3 个 UI 测试 |

---

## Phase 2 — 规格缺口修补

> Phase 1 已交付主路径；以下两项与 SPEC §5 / §8 仍有差距，需在 Phase 2 关闭。

### Task 1: 离线删除 pending_mutation 同步

**Files:**
- Modify: `mobile/src/store/specStore.ts`
- Modify: `mobile/src/features/specs/services/specAssetService.ts`
- Modify: `mobile/src/features/specs/services/specAssetRepository.ts`（如需 tombstone 表或 pending delete 行）
- Test: `mobile/src/store/specStore.test.ts`
- Test: `mobile/src/features/specs/services/specAssetService.test.ts`

**背景:** 当前 `deleteArchivedIdea` 立即 `deleteIdea(id)` 硬删本地行，CLI 失败时静默吞错，无法按 SPEC「`pending_mutation: 'delete'` + 恢复网络后重试」回放。

- [ ] **Step 1: 写失败测试 — 无 endpoint 时标记 pending delete**

```ts
test('deleteArchivedIdea without endpoint marks pending delete instead of hard delete', async () => {
  // setup archived idea in mock DB
  await useSpecStore.getState().deleteArchivedIdea('idea-1');
  expect(mockRunAsync).not.toHaveBeenCalledWith(
    expect.stringContaining('DELETE FROM spec_ideas'),
    ['idea-1'],
  );
  expect(useSpecStore.getState().ideas.find((i) => i.id === 'idea-1')).toBeUndefined();
  // pending row persisted with pending_mutation = 'delete'
});
```

- [ ] **Step 2: 跑测试确认 FAIL**

Run: `cd mobile && pnpm test -- --watchAll=false --testPathPattern=specStore`

- [ ] **Step 3: 实现离线删除策略**

方案（与现有 create/update/archive pending 模式对齐）：

1. `deleteArchivedIdea`：先从 store 移除（乐观 UI），若 `endpoint` 缺失或 `deleteSpecIdea` 失败，写入 tombstone 行（`status: 'archived'`, `pendingMutation: 'delete'`, `lastSyncError`）而非硬删；成功则 `deleteIdea(id)`。
2. `syncSpecIdeaBeforeServerAction`：增加 `pendingMutation === 'delete'` 分支 → `deleteSpecIdea` → 成功后 `deleteIdea`。
3. `refreshAssets` 或独立 `flushPendingIdeaMutations(endpoint)`：对 `loadPendingIdeas(endpointId)` 中 `delete` 行执行同步。

```ts
// specAssetService.ts — syncSpecIdeaBeforeServerAction 新增分支
if (idea.pendingMutation === 'delete') {
  await deleteSpecIdea(endpoint, idea.id);
  await deleteIdea(idea.id);
  return idea;
}
```

- [ ] **Step 4: 跑测试确认 PASS**

- [ ] **Step 5: 补 `deleteSpecIdea` service 单测**

```ts
test('deleteSpecIdea calls DELETE endpoint', async () => {
  mockDelete.mockResolvedValueOnce({ status: 204 });
  await deleteSpecIdea(endpoint, 'idea-1');
  expect(mockDelete).toHaveBeenCalledWith('/api/v1/spec-ideas/idea-1');
});
```

---

### Task 2: 删除后 Spec 来源 Idea 展示

**Files:**
- Modify: `mobile/app/spec/[id].tsx`
- Modify: `mobile/src/features/specs/components/SpecDetailScreen.tsx`
- Test: `mobile/src/features/specs/components/SpecDetailScreen.test.tsx`

**背景:** SPEC §5 — 有关联 `convertedSpecId` 的 Idea 删除后，Spec 仍可打开；「来源 Idea」应显示已删除或不可跳转。当前 `sourceIdea` 为 `undefined` 时仍展示 raw UUID 且可点击跳转。

- [ ] **Step 1: 写失败测试**

```tsx
test('shows deleted source idea label and disables navigation', () => {
  render(
    <SpecDetailScreen
      detail={{ spec: { ...baseSpec, sourceIdeaId: 'idea-deleted' }, versions: [] }}
      sourceIdeaTitle={undefined}
      sourceIdeaDeleted
      onOpenSourceIdea={onOpen}
    />,
  );
  expect(screen.getByText('Deleted')).toBeTruthy();
  fireEvent.press(screen.getByLabelText(/Idea/i));
  expect(onOpen).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: 实现**

`spec/[id].tsx`：

```ts
const sourceIdea = ideas.find((item) => item.id === spec?.sourceIdeaId);
const sourceIdeaDeleted = Boolean(spec?.sourceIdeaId && !sourceIdea);
```

`SpecDetailScreen`：新增 `sourceIdeaDeleted?: boolean`；`value` 优先 `'Deleted'`，`disabled={sourceIdeaDeleted || !currentSpec.sourceIdeaId}`。

- [ ] **Step 3: 跑 `SpecDetailScreen.test.tsx` 确认 PASS**

---

### Task 3: 补测 — 非 archived 不显示 Delete

**Files:**
- Test: `mobile/src/features/specs/components/SpecsHomeScreen.test.tsx`

- [ ] **Step 1: 断言 open idea 左滑仅 Archive**

```tsx
test('open idea does not show DELETE action', () => {
  const tree = render(<SpecsHomeScreen ideas={[openIdea]} ... />);
  expect(tree.queryByText('DELETE')).toBeNull();
});
```

- [ ] **Step 2: 跑测试确认 PASS**

---

### Task 4: Repository 删除单测

**Files:**
- Test: `mobile/src/features/specs/services/specAssetRepository.test.ts`

- [ ] **Step 1: 覆盖 `deleteIdea`**

```ts
test('deleteIdea removes row by id', async () => {
  await saveIdea(archivedIdea, null, null);
  await deleteIdea(archivedIdea.id);
  const ideas = await loadIdeas();
  expect(ideas.find((i) => i.id === archivedIdea.id)).toBeUndefined();
});
```

---

## Phase 3 — 全量验证

- [ ] **Step 1: CLI**

```bash
cd cli && cargo test
cd cli && cargo build
```

- [ ] **Step 2: Mobile**

```bash
cd mobile && pnpm typecheck
cd mobile && pnpm test -- --watchAll=false
```

- [ ] **Step 3: 对照 SPEC §8 验收清单逐项勾选**

| 验收项 | Phase 1 | Phase 2 |
|--------|---------|---------|
| 仅 archived 左滑可见 Delete | ✅ | — |
| 非 archived 不显示 Delete | ✅ | Task 3 补测 |
| Alert 二次确认 | ✅ | — |
| 删除后列表/计数更新 | ✅ | — |
| 有关联 Spec 仍可实施 | ✅ | Task 2 UX |
| CLI 非 archived → 409 | ✅ | — |
| CLI 级联删子表 | ✅ | — |
| 离线删除网络恢复后同步 | ❌ | Task 1 |
| repository / store / UI 单测 | 部分 | Task 1–4 |

- [ ] **Step 4: 全部通过后一次 commit，更新 `docs/exec-plans/index.json` 的 `lastCompletedCommit`**

---

## 风险与取舍

| 风险 | 建议 |
|------|------|
| 离线 delete tombstone 与 `replaceIdeasForEndpoint` 冲突 | pending delete 行保留 `pending_mutation IS NOT NULL`，刷新时不被 `DELETE ... pending_mutation IS NULL` 清掉 |
| Phase 1 已上线 best-effort 删除 | Phase 2 属增强，不破坏在线主路径 |
| 不做 Undo（SPEC Out of Scope） | 保持 Alert destructive 确认即可 |
