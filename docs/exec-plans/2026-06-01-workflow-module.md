# Workflow Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Workflow MVP: mobile-created daily/weekly workflows, local CLI scheduling, one new conversation per actual run, Activity visibility, pause/resume, and result persistence.

**Architecture:** `msctl serve` owns workflow storage, schedule calculation, due-run scanning, new conversation creation, runtime dispatch, and run-state persistence in SQLite. Mobile owns workflow CRUD screens and delegates all timing decisions to the endpoint. Existing Activity remains the cross-agent execution surface; workflow metadata augments rows without replacing Activity UI.

**Tech Stack:** Rust + axum + rusqlite + tokio; React Native + Expo Router + Zustand/React Query patterns already in the app; Jest and Cargo tests. Implementation must follow TDD: write failing tests, verify failure, implement minimal behavior, verify green.

---

## Baseline Evidence

- Worktree: `/Users/alan/.config/superpowers/worktrees/multisoul/workflow-module`
- Branch: `feat/workflow-module`
- `cd cli && cargo test`: passed, 219 unit tests + 10 smoke tests.
- `cd mobile && pnpm install`: completed in the worktree.
- `cd mobile && pnpm typecheck`: passed.

## Product Decisions Already Locked

- Workflow is created and edited on mobile.
- Each workflow binds exactly one registered agent.
- Each actual scheduled trigger creates a brand-new conversation and sends the saved fixed prompt as the first user message.
- Workflow itself only displays ON/OFF. Runtime status belongs to `workflow_runs`, Activity, and the new conversation.
- Schedule MVP supports daily and weekly form fields only.
- Schedule timezone is the daemon host timezone.
- Missed runs are skipped; no catch-up.
- Overlap is skipped and logged; no parallel run for the same workflow.
- Disable/edit never kills an already running agent run; it only affects future triggers.
- Completion and failure both push final results.
- Out of scope: cloud scheduling, automatic retry, prompt templates, auto-approval, multi-step DAGs, same-workflow parallelism.

## Implementation Boundaries

- Do not add cloud/backend scheduling.
- Do not implement raw cron editing.
- Do not change AskQuestion behavior except ensuring workflow-created conversations participate normally.
- Do not redesign Activity. Add workflow metadata while preserving current list, filters, and row model.
- Do not introduce a new mobile color system; use `mobile/docs/design.md`.
- Project rule overrides generic Superpowers guidance: do not commit per task. Commit once after all tasks pass, code review is requested, and Critical/Important review feedback is addressed.

## Task 1: CLI Workflow Schema And Schedule Core

**Files:**
- Modify: `cli/src/db.rs`
- Create: `cli/src/serve/workflows.rs`
- Create: `cli/src/serve/workflows_tests.rs`
- Modify: `cli/src/serve/mod.rs`

- [x] Write failing schema tests in `cli/src/db.rs`.
  - Assert `workflows` and `workflow_runs` tables exist.
  - Assert `workflows.enabled` exists exactly once.
  - Assert `workflow_runs.conversation_id` is nullable for skipped overlap records.
  - Run: `cd cli && cargo test db::tests::test_schema_has_workflows`
  - Expected: fail because the tables do not exist.

- [x] Add schema in `init_schema`.
  - `workflows`: `id`, `name`, `agent_id`, `prompt`, `enabled`, `schedule_kind`, `time_of_day`, `day_of_week`, `next_run_at`, `last_run_at`, `created_at`, `updated_at`.
  - `workflow_runs`: `id`, `workflow_id`, `conversation_id`, `status`, `scheduled_for`, `started_at`, `ended_at`, `summary`, `error_message`, `created_at`.
  - Add indexes for `enabled,next_run_at` and `workflow_id,created_at`.

- [x] Create schedule helpers in `cli/src/serve/workflows.rs`.
  - Parse `HH:mm`.
  - Validate daily vs weekly input.
  - Compute next run after `now_ms` using daemon local timezone.
  - Ensure weekly `day_of_week` is `1..=7`.

- [x] Write failing schedule tests in `cli/src/serve/workflows_tests.rs`.
  - Daily schedule after today’s time returns tomorrow.
  - Daily schedule before today’s time returns today.
  - Weekly schedule returns the next matching weekday/time.
  - Invalid empty prompt, invalid time, and invalid weekday are rejected.

- [x] Implement minimal schedule helpers until tests pass.
  - Run: `cd cli && cargo test workflows`
  - Expected: pass.

## Task 2: CLI Workflow REST API

