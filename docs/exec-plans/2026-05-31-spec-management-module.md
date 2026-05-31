# Spec Management Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Build the Phase 1 Spec management MVP: local spec drafts, structured interview cards, read-only `SPEC.md` preview, single-agent dispatch, and Activity linkage.

**Architecture:** Mobile owns draft state, interview state, preview generation, and Specs UI. `msctl serve` owns repo file writes and creation of the agent conversation through a new authenticated dispatch endpoint. Existing Activity remains the execution tracker.

**Tech Stack:** React Native + Expo Router + Zustand + expo-sqlite; Rust + axum + rusqlite; Jest and Cargo tests.

---

## Baseline Evidence

- Worktree: `/Users/alan/.config/superpowers/worktrees/multisoul/spec-management-module`
- Branch: `feat/spec-management-module`
- `cd mobile && pnpm typecheck`: passed.
- `cd mobile && pnpm test --watchAll=false`: 57 suites / 389 tests passed, with existing React `act(...)` and `SafeAreaView` warnings.
- `cd cli && cargo test`: 199 tests passed.
- `cd mobile && pnpm test -- --watchAll=false` is not valid for this package because Jest receives the flag as a pattern. Use `pnpm test --watchAll=false`.

## Implementation Boundaries

- Phase 1 implements deterministic structured interview questions and deterministic markdown rendering. The SPEC's unresolved "dedicated spec-builder agent" decision is left for a later feature.
- Phase 1 supports one spec dispatched to one agent.
- Phase 1 writes `docs/product-specs/YYYY-MM-DD-SPEC-<slug>.md` during dispatch.
- Phase 1 does not implement multi-agent task splitting, long-form mobile editing, version diff, auto PR, or implementation-plan generation.
- Project rule overrides Superpowers default: do not commit per task. Commit once after all tasks pass and after code review.

## Task 1: Spec Domain, Interview, and Markdown Rendering

**Files:**
- Create: `mobile/src/features/specs/types.ts`
- Create: `mobile/src/features/specs/services/specInterview.ts`
- Create: `mobile/src/features/specs/services/specMarkdown.ts`
- Create: `mobile/src/features/specs/services/specInterview.test.ts`
- Create: `mobile/src/features/specs/services/specMarkdown.test.ts`
- Create: `mobile/src/features/specs/index.ts`

- [x] Write failing tests in `specInterview.test.ts`.
  - Assert a new draft starts at question `goal`.
  - Assert an empty answer list is not ready to generate.
  - Assert answers for `goal`, `scope`, `acceptance`, `non_goals`, and `dispatch` make the interview ready.
  - Run: `cd mobile && pnpm test src/features/specs/services/specInterview.test.ts --watchAll=false`
  - Expected: FAIL because implementation files do not exist.

- [x] Implement `types.ts`.
  - Define `SpecStatus`, `SpecQuestion`, `SpecQuestionRound`, `SpecAnswer`, `SpecDraft`, `CreateSpecInput`, and `DispatchSpecResult`.
  - Required `SpecDraft` fields: `id`, `title`, `slug`, `status`, `targetAgentId`, `targetEndpointId`, `targetRepoPath`, `targetAgentName`, `targetRuntime`, `questions`, `answers`, `createdAt`, `updatedAt`.
  - Optional `SpecDraft` fields: `markdownPreview`, `repoSpecPath`, `linkedConversationId`, `linkedActivityItemId`, `errorMessage`.

- [x] Implement `specInterview.ts`.
  - Export `SPEC_INTERVIEW_QUESTIONS`.
  - Required question ids: `goal`, `scope`, `acceptance`, `non_goals`, `dispatch`.
  - Export `getFirstOpenQuestionId(answers)` and `isSpecInterviewReady(answers)`.
  - `isSpecInterviewReady` must return `true` only when every required question has a non-empty answer.

- [x] Run interview tests.
  - Run: `cd mobile && pnpm test src/features/specs/services/specInterview.test.ts --watchAll=false`
  - Expected: PASS.

