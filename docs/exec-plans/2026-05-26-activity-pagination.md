# Activity Pagination Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Before writing code for any task, add or update the failing tests first.

**Spec:** [`docs/product-specs/SPEC-activity-pagination.md`](../product-specs/SPEC-activity-pagination.md)

**Goal:** Make the mobile Activity tab open quickly and scroll smoothly by loading Activity rows in 20-item increments and rendering the list with `FlatList`.

**Architecture:** Keep the existing CLI `GET /api/v1/activity?limit_per_section=` contract. Mobile introduces a small pagination layer that requests cumulative limits (`20`, `40`, `60`, ...), derives a loaded Activity result from the newest cumulative response, and exposes `loadMore` / retry state to a virtualized Activity list. The existing polling, pull-to-refresh, Done read mutations, delete flow, endpoint failure states, and route construction stay intact.

**Tech Stack:** Expo Router, React Native `FlatList`, React Query, Jest + React Native Testing Library, TypeScript

---

## Task 0: Worktree, Baseline, And Scope

**Files:**
- Reference: `docs/product-specs/SPEC-activity-pagination.md`
- Modify: `docs/product-specs/index.json`
- Modify: `docs/exec-plans/index.json`

- [x] Confirm implementation is in isolated worktree `/Users/alan/.config/superpowers/worktrees/multisoul/activity-pagination` on branch `feat/activity-pagination`.
- [x] Copy the untracked Activity pagination spec into the worktree.
- [x] Run setup: `cd mobile && pnpm install`.
- [x] Run baseline route test:

```bash
cd mobile && pnpm test -- activityRoute.test.tsx --watchAll=false
```

Expected: PASS, 22 tests.

- [x] Run baseline typecheck:

```bash
cd mobile && pnpm typecheck
```

Expected: PASS.

- [x] Register `SPEC-activity-pagination.md` in `docs/product-specs/index.json`.
- [x] Register this plan in `docs/exec-plans/index.json`.

## Task 1: Activity Pagination Utilities

**Files:**
- Create: `mobile/src/features/activity/services/activityPagination.ts`
- Create: `mobile/src/features/activity/services/activityPagination.test.ts`

- [x] **Step 1: Write the failing utility tests**

Create `mobile/src/features/activity/services/activityPagination.test.ts` with tests for page limits, cumulative page merge, `hasNextPage`, and read-state preservation. The tests must use explicit positive and negative assertions.

Key cases:
- `nextActivityLimit(20, 1)` returns `40`, not `20`.
- `mergeActivityPages([page20, page40])` keeps the newest cumulative result and does not duplicate overlapping rows.
- `hasMoreActivity({ currentLimit: 20, previousCount: 2, currentCount: 4 })` is true.
- `hasMoreActivity({ currentLimit: 40, previousCount: 4, currentCount: 4 })` is false.

- [x] **Step 2: Verify RED**

```bash
cd mobile && pnpm test -- activityPagination.test.ts --watchAll=false
```

Expected: FAIL because `activityPagination.ts` does not exist.

- [x] **Step 3: Implement the utilities**

Create `mobile/src/features/activity/services/activityPagination.ts` exporting:

```ts
export const ACTIVITY_PAGE_SIZE = 20;

export function nextActivityLimit(currentLimit: number, pageSize = ACTIVITY_PAGE_SIZE): number;

export function activityResultCount(result: AggregatedActivityResult): number;

export function mergeActivityPages(pages: AggregatedActivityResult[]): AggregatedActivityResult;

export function hasMoreActivity(args: {
  previousCount: number;
  currentCount: number;
  currentLimit: number;
}): boolean;
```

Implementation rule: `mergeActivityPages` returns the latest cumulative page with section arrays deduped by `id`; it must not mutate input pages.

- [x] **Step 4: Verify GREEN**

```bash
cd mobile && pnpm test -- activityPagination.test.ts --watchAll=false
```

Expected: PASS.

## Task 2: Activity Infinite Query Hook

**Files:**
- Create: `mobile/src/features/activity/hooks/useActivityInfiniteQuery.ts`
- Create: `mobile/src/features/activity/hooks/useActivityInfiniteQuery.test.tsx`
- Modify: `mobile/src/features/activity/services/activityService.test.ts`

- [x] **Step 1: Write the failing hook tests**

Create a hook test with `QueryClientProvider` that mocks `aggregateActivity` and verifies:
- Initial fetch calls `aggregateActivity(endpoints, 20)`.
- `fetchNextPage()` calls `aggregateActivity(endpoints, 40)`.
- A failed next page keeps the first page data and exposes a retryable error state.
- Empty endpoint list returns an empty aggregate and does not call `aggregateActivity`.