**Files:**
- Modify: `cli/src/serve/routes/mod.rs`
- Create: `cli/src/serve/routes/workflows.rs`
- Create: `cli/src/serve/routes/workflows_tests.rs`
- Modify: `cli/src/serve/mod.rs`

- [x] Write failing route tests.
  - `GET /api/v1/workflows` requires Bearer auth.
  - `POST /api/v1/workflows` creates a workflow, stores `enabled=true`, and returns `next_run_at`.
  - Empty prompt returns `400`.
  - Missing agent returns `404`.
  - `PATCH /api/v1/workflows/:id` edits name/prompt/schedule/agent and recalculates `next_run_at`.
  - `POST /api/v1/workflows/:id/disable` sets `enabled=false` and `next_run_at=null`.
  - `POST /api/v1/workflows/:id/enable` sets `enabled=true` and recalculates `next_run_at`.
  - `GET /api/v1/workflows/:id/runs` returns newest run records.

- [ ] Implement route module.
  - Use existing `AppState` and `state.db` lock patterns.
  - Reuse current Bearer middleware by mounting routes in `authed_router`.
  - Return snake_case JSON matching the spec.

- [x] Run focused route tests.
  - Run: `cd cli && cargo test workflows`
  - Expected: pass.

## Task 3: CLI Scheduler And New Conversation Dispatch

**Files:**
- Modify: `cli/src/serve/state.rs`
- Modify: `cli/src/serve/mod.rs`
- Modify: `cli/src/serve/workflows.rs`
- Create: `cli/src/serve/workflows_scheduler_tests.rs`

- [x] Write failing scheduler tests.
  - Due enabled workflow creates one `workflow_run` and one new conversation.
  - The new conversation receives the saved prompt as `user_text` seq `1`.
  - The run stores that new `conversation_id`.
  - Existing running run causes `skipped_overlap` and creates no conversation.
  - Disabled workflow is ignored.
  - Missed historical runs do not backfill multiple runs.

- [x] Extract `create_workflow_conversation_and_dispatch`.
  - Mirror `specs::create_spec_conversation_and_message` and `messages::insert_user_message_and_mark_running`.
  - Always create a fresh conversation id.
  - Conversation title should be stable and human-readable, e.g. `Workflow: <name>`.
  - Runtime dispatch must use the bound agent’s `project_path`, `runtime`, and `mode`.

- [x] Implement `run_due_workflows_once(state, now_ms)`.
  - Query due workflows where `enabled=1 AND next_run_at <= now_ms`.
  - If a `running` run exists for the workflow, insert `skipped_overlap`, compute next future time, and do not create a conversation.
  - Otherwise insert `running` run, create conversation, insert prompt, dispatch runtime, and compute next run.

- [x] Start a scheduler loop from `run_server`.
  - Tick interval should be simple and conservative, e.g. 30 seconds.
  - On each tick call `run_due_workflows_once`.
  - Log failures without crashing the server.

## Task 4: Run Completion Persistence And Activity Metadata

**Files:**
- Modify: `cli/src/serve/routes/activity.rs`
- Modify runtime terminal-status paths under `cli/src/serve/runtime/**`
- Modify or add focused runtime/workflow tests.

- [x] Write failing tests for terminal status propagation.
  - A workflow conversation completed by runtime updates its linked `workflow_runs.status` to `completed`, sets `ended_at`, and stores summary if present.
  - A workflow conversation failed by runtime updates its linked `workflow_runs.status` to `failed`, sets `ended_at`, and stores error/summary.
  - Non-workflow conversations do not create workflow run records.

- [x] Implement workflow run finalization helper.
  - Find `workflow_runs` by `conversation_id` and `status='running'`.
  - Update status, ended time, summary/error.
  - Continue using existing task-status push path; do not add duplicate pushes.

- [x] Add optional workflow fields to Activity API.
  - `workflow_id`, `workflow_run_id`, `workflow_name`.
  - Join workflow metadata by `conversation_id`.
  - Preserve current section/tone/status behavior.

## Task 5: Mobile Workflow API Service And Types

**Files:**
- Modify: `mobile/src/types.ts`
- Create: `mobile/src/features/workflows/types.ts`
- Create: `mobile/src/features/workflows/services/workflowService.ts`
- Create: `mobile/src/features/workflows/services/workflowService.test.ts`
- Modify: `mobile/src/features/activity/services/activityService.ts`
- Modify: `mobile/src/features/activity/services/activityService.test.ts`

