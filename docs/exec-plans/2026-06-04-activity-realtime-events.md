# Activity Realtime Events Implementation Plan

> **For agentic workers:** REQUIRED EXECUTION MODE SELECTION: after this plan is written, use the repository's Ask User Question flow to choose either subagent-driven execution or current-session inline execution before product code edits. Steps use checkbox (`- [ ]`) syntax for tracking. Before writing code for any task, add or update the failing tests first.

**Spec:** [`docs/product-specs/2026-06-04-SPEC-activity-realtime-events.md`](../product-specs/2026-06-04-SPEC-activity-realtime-events.md)

**Goal:** Make Activity status update in near real time while the Activity tab is visible. Keep `/api/v1/activity` as the authoritative snapshot, add a lightweight endpoint-level Activity event socket that only emits refresh signals, and replace 15-second polling with event-driven first-page refresh plus low-frequency polling fallback.

**Architecture:** Add an endpoint-level Activity event broadcast channel to CLI `AppState`, expose it through an authenticated `/ws/activity` route, and emit `activity_changed` signals from all write paths that affect Activity sections, visibility, sorting, or read state. Mobile opens one Activity event socket per configured endpoint only while Activity is focused and the app is active. Socket open/reconnect and debounced `activity_changed` events call the existing first-page Activity refresh path; REST remains the source of truth.

**Tech Stack:** Rust, axum WebSocket, tokio broadcast channels, rusqlite, Expo Router, React Native, React Query, Jest + React Native Testing Library, TypeScript

---

## Task 0: Worktree, Baseline, And Guardrails

**Files:**
- Reference: `docs/product-specs/2026-06-04-SPEC-activity-realtime-events.md`
- Modify: `docs/exec-plans/index.json`
- Modify after implementation only if required: related design docs with reviewed hash refresh

- [x] Record current `git status --short`; preserve unrelated existing changes such as `mobile/app.json`.
- [x] Register this plan in `docs/exec-plans/index.json`.
- [x] Run docs index validation:

```bash
python3 scripts/check-docs-indices.py
```

Expected: PASS.

- [x] After this plan is written, push an Ask User Question card for execution mode: "Subagent driven" or "current-session inline".
- [x] Do not begin product code edits until execution mode is selected.

## Task 1: CLI Activity Event Bus And WebSocket Route

**Files:**
- Modify: `cli/src/serve/state.rs`
- Add: `cli/src/serve/routes/activity_events.rs`
- Modify: `cli/src/serve/routes/mod.rs`
- Modify: `cli/src/serve/mod.rs`
- Add or modify focused tests under `cli/src/serve/routes/**`

- [x] **Step 1: Write failing CLI route tests**

Add tests that verify:

- `GET /ws/activity` without auth returns 401.
- `GET /ws/activity?token=<valid>` upgrades successfully.
- A subscriber receives one `activity_changed` frame after the server emits a test event.

Use existing router/auth test patterns where possible. If full WebSocket integration is too heavy for the first test, isolate the bus helper and cover unauthorized route behavior separately.

- [x] **Step 2: Verify RED**

```bash
cd cli && cargo test activity_events
```

Expected: FAIL because the route/helper does not exist.

- [x] **Step 3: Add endpoint-level Activity event bus**

Extend `AppState` with an Activity broadcast sender independent of the existing per-conversation `bus`. Add a helper shape equivalent to:

```rust
pub fn activity_sender(&self) -> tokio::sync::broadcast::Sender<String>;
```

The Activity bus is endpoint-level, not per conversation, because one mobile endpoint connection needs all Activity changes for that local `msctl serve`.

- [x] **Step 4: Add `/ws/activity` route**

Implement a route that:

- Runs behind existing Bearer/query-token auth.
- Subscribes to the Activity event bus.
- Sends text frames to the WebSocket client.
- Accepts optional client `ping` frames and can reply `pong`.
- Cleans up cleanly when the client disconnects.

Register route in `build_router` near other WebSocket routes.

- [x] **Step 5: Verify GREEN**

```bash
cd cli && cargo test activity_events
```

Expected: PASS.

## Task 2: CLI Activity Change Emission Coverage

**Files:**
- Add or modify: `cli/src/serve/activity_events.rs` or `cli/src/serve/routes/activity_events.rs`
- Modify: `cli/src/serve/routes/conversations.rs`
- Modify: `cli/src/serve/routes/messages.rs`
- Modify: `cli/src/serve/routes/ws.rs`
- Modify: `cli/src/serve/ask_question.rs`
- Modify: `cli/src/serve/runtime/codex/turn.rs`
- Modify: `cli/src/serve/runtime/cursor/db.rs`
- Modify as needed: `cli/src/serve/runtime/claude/**`
- Modify as needed: `cli/src/serve/runtime/kodax/**`
- Modify as needed: `cli/src/serve/workflows.rs`
- Add or modify focused CLI tests