- [x] **Step 2: Verify RED**

```bash
cd mobile && pnpm test -- useActivityInfiniteQuery.test.tsx --watchAll=false
```

Expected: FAIL because the hook does not exist.

- [x] **Step 3: Implement the hook**

Create `useActivityInfiniteQuery` with this shape:

```ts
export function useActivityInfiniteQuery(args: {
  endpoints: Endpoint[];
  enabled: boolean;
}): {
  activity: AggregatedActivityResult;
  isInitialLoading: boolean;
  isRefreshing: boolean;
  isFetchingNextPage: boolean;
  hasNextPage: boolean;
  loadMoreError: Error | null;
  refetch: () => Promise<void>;
  fetchNextPage: () => Promise<void>;
};
```

Implementation details:
- Use React Query `useInfiniteQuery`.
- Query key includes endpoint id/base URL/token tuples so endpoint changes reset cached pages.
- `initialPageParam` is `20`.
- `queryFn` calls `aggregateActivity(endpoints, limit)`.
- `getNextPageParam` returns `currentLimit + 20` only when `hasMoreActivity(...)` is true.
- Return an empty aggregate without network calls when `endpoints.length === 0`.

- [x] **Step 4: Verify GREEN**

```bash
cd mobile && pnpm test -- useActivityInfiniteQuery.test.tsx --watchAll=false
```

Expected: PASS.

- [x] **Step 5: Update service test for configurable limit**

Add a focused assertion to `mobile/src/features/activity/services/activityService.test.ts` that `aggregateActivity(endpoints, 20)` sends `limit_per_section=20`.

Run:

```bash
cd mobile && pnpm test -- activityService.test.ts --watchAll=false
```

Expected: PASS.

## Task 3: Activity Tab Integration

**Files:**
- Modify: `mobile/app/(tabs)/activity.tsx`
- Create: `mobile/src/__tests__/activityPaginationRoute.test.tsx`
- Modify only if required: `mobile/src/__tests__/activityRoute.test.tsx`

- [x] **Step 1: Write route-level RED tests**

Create `activityPaginationRoute.test.tsx` with a local `QueryClientProvider` wrapper and existing service mocks. Cover:
- First focus fetch uses `aggregateActivity(endpoints, 20)`, not the old default call.
- Scrolling to the list end requests the next cumulative limit `40`.
- Load-more failure renders a retry button and keeps already loaded rows visible.
- Pull-to-refresh resets to first page and calls `aggregateActivity(endpoints, 20)`.
- Switching the top filter resets pagination and scroll state enough to show first-page rows only.

- [x] **Step 2: Verify RED**

```bash
cd mobile && pnpm test -- activityPaginationRoute.test.tsx --watchAll=false
```

Expected: FAIL because ActivityTab still calls `aggregateActivity(endpoints)` directly and ActivityScreen has no load-more props.

- [x] **Step 3: Replace ActivityTab manual fetch state with the hook**

Update `mobile/app/(tabs)/activity.tsx`:
- Remove `activity`, `refreshing`, `hasLoaded`, and `inFlightRef` state.
- Keep `focused` and `appState`.
- Use `useActivityInfiniteQuery({ endpoints, enabled: focused })`.
- Preserve the 15-second foreground polling by calling the hook `refetch`.
- Keep Done read optimistic updates by storing a small local read override map or by updating visible activity state immutably before the mutation settles.
- Keep delete success behavior by refetching the first page after a successful delete.

- [x] **Step 4: Verify GREEN**

```bash
cd mobile && pnpm test -- activityPaginationRoute.test.tsx --watchAll=false
```

Expected: PASS.

- [x] **Step 5: Run regression route tests**

```bash
cd mobile && pnpm test -- activityRoute.test.tsx --watchAll=false
```

Expected: PASS. If existing tests expect `aggregateActivity(mockEndpoints)` exactly, update them to assert `aggregateActivity(mockEndpoints, 20)` with explicit assertion messages.

## Task 4: Virtualized ActivityScreen

**Files:**
- Modify: `mobile/src/features/activity/components/ActivityScreen.tsx`
- Modify: `mobile/src/features/activity/components/activityScreenStyles.ts`
- Create: `mobile/src/features/activity/components/ActivityScreen.pagination.test.tsx`

- [x] **Step 1: Write component RED tests**