- [x] Write failing tests in `specMarkdown.test.ts`.
  - Assert `buildSpecSlug('Offline First Spec Manager!!') === 'offline-first-spec-manager'`.
  - Assert `buildSpecMarkdown(spec)` includes H1, background, scope, out of scope, acceptance, dispatch text, and does not include `undefined` or `null`.
  - Run: `cd mobile && pnpm test src/features/specs/services/specMarkdown.test.ts --watchAll=false`
  - Expected: FAIL because `specMarkdown.ts` does not exist.

- [x] Implement `specMarkdown.ts`.
  - Export `buildSpecSlug(title)`.
  - Export `buildSpecMarkdown(spec)`.
  - Required sections: `背景与目标`, `范围`, `用户与使用场景`, `业务流程与信息架构`, `UI/UX 需求`, `状态、错误与边界情况`, `验收标准`, `未决问题`.

- [x] Run Task 1 tests.
  - Run: `cd mobile && pnpm test src/features/specs/services/specInterview.test.ts src/features/specs/services/specMarkdown.test.ts --watchAll=false`
  - Expected: PASS.

## Task 2: Local Persistence and Spec Store

**Files:**
- Modify: `mobile/src/db/index.ts`
- Create: `mobile/src/features/specs/services/specRepository.ts`
- Create: `mobile/src/store/specStore.ts`
- Create: `mobile/src/store/specStore.test.ts`
- Modify: `mobile/app/_layout.tsx`

- [x] Write failing tests in `specStore.test.ts`.
  - Test creating a spec from an `Agent` stores `targetAgentId`, `targetEndpointId`, repo path, slug, and `draft` status.
  - Test answering all required questions and generating preview changes status to `review`.
  - Test approving changes status to `approved`.
  - Test reloading from SQLite preserves `answers` and `markdownPreview`.
  - Run: `cd mobile && pnpm test src/store/specStore.test.ts --watchAll=false`
  - Expected: FAIL because store/repository do not exist.

- [x] Add SQLite table in `mobile/src/db/index.ts`.
  - Table: `specs`.
  - Columns: ids/status/target fields/questions_json/answers_json/markdown_preview/repo_spec_path/linked_conversation_id/linked_activity_item_id/error_message/created_at/updated_at.
  - Index: `idx_specs_status_updated ON specs(status, updated_at DESC)`.

- [x] Implement `specRepository.ts`.
  - Export `loadSpecs()`, `saveSpec(spec)`, and `deleteSpec(id)`.
  - Store `questions` and `answers` as JSON strings.
  - Convert row names between snake_case SQLite and camelCase TypeScript.

- [x] Implement `specStore.ts`.
  - Export `useSpecStore`.
  - Methods: `load`, `createSpec`, `answerQuestion`, `generatePreview`, `approveSpec`, `askMore`, `markDispatching`, `markDispatched`, `markFailed`.
  - `generatePreview` uses `buildSpecMarkdown`.
  - `askMore` returns status to `draft`.

- [x] Load specs at startup.
  - Modify `mobile/app/_layout.tsx` to call `useSpecStore((s) => s.load)` after `initDb()`.

- [x] Run Task 2 tests.
  - Run: `cd mobile && pnpm test src/store/specStore.test.ts --watchAll=false`
  - Expected: PASS.

## Task 3: Specs Tab and List Screen

**Files:**
- Modify: `mobile/app/(tabs)/_layout.tsx`
- Create: `mobile/app/(tabs)/specs.tsx`
- Create: `mobile/src/features/specs/components/SpecsListScreen.tsx`
- Create: `mobile/src/features/specs/components/SpecsListScreen.test.tsx`
- Modify: `mobile/src/__tests__/navigation.test.tsx`

- [x] Write failing list/navigation tests.
  - Empty state shows `Create your first spec`.
  - Draft row shows status `Draft`.
  - Review row shows status `Review`.
  - Pressing a row calls `onOpenSpec(id)`.
  - Navigation test expects a `Specs` tab.
  - Run: `cd mobile && pnpm test src/features/specs/components/SpecsListScreen.test.tsx src/__tests__/navigation.test.tsx --watchAll=false`
  - Expected: FAIL because the tab/component do not exist.

