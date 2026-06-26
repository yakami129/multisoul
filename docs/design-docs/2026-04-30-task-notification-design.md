---
title: Task Completion Notification — Design
date: 2026-04-30
status: approved
migrated_from: docs/superpowers/specs/2026-04-30-task-notification-design.md
---

# Task Completion Notification — Design

## Overview

When an agent task completes, the app notifies the user:
- **Foreground**: play a bundled `.wav` sound via `expo-av`, no banner
- **Background/inactive**: CLI sends one Expo remote push with sound, title, and summary; tap navigates to the task's chat screen

Notification ownership is centralized in the CLI to avoid duplicate local + remote notifications. Mobile WebSocket handlers update chat and inbox state only; they do not schedule a second local notification for `task_status`. When an answer is sent from Chat, `useWebSocket` waits for CLI `answer_status(ok=true)` before marking the ask answered locally; failures leave the ask pending so Activity and Chat do not hide an unanswered decision.

2026-05-24 chat performance update: `useWebSocket` now accepts a bounded catch-up cursor from the Chat screen so reconnects fetch only messages newer than the loaded window instead of replaying full history. This keeps the notification ownership rule unchanged: the hook still mirrors state and inbox items only, and does not schedule mobile-side completion notifications.

2026-06-01 workflow update: runtime task completion now also finalizes any matching `workflow_runs` row for the conversation before sending the existing task status push. This records workflow run status and summary, while preserving the notification ownership rule and the task completion payload shape.

2026-06-04 Activity realtime events update: runtime task completion still sends the same CLI-owned Expo push. Claude stream now also emits a global `activity_changed` refresh signal after broadcasting terminal `task_status`, so Activity can refetch its REST snapshot while the app is visible. This does not change notification ownership, push payload shape, or mobile-side local notification rules.

2026-06-10 Claude session capture update: `claude/stream.rs` now persists `claude_session_id` and handles stale `--resume` inside the `process_turn` stdout loop. AskUserQuestion registration, pending-question push timing, and task completion push ownership are unchanged.

2026-06-11 iOS telemetry update: `useWebSocket` now records `ws_error` telemetry on connection failures via `TelemetryService`. This is observability-only and does not schedule local notifications or change chat/inbox state handling.

2026-06-26 project/session/resource update: task and ask-question pushes now load conversation context from `conversations -> agents -> projects`. Titles prefer the project name and fall back to the resource/agent name. Payloads preserve legacy `agentId` / `agent_id` while also carrying `resourceId` / `resource_id` and optional `projectId` / `project_id`, so notification taps can deep-link into the exact project conversation or pending decision card without breaking older mobile clients.

---

## Architecture

### Components

| Component | File | Responsibility |
|-----------|------|----------------|
| CLI push builder | `cli/src/serve/push.rs` | Build Expo payloads for task completion/failure and pending questions |
| Claude runtime | `cli/src/serve/runtime/claude/stream.rs` | Detect AskUserQuestion control_request; delegate to `serve/ask_question.rs` to register pending ask, persist/broadcast `ask_question`, then send pending-question push |
| `useWebSocket` | `src/hooks/useWebSocket.ts` | Update chat state from `task_status` / `ask_question` / `answer_status`; never schedule duplicate local notifications |
| Root layout | `app/_layout.tsx` | Register push tokens, suppress foreground banner, add tap-to-navigate listener |
| Sound asset | `assets/sounds/task-complete.wav` | Bundled short terminal-style beep |

### Data flow

```
Claude emits AskUserQuestion
  └─> claude_stream registers pending ask, inserts/broadcasts ask_question
        └─> push.send_ask_question_push(...)
              └─> Expo payload kind=pending_question, inbox_id=ask_id, payload=AskQuestionPayload

Runtime emits task_status completed/failed
  └─> push.send_task_status_push(...)
        ├─ skip if current user turn already produced ask_question
        └─ send one Expo payload per unique Expo token type=task_completed/task_failed

The CLI may store multiple `push_tokens` rows for the same phone when the same Expo token is registered under multiple `endpoint_id` values. Push fan-out deduplicates by `expo_push_token` before calling Expo and keeps the newest registered row's `endpoint_id` for tap navigation.

Mobile receives WS task_status
  └─> update conversation status only

Mobile sends WS answer
  └─> wait for CLI answer_status
        ├─ ok=true  → mark ask answered locally
        └─ ok=false → keep ask pending; no notification scheduling
```

