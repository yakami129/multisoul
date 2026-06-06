# Activity Weak Network Degradation Implementation Plan

**Spec:** [`docs/product-specs/SPEC-activity-pagination.md`](../product-specs/SPEC-activity-pagination.md)

**Goal:** Lock the Activity-only weak network behavior so a failed incremental page keeps already loaded rows visible and retrying requests the same next cumulative page instead of resetting the list.

**Scope:** Activity pagination only. This plan does not introduce global offline detection, Chat offline behavior, WebSocket reconciliation, or endpoint health state changes.

**Architecture:** Reuse the existing Activity pagination stack: `ActivityTab` calls `useActivityInfiniteQuery`, which uses React Query `useInfiniteQuery` and cumulative `limit_per_section` values (`20`, `40`, `60`, ...). `ActivityScreen` renders load-more failure as a footer retry action. Implementation work is limited to plan/index documentation, regression coverage, and verification because the core Activity pagination path already exists.

---

## Task 0: Scope And Baseline

**Files:**
- Reference: `docs/product-specs/SPEC-activity-pagination.md`
- Reference: `mobile/app/(tabs)/activity.tsx`
- Reference: `mobile/src/features/activity/hooks/useActivityInfiniteQuery.ts`
- Reference: `mobile/src/features/activity/components/ActivityScreen.tsx`

- [x] Confirm weak network scope is Activity pagination only.
- [x] Confirm existing code already keeps `loadMoreError`, retains loaded pages, and wires retry to `fetchNextPage()`.
- [x] Confirm unrelated worktree change `mobile/app.json` exists and must not be touched.

## Task 1: Plan Registration

**Files:**
- Create: `docs/exec-plans/2026-06-05-activity-weak-network.md`
- Modify: `docs/exec-plans/index.json`

- [x] Add this implementation plan.
- [x] Register it in the exec-plan index.
- [x] Run `python3 scripts/check-docs-indices.py`.

## Task 2: Route-Level Weak Network Regression

**Files:**
- Modify: `mobile/src/__tests__/activityPaginationRoute.test.tsx`

- [x] Add a route-level test for the confirmed weak-network flow:
  - first page succeeds with `limit_per_section=20`;
  - load-more fails at `limit_per_section=40`;
  - loaded rows remain visible and footer error is forwarded;
  - retry requests `limit_per_section=40` again;
  - retry success appends the second-page row and clears the error.
- [x] Verify the test fails if retry resets to `20` or clears the loaded row.

## Task 3: Verification

**Files:**
- Relevant mobile Activity test files
- Docs index files

- [x] Run focused route test:

```bash
cd mobile && pnpm test -- activityPaginationRoute.test.tsx --watchAll=false
```

- [x] Run focused Activity pagination suite:

```bash
cd mobile && pnpm test -- activityPagination.test.ts useActivityInfiniteQuery.test.tsx ActivityScreen.pagination.test.tsx activityPaginationRoute.test.tsx activityRoute.test.tsx activityService.test.ts --watchAll=false
```

- [x] Run required mobile typecheck for TS/TSX changes:

```bash
cd mobile && pnpm typecheck
```

- [x] Run docs index check:

```bash
python3 scripts/check-docs-indices.py
```

- [x] Review diff and confirm no unrelated `mobile/app.json` changes were modified.
- [x] Run final full mobile test after line-count cleanup:

```bash
cd mobile && pnpm test --watchAll=false
```

Verification evidence captured on 2026-06-05:
- Focused route test: `cd mobile && pnpm test -- activityPaginationRoute.test.tsx --watchAll=false` -> 1 suite passed, 7 tests passed.
- Focused Activity suite: `cd mobile && pnpm test -- activityPagination.test.ts useActivityInfiniteQuery.test.tsx ActivityScreen.pagination.test.tsx activityPaginationRoute.test.tsx activityRoute.test.tsx activityService.test.ts --watchAll=false` -> 6 suites passed, 62 tests passed. Existing `act(...)` warnings remain in `activityRoute.test.tsx`.
- Typecheck: `cd mobile && pnpm typecheck` -> exit 0, no TypeScript errors.
- Docs index check: `python3 scripts/check-docs-indices.py` -> exit 0.
- Diff review: `mobile/app.json` has a pre-existing `buildNumber` change (`100` -> `103`) and was not modified by this plan.
- File size check: `mobile/src/__tests__/activityPaginationRoute.test.tsx` is exactly 500 lines after cleanup.
- Diff whitespace check: `git diff --check` -> exit 0.
- Final full mobile test: `cd mobile && pnpm test --watchAll=false` -> 77 suites passed, 488 tests passed. Existing `act(...)` warnings and worker teardown warning remain outside this change.
- Subagent review: no blockers. Low gap about explicitly asserting the load-more error footer clears after retry success was fixed in `activityPaginationRoute.test.tsx`.
- Post-review focused route test: `cd mobile && pnpm test -- activityPaginationRoute.test.tsx --watchAll=false` -> 1 suite passed, 7 tests passed.
- Post-review typecheck: `cd mobile && pnpm typecheck` -> exit 0, no TypeScript errors.