- [x] **Step 1: Write failing emission tests**

Cover at least:

- Posting a user message emits `activity_changed(reason=user_message)`.
- Recording an ask question emits `activity_changed(reason=awaiting_question)`.
- Accepting an answer emits `activity_changed(reason=answer_accepted)`.
- Completing a turn emits `activity_changed(reason=task_terminal)`.
- Marking Done read emits `activity_changed(reason=read_state_changed)`.

Use direct bus subscription tests where route-level WebSocket tests would be slow or brittle.

- [x] **Step 2: Verify RED**

```bash
cd cli && cargo test activity_changed
```

Expected: FAIL before emit calls are wired.

- [x] **Step 3: Implement a single emit helper**

Add a helper with a stable event payload:

```json
{
  "type": "activity_changed",
  "conversation_id": "conv-123",
  "reason": "awaiting_question",
  "timestamp": 1760000000000
}
```

Rules:

- `conversation_id` may be omitted or null only for endpoint-level changes.
- `reason` is a string enum by convention.
- Emission must not require DB access after the write transaction has completed.
- Failed sends should not fail the user-facing request; broadcast receiver count may be zero.

- [x] **Step 4: Wire required write paths**

Emit events for:

- `conversation_created` in create conversation.
- `user_message` after user message insert + dispatch.
- `awaiting_question` after ask question persistence and status update.
- `answer_accepted` after answer persistence/status update succeeds.
- `task_terminal` after completed/failed status and `task_status` insert.
- `aborted` after abort sets conversation idle.
- `deleted` after delete succeeds.
- `read_state_changed` after mark-one and mark-all Done read mutations.
- `workflow_changed` when workflow run creation/finalization affects Activity.

Runtime-specific terminal handlers should all route through a shared terminal helper where possible, rather than duplicating event payload construction.

- [x] **Step 5: Verify GREEN**

```bash
cd cli && cargo test activity_changed
```

Expected: PASS.

## Task 3: Mobile Activity Event Service And Hook

**Files:**
- Add: `mobile/src/features/activity/services/activityEventService.ts`
- Add: `mobile/src/features/activity/hooks/useActivityEvents.ts`
- Add: `mobile/src/features/activity/hooks/useActivityEvents.test.tsx`
- Modify only if needed: `mobile/src/features/activity/index.ts`

- [x] **Step 1: Write failing hook tests**

Mock `WebSocket` and verify:

- The hook opens one socket per endpoint when enabled.
- The URL uses `/ws/activity?token=` with encoded endpoint token.
- `onRefresh` runs once when socket opens.
- `onRefresh` runs once for a burst of `activity_changed` frames after debounce.
- Socket close triggers reconnect while still enabled.
- Cleanup closes sockets and prevents stale reconnects.
- Malformed frames are ignored.

- [x] **Step 2: Verify RED**

```bash
cd mobile && pnpm test -- useActivityEvents.test.tsx --watchAll=false
```

Expected: FAIL because the hook does not exist.

- [x] **Step 3: Implement event service URL builder**

Create a small service that builds:

```txt
ws://host/ws/activity?token=<encoded token>
```

It should mirror existing conversation WebSocket URL conversion from `http/https` to `ws/wss`.

- [x] **Step 4: Implement `useActivityEvents`**

Hook responsibilities:

- Accept endpoints, enabled flag, and `onRefresh`.
- Open sockets only when enabled and endpoint list is non-empty.
- Maintain one socket per endpoint.
- Reconnect with capped exponential backoff while enabled.
- Refresh on socket open/reconnect.
- Debounce `activity_changed` refreshes.
- Close sockets and timers on cleanup.
- Use no `console.log`; warnings are acceptable only if useful and consistent with mobile logging rules.

- [x] **Step 5: Verify GREEN**

```bash
cd mobile && pnpm test -- useActivityEvents.test.tsx --watchAll=false
```

Expected: PASS.

## Task 4: Mobile ActivityTab Integration And Low-Frequency Fallback

**Files:**
- Modify: `mobile/app/(tabs)/activity.tsx`
- Modify tests: `mobile/src/__tests__/activityRoute.test.tsx`
- Modify tests if needed: `mobile/src/__tests__/activityPaginationRoute.test.tsx`