- [x] Add `Specs` tab.
  - Modify `_layout.tsx` to import `FileText` from `lucide-react-native`.
  - Add `<Tabs.Screen name="specs" options={{ title: 'Specs', tabBarIcon: SpecsIcon }} />` between Agents and Activity.

- [x] Implement `SpecsListScreen`.
  - Root background `#0D0D0D`.
  - Header `Specs` and orange plus button.
  - Segments: `Draft`, `Review`, `Dispatched`.
  - Row surface `#1A1A1A`, divider `#1E1E1E`, primary text `#FFFFFF`, muted text `#888888`, action orange `#FF6B35`.

- [x] Implement `mobile/app/(tabs)/specs.tsx`.
  - Load specs from `useSpecStore`.
  - Fetch agents with `fetchAllAgents`.
  - `New Spec` creates an `Untitled Spec` for the first available agent in MVP.
  - Row press routes to `/spec/<id>`.

- [x] Run Task 3 tests.
  - Run: `cd mobile && pnpm test src/features/specs/components/SpecsListScreen.test.tsx src/__tests__/navigation.test.tsx --watchAll=false`
  - Expected: PASS.

## Task 4: Spec Detail Interview, Review, Approval, and Dispatch UI

**Files:**
- Create: `mobile/app/spec/[id].tsx`
- Create: `mobile/src/features/specs/components/SpecDetailScreen.tsx`
- Create: `mobile/src/features/specs/components/SpecDetailScreen.test.tsx`
- Modify: `mobile/app/_layout.tsx`

- [x] Write failing detail tests.
  - Draft spec shows current question and options.
  - Selecting an option calls `onAnswer`.
  - Generate button is disabled until required questions are answered.
  - Review state shows markdown preview and `Approve` / `Ask More`.
  - Approved state shows `Dispatch`.
  - Run: `cd mobile && pnpm test src/features/specs/components/SpecDetailScreen.test.tsx --watchAll=false`
  - Expected: FAIL because component does not exist.

- [x] Implement `SpecDetailScreen`.
  - Props: `spec`, `onBack`, `onAnswer`, `onGenerate`, `onApprove`, `onAskMore`, `onDispatch`.
  - Missing spec state shows `Spec not found`.
  - Draft state renders one question card at a time.
  - Review state renders markdown in a scroll view.
  - Approved/dispatching/dispatched/running/done/failed states render a status panel.

- [x] Add route.
  - Modify `mobile/app/_layout.tsx` to include `<Stack.Screen name="spec/[id]" options={{ headerShown: false }} />`.
  - Create `mobile/app/spec/[id].tsx` to wire store callbacks.

- [x] Run Task 4 tests.
  - Run: `cd mobile && pnpm test src/features/specs/components/SpecDetailScreen.test.tsx --watchAll=false`
  - Expected: PASS.

## Task 5: CLI Spec Dispatch Endpoint

**Files:**
- Create: `cli/src/serve/routes/specs.rs`
- Modify: `cli/src/serve/routes/mod.rs`
- Modify: `cli/src/serve/mod.rs`

- [x] Write failing Rust tests in `specs.rs`.
  - `dispatch_spec_writes_product_spec_and_creates_conversation`
  - `dispatch_spec_rejects_path_traversal_slug`
  - `dispatch_spec_rejects_existing_file`
  - Each test must include full project-required explanatory comments and assertion messages.
  - Run: `cd cli && cargo test serve::routes::specs`
  - Expected: FAIL because module/route do not exist.

- [x] Implement `POST /api/v1/agents/:id/specs/dispatch`.
  - Request: `{ title: string, slug: string, markdown: string }`.
  - Response: `{ conversation_id: string, repo_spec_path: string }`.
  - Validate slug: lowercase ASCII letters, numbers, hyphens only; no empty, slash, dot, or backslash.
  - Look up agent project path by id.
  - Write `docs/product-specs/YYYY-MM-DD-SPEC-<slug>.md` with create-new semantics.
  - Create conversation title `Spec: <title>`.
  - Insert initial user message instructing agent to read the spec path, implement the smallest MVP, ask via AskUserQuestion if blocked, and report files/verification.
  - Trigger `runtime::send_to_session`.