- [x] Write failing workflow service tests.
  - `fetchWorkflows(endpoint)` calls `GET /api/v1/workflows`.
  - `createWorkflow(endpoint, input)` calls `POST /api/v1/workflows`.
  - `updateWorkflow(endpoint, id, input)` calls `PATCH /api/v1/workflows/:id`.
  - `enableWorkflow` and `disableWorkflow` call the correct endpoints.
  - `fetchWorkflowRuns` calls `GET /api/v1/workflows/:id/runs`.

- [x] Implement workflow types and service.
  - Include `enabled`, not workflow status.
  - Map API fields consistently for screen consumption.

- [x] Extend Activity mobile service types.
  - Add optional workflow metadata.
  - Preserve legacy fallback behavior when old endpoints do not return workflow fields.

## Task 6: Mobile Workflow Screens

**Files:**
- Create: `mobile/app/(tabs)/workflows.tsx`
- Modify: `mobile/app/(tabs)/_layout.tsx`
- Create: `mobile/src/features/workflows/components/WorkflowListScreen.tsx`
- Create: `mobile/src/features/workflows/components/WorkflowListScreen.test.tsx`
- Create: `mobile/src/features/workflows/components/WorkflowFormScreen.tsx`
- Create: `mobile/src/features/workflows/components/WorkflowFormScreen.test.tsx`
- Create: `mobile/src/features/workflows/components/workflowScreenStyles.ts`

- [ ] Write failing list screen tests.
  - Empty state renders without endpoints.
  - A workflow row shows name, agent, next run, recent result, and ON/OFF.
  - Tapping the switch calls enable/disable callback.
  - Running/completed labels are not shown as workflow status.

- [ ] Write failing form screen tests.
  - Agent selector shows registered agents.
  - Daily/weekly segmented control changes visible schedule fields.
  - Empty prompt disables save or returns validation text.
  - Weekly schedule requires weekday and time.

- [ ] Implement screens using current iOS visual system.
  - Background `#0D0D0D`, surfaces `#1A1A1A`, accent `#FF6B35` only for action/ON state.
  - Use list rows and grouped forms, not large decorative cards.
  - Keep Activity untouched visually.

## Task 7: Mobile Data Integration And Activity Routing

**Files:**
- Modify: `mobile/app/(tabs)/workflows.tsx`
- Modify: `mobile/app/(tabs)/activity.tsx`
- Modify: `mobile/src/features/activity/components/ActivityScreen.tsx`
- Modify: `mobile/src/features/activity/components/ActivityScreen.test.tsx`

- [ ] Write failing integration tests.
  - Workflow list fetches from configured endpoints and shows endpoint context.
  - Activity row with `workflow_name` displays it as contextual metadata without changing row structure.
  - Opening Activity workflow row routes to the new conversation detail.

- [ ] Implement endpoint aggregation for workflows.
  - Follow the Activity service pattern: all configured endpoints, tolerate partial failures.
  - Keep workflow enable/disable scoped to the endpoint where the workflow lives.

- [ ] Implement Activity metadata rendering.
  - Keep existing title/subtitle/status/chevron row.
  - Add workflow name only in subtitle/meta text.

## Task 8: Docs, Review, And Full Verification

**Files:**
- Modify: `docs/exec-plans/index.json`
- Optionally modify: `docs/product-specs/index.json` only if the workflow spec is added to this worktree branch.
- Optionally modify: `mobile/docs/design.md` only if implementation introduces a reusable Workflow UI rule that belongs in the design system.

- [x] Update docs indexes.
  - Add this plan to `docs/exec-plans/index.json`.
  - Do not touch unrelated plan entries.

- [ ] Run CLI verification.
  - `cd cli && cargo test`
  - `cd cli && cargo build`

- [ ] Run Mobile verification.
  - `cd mobile && pnpm typecheck`
  - `cd mobile && pnpm test --watchAll=false`

- [ ] Run docs verification.
  - `python3 scripts/check-docs-indices.py`
  - If tracked code changed and a design doc must be kept fresh, follow the doc-code hash rule from `AGENTS.md` before finalizing.

- [ ] Request code review before commit.
  - Use `superpowers:requesting-code-review`.
  - Fix Critical/Important findings.
  - Re-run relevant verification.

## Acceptance Mapping

- New workflow creation/editing: Tasks 2, 5, 6.
- Daily/weekly scheduling and daemon timezone: Tasks 1, 3.
- ON/OFF workflow state only: Tasks 2, 6.
- New conversation per actual run: Task 3.
- Skip missed/overlap behavior: Tasks 1, 3.
- Run records with status/times/conversation/summary/error: Tasks 2, 3, 4.
- Activity visibility and click-through: Tasks 4, 7.
- Bearer auth: Task 2 route tests.
- Apple/MultiSoul visual direction: Tasks 6, 7.