- [x] **Step 1: Write failing route tests**

Cover:

- Activity focused + app active enables Activity event hook.
- Activity unfocused disables Activity event hook.
- App background disables Activity event hook.
- Event-triggered refresh calls `refreshFirstPage`.
- Low-frequency fallback polling uses 60 seconds, not 15 seconds.
- Polling still stops on unfocus/background.

- [x] **Step 2: Verify RED**

```bash
cd mobile && pnpm test -- activityRoute.test.tsx --watchAll=false
```

Expected: FAIL because ActivityTab still uses 15-second polling and no event hook.

- [x] **Step 3: Integrate `useActivityEvents`**

Update ActivityTab:

- Enable event hook only when `focused && appState === 'active'`.
- Pass the same endpoint list used by `useActivityInfiniteQuery`.
- Use `refreshFirstPage` for socket open/reconnect and event-triggered refresh.
- Preserve pull-to-refresh behavior.
- Preserve Done read optimistic overrides.
- Preserve delete/abort behavior.

- [x] **Step 4: Replace 15-second polling with low-frequency fallback**

Set fallback interval to 60 seconds while Activity is visible and active. The fallback calls `refreshFirstPage`, not load-more pagination.

If an Activity refetch is already in flight, avoid creating an unbounded request pile. Prefer React Query's existing dedupe where sufficient; add an explicit guard only if tests show overlapping requests.

- [x] **Step 5: Verify GREEN**

```bash
cd mobile && pnpm test -- activityRoute.test.tsx --watchAll=false
cd mobile && pnpm test -- activityPaginationRoute.test.tsx --watchAll=false
```

Expected: PASS.

## Task 5: End-To-End Behavior And Regression Tests

**Files:**
- Modify or add focused CLI tests under `cli/src/serve/**`
- Modify or add focused mobile tests under `mobile/src/**`

- [x] Add a CLI test showing an `ask_question` write produces both DB-backed Activity state and an Activity event signal.
- [x] Add a CLI test showing terminal task status produces both Done state and an Activity event signal.
- [x] Add a mobile test showing socket failure does not turn Activity REST data into a failed endpoint state.
- [x] Add a mobile test showing repeated events do not remove already loaded Activity rows unexpectedly.
- [x] Run focused CLI tests:

```bash
cd cli && cargo test activity
```

Expected: PASS.

- [x] Run focused mobile tests:

```bash
cd mobile && pnpm test -- useActivityEvents.test.tsx --watchAll=false
cd mobile && pnpm test -- activityRoute.test.tsx --watchAll=false
cd mobile && pnpm test -- activityPaginationRoute.test.tsx --watchAll=false
```

Expected: PASS.

## Task 6: Full Verification And Completion

**Files:**
- Modify if needed: `docs/exec-plans/index.json`
- Modify if needed after reviewed diff: design docs and doc code hashes

- [x] Run CLI tests:

```bash
cd cli && cargo test
```

Expected: PASS.

- [x] Run CLI build:

```bash
cd cli && cargo build
```

Expected: PASS.

- [x] Run mobile typecheck:

```bash
cd mobile && pnpm typecheck
```

Expected: PASS.

- [x] Run mobile tests:

```bash
cd mobile && pnpm test -- --watchAll=false
```

Expected: PASS.

- [x] Run docs index validation:

```bash
python3 scripts/check-docs-indices.py
```

Expected: PASS.

- [x] Review `git diff` for design-doc hash implications. If tracked code changes affect a design doc with code hashes, update only the relevant document after reviewing the diff.
- [ ] Before any commit, perform the repository-required code review flow and fix Critical/Important findings.
- [ ] If committing this full plan, commit once after all tasks pass.
- [ ] After commit, write the 40-character SHA into this plan's `lastCompletedCommit` entry in `docs/exec-plans/index.json`.

---

## Acceptance Mapping

- [x] CLI has an authenticated Activity event socket.
- [x] Activity event payloads are refresh signals only, not list snapshots or item deltas.
- [x] CLI emits Activity events from all write paths that affect Activity state.
- [x] Mobile connects Activity events only while Activity is focused and AppState is active.
- [x] Socket open/reconnect refreshes the Activity first page.
- [x] `activity_changed` frames debounce into first-page refreshes.
- [x] The previous 15-second polling path is replaced with a low-frequency fallback.
- [x] REST `/api/v1/activity` remains the Activity source of truth.
- [x] Event socket failures do not corrupt existing Activity REST failure handling.
- [x] Focused CLI/mobile tests and full validation commands pass.