- [x] Register route.
  - Add `pub mod specs;` in `cli/src/serve/routes/mod.rs`.
  - Add route in `cli/src/serve/mod.rs`.

- [x] Run Task 5 tests.
  - Run: `cd cli && cargo test serve::routes::specs`
  - Expected: PASS.

## Task 6: Mobile Dispatch Service

**Files:**
- Create: `mobile/src/features/specs/services/specDispatchService.ts`
- Create: `mobile/src/features/specs/services/specDispatchService.test.ts`
- Modify: `mobile/app/spec/[id].tsx`

- [x] Write failing dispatch service tests.
  - Assert POST path is `/api/v1/agents/<agent_id>/specs/dispatch`.
  - Assert body includes `title`, `slug`, `markdown`.
  - Assert response maps `conversation_id` and `repo_spec_path`.
  - Run: `cd mobile && pnpm test src/features/specs/services/specDispatchService.test.ts --watchAll=false`
  - Expected: FAIL because service does not exist.

- [x] Implement `dispatchSpec(base_url, token, spec)`.
  - Throw if `spec.markdownPreview` is missing.
  - Use `getEndpointClient`.
  - POST to the CLI endpoint.

- [x] Wire dispatch in `mobile/app/spec/[id].tsx`.
  - Find endpoint by `spec.targetEndpointId`.
  - Call `markDispatching`, `dispatchSpec`, `markDispatched`.
  - On error, call `markFailed` with user-readable error.

- [x] Run Task 6 tests.
  - Run: `cd mobile && pnpm test src/features/specs/services/specDispatchService.test.ts --watchAll=false`
  - Expected: PASS.

## Task 7: Verification

**Files:**
- Modify: `docs/exec-plans/index.json`

- [x] Add this plan to `docs/exec-plans/index.json`.
  - Entry: `{ "file": "2026-05-31-spec-management-module.md", "title": "Spec Management Module Implementation Plan" }`.

- [x] Run targeted mobile tests.
  - Run: `cd mobile && pnpm test src/features/specs/services/specInterview.test.ts src/features/specs/services/specMarkdown.test.ts src/store/specStore.test.ts src/features/specs/components/SpecsListScreen.test.tsx src/features/specs/components/SpecDetailScreen.test.tsx src/features/specs/services/specDispatchService.test.ts src/__tests__/navigation.test.tsx --watchAll=false`
  - Expected: PASS.

- [x] Run targeted CLI tests.
  - Run: `cd cli && cargo test serve::routes::specs`
  - Expected: PASS.

- [x] Run full required checks.
  - Run: `python3 scripts/check-docs-indices.py`
  - Run: `cd mobile && pnpm typecheck`
  - Run: `cd mobile && pnpm test --watchAll=false`
  - Run: `cd cli && cargo test`
  - Run: `cd cli && cargo build`
  - Expected: all pass.

- [ ] Manual UI verification.
  - Confirm tabs show `Agents / Specs / Activity / Settings`.
  - Create a spec, answer interview cards, generate preview, approve, dispatch.
  - Confirm no text overlap and colors remain within design doc palette.
  - Not run in this implementation session; covered by component/store/service tests.

## Self-Review

- Spec coverage: Phase 1 requirements are covered by Tasks 1-6.
- Out of scope preserved: multi-agent dispatch, task splitting, long-form editing, version diff, and auto PR are not implemented.
- Type consistency: `SpecDraft`, `SpecAnswer`, `DispatchSpecResult`, and dispatch response fields are consistent across mobile and CLI.
- Placeholder scan: no TBD/TODO placeholders are required to execute the plan.

## Completion Evidence

- `python3 scripts/check-docs-indices.py`: passed.
- `cd mobile && pnpm typecheck`: passed.
- `cd mobile && pnpm test --watchAll=false`: 63 suites / 407 tests passed, with existing `SafeAreaView` and React `act(...)` warnings.
- `cd cli && cargo test`: 203 tests passed (`193` unit + `10` integration).
- `cd cli && cargo build`: passed.
