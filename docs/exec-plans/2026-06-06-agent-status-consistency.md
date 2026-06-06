# Exec Plan: Agent / Chat / Activity 状态一致性修复

**日期**: 2026-06-06  
**Spec**: `docs/product-specs/2026-06-06-SPEC-agent-status-consistency.md`  
**Spec ID**: 66f5d577-e5f4-4810-be66-87b95b92bc23

---

## 根因

1. `addConversation` 遇到已存在 ID 时跳过更新，导致 AgentDetail focus 刷新无法更新 status。
2. Agents tab 无 `useFocusEffect`，切换 tab 时从不刷新 conversations。

## 任务清单

| # | 任务 | 文件 | 状态 |
|---|------|------|------|
| 1 | 新增 `mergeConversations` action（upsert 语义） | `mobile/src/store/chatStore.ts` | ✅ |
| 2 | AgentDetail 使用 `mergeConversations` 替换 `forEach(addConversation)` | `mobile/app/agent/[id]/index.tsx` | ✅ |
| 3 | Agents tab 新增 `useFocusEffect` 静默刷新 conversations | `mobile/app/(tabs)/index.tsx` | ✅ |
| 4 | 回归测试（chatStore / agentDetail / index） | 3 个测试文件 | ✅ |
| 5 | typecheck + 全量测试（87 套 542 个，全部通过） | — | ✅ |

## 修改文件

- `mobile/src/store/chatStore.ts` — 新增 `mergeConversations`
- `mobile/app/agent/[id]/index.tsx` — 使用 `mergeConversations`
- `mobile/app/(tabs)/index.tsx` — 新增 `useFocusEffect`
- `mobile/src/store/chatStore.test.ts` — 新增 3 个单元测试
- `mobile/src/__tests__/agentDetail.test.tsx` — 新增回归测试
- `mobile/src/__tests__/index.test.tsx` — 新增回归测试
- `mobile/app/(tabs)/index.test.tsx` — 新增 `useFocusEffect` / `fetchConversations` mock

## 验证结果

```
TypeScript: No errors found
Test Suites: 87 passed, 87 total
Tests:       542 passed, 542 total
```

## lastCompletedCommit

<!-- 由 CI 写入，见 CLAUDE.md §7 -->