### Notification tap navigation

`addNotificationResponseReceivedListener` in `app/_layout.tsx` reads `userInfo` and calls:
```
router.push(`/chat/${convId}?endpoint_id=${endpointId}&agent_id=${resourceId}&project_id=${projectId}&focus_ask_id=${askId}`)
```
`project_id` and `focus_ask_id` are optional. `focus_ask_id` is only present for ask-question pushes. This handles both foreground tap and cold-start tap (via `getLastNotificationResponseAsync` on mount).

### Foreground suppression fix

The current `setNotificationHandler` returns `shouldShowAlert: true` unconditionally. Fix: check `AppState.currentState`:
```ts
handleNotification: async () => ({
  shouldShowAlert: AppState.currentState !== 'active',
  shouldPlaySound: AppState.currentState !== 'active',
  shouldSetBadge: true,
  shouldShowBanner: AppState.currentState !== 'active',
  shouldShowList: true,
}),
```
When active, the service plays the sound directly; the notification handler suppresses the banner.

---

## Notification payload

```json
{
  "title": "[ProjectName] 任务完成",
  "body": "summary text (≤100 chars, fallback: '点击查看详情')",
  "sound": "default",
  "data": {
    "type": "task_completed",
    "agentId": "string",
    "agent_id": "string",
    "resourceId": "string",
    "resource_id": "string",
    "resourceName": "string",
    "resource_name": "string",
    "convId": "string",
    "conversation_id": "string",
    "endpointId": "string",
    "endpoint_id": "string",
    "projectId": "string (optional)",
    "project_id": "string (optional)",
    "projectName": "string (optional)",
    "project_name": "string (optional)"
  }
}
```

For `ask_question`, the same conversation/resource/project identity fields are sent with `type=ask_question`, `kind=pending_question`, `inbox_id=<ask_id>`, and `payload=<AskQuestionPayload JSON string>`.

---

## Permission flow

`registerPushTokenForEndpoints()` in `app/_layout.tsx` requests notification permission and registers the Expo push token with each endpoint. If denied, CLI push cannot display a system notification; WS state updates still work while the app is connected.

---

## Dependencies

- `expo-notifications` — already installed
- Sound file: `assets/sounds/task-complete.wav` — short (~0.5s) terminal beep

---

## Files changed

1. `cli/src/serve/push.rs` — task/ask push payload construction, token fan-out, mutual exclusion（2026-06-07：watch workflow 结束时新增 `watch_completed` 推送，复用 token fan-out；2026-06-26：task/ask push payload 新增 project/resource 上下文，保留 agent 字段兼容旧客户端）
2. `cli/src/serve/runtime/claude/stream.rs` + `cli/src/serve/ask_question.rs` — register pending ask before ask-question push/broadcast（2026-05-31：`record_ask_question` 抽到 `ask_question.rs`，推送时机与 payload 不变；2026-06-04：terminal `task_status` 后追加 Activity refresh signal，推送 payload 不变；2026-06-07：terminal result 完成 workflow run 后会触发 watch stop/schedule 检查，task_status 推送语义不变；2026-06-10：`process_turn` 内新增 session_id 捕获与 stale resume 处理，AskUserQuestion / task push 语义不变）
3. `src/hooks/useWebSocket.ts` — remove local completion notification scheduling and apply answered state only after `answer_status(ok=true)`
4. `app/_layout.tsx` — token registration, handler, tap listener, cold-start navigation

---

## Out of scope (this iteration)

- User-facing notification settings toggle
- Notification grouping beyond same-token deduplication