Create `ActivityScreen.pagination.test.tsx` that renders `ActivityScreen` directly and verifies:
- Non-empty content uses a `FlatList` with `testID="activity-list"`.
- `onEndReached` calls `onLoadMore` when `hasMore` is true.
- Footer spinner is visible while `isLoadingMore` is true.
- Footer retry button is visible when `loadMoreError` is set.
- Empty and all-failed states keep their refreshable scroll containers.

- [x] **Step 2: Verify RED**

```bash
cd mobile && pnpm test -- ActivityScreen.pagination.test.tsx --watchAll=false
```

Expected: FAIL because the non-empty state still uses `ScrollView`.

- [x] **Step 3: Implement FlatList rendering**

Update `ActivityScreen` props:

```ts
isLoadingMore?: boolean;
hasMore?: boolean;
loadMoreError?: string | null;
onLoadMore?: () => void;
onRetryLoadMore?: () => void;
```

Rendering rules:
- Keep the header outside the list.
- For non-empty content, render `FlatList<ActivityItem>` with `data={visibleItems}` and `renderItem` using the existing `ActivityRow`.
- Use `ListHeaderComponent` for partial failure banner and Done sub-filter controls.
- Use `ListEmptyComponent` for per-filter empty text.
- Use `ListFooterComponent` for loading-more spinner or retry button.
- Use `refreshControl` with existing `RefreshControl`.
- Use stable `keyExtractor={(item) => item.id}`.
- Use `initialNumToRender={20}`, `maxToRenderPerBatch={20}`, `windowSize={7}`, and `removeClippedSubviews`.
- Keep `testID="activity-scroll"` on empty/all-failed scroll states and use `testID="activity-list"` on the non-empty list.

- [x] **Step 4: Verify GREEN**

```bash
cd mobile && pnpm test -- ActivityScreen.pagination.test.tsx --watchAll=false
```

Expected: PASS.

## Task 5: Verification And Documentation Hash Hygiene

**Files:**
- Modify if needed after reviewing diff: `docs/design-docs/*.md`

- [x] Run focused tests:

```bash
cd mobile && pnpm test -- activityPagination.test.ts useActivityInfiniteQuery.test.tsx ActivityScreen.pagination.test.tsx activityPaginationRoute.test.tsx activityRoute.test.tsx activityService.test.ts --watchAll=false
```

Expected: PASS.

- [x] Run full mobile verification required by `AGENTS.md` for TS/TSX changes:

```bash
cd mobile && pnpm typecheck
cd mobile && pnpm test -- --watchAll=false
```

Expected: PASS. Note: this repository's `pnpm test -- --watchAll=false` form is parsed by Jest as a pattern; the equivalent working command is `pnpm test --watchAll=false`.

- [x] Check source file sizes:

```bash
wc -l mobile/app/'(tabs)'/activity.tsx mobile/src/features/activity/components/ActivityScreen.tsx mobile/src/features/activity/services/activityPagination.ts mobile/src/features/activity/hooks/useActivityInfiniteQuery.ts
```

Expected: touched source files stay at or below 500 lines.

- [x] Review tracked code diff before updating any design-doc code hashes:

```bash
git diff -- mobile app docs
```

Expected: no design-doc hash update unless a reviewed design doc references changed code.

- [x] Before any completion claim, run `superpowers:verification-before-completion`.
- [x] Before any commit, run `superpowers:requesting-code-review`; fix Critical/Important findings and re-run verification.

Verification evidence captured on 2026-05-26:
- Code review: `superpowers:requesting-code-review` found Important blockers in lint, filter reset, and mark-read failure rollback; all were fixed before commit.
- Lint: `pnpm lint` -> exit 0.
- Focused tests: `pnpm test -- activityPagination.test.ts useActivityInfiniteQuery.test.tsx ActivityScreen.pagination.test.tsx activityPaginationRoute.test.tsx activityRoute.test.tsx activityService.test.ts --watchAll=false` -> 6 suites passed, 55 tests passed.
- Typecheck: `pnpm typecheck` -> exit 0.
- Docs index check: `python3 scripts/check-docs-indices.py` -> exit 0.
- Whitespace check: `git diff --check` -> exit 0.
- Full mobile tests: `pnpm test --watchAll=false` -> 55 suites passed, 363 tests passed. Existing console warnings remain in unrelated tests.
- File size check: touched source files are 246, 434, 51, and 108 lines; all are below the 500-line limit.
- Design-doc hash review: diff under `docs/design-docs` and `mobile/docs` is empty; no hash update required.
