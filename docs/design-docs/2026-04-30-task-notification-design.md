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
- **Background/inactive**: schedule a local `UNUserNotificationCenter` notification with sound, title, and summary; tap navigates to the task's chat screen

APNs remote push is architecturally wired (device token registered and stored) but the backend integration is deferred to a future iteration.

---

## Architecture

### Components

| Component | File | Responsibility |
|-----------|------|----------------|
| `notificationService` | `src/services/notificationService.ts` | Schedule local notification or play foreground sound |
| `useWebSocket` | `src/hooks/useWebSocket.ts` | Detect `task_status` completed messages, call service |
| Root layout | `app/_layout.tsx` | Fix notification handler (suppress foreground banner), add tap-to-navigate listener |
| Sound asset | `assets/sounds/task-complete.wav` | Bundled short terminal-style beep |

### Data flow

```
WebSocket message (task_status, status=completed)
  └─> useWebSocket.onmessage
        └─> notificationService.notifyTaskComplete({ agentName, summary, agentId, convId, endpointId })
              ├─ AppState === 'active'  → Audio.Sound.createAsync(asset).playAsync()
              └─ AppState !== 'active' → Notifications.scheduleNotificationAsync(...)
                                              title: "[agentName] 任务完成"
                                              body: summary (truncated to 100 chars)
                                              userInfo: { agentId, convId, endpointId, type: 'task_completed' }
```

### Notification tap navigation

`addNotificationResponseReceivedListener` in `app/_layout.tsx` reads `userInfo` and calls:
```
router.push(`/chat/${convId}?endpoint_id=${endpointId}&agent_id=${agentId}`)
```
This handles both foreground tap and cold-start tap (via `getLastNotificationResponseAsync` on mount).

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
  "title": "[AgentName] 任务完成",
  "body": "summary text (≤100 chars, fallback: '点击查看详情')",
  "sound": "default",
  "data": {
    "type": "task_completed",
    "agentId": "string",
    "convId": "string",
    "endpointId": "string"
  }
}
```

---

## Permission flow

`registerPushToken()` in `app/_layout.tsx` already calls `requestPermissionsAsync()` on first launch. No changes needed. If denied, `notificationService` silently falls back to foreground-only sound (background notifications simply won't fire — iOS handles this).

---

## Dependencies

- `expo-av` — add to `package.json` for foreground sound playback
- `expo-notifications` — already installed
- Sound file: `assets/sounds/task-complete.wav` — short (~0.5s) terminal beep

---

## Files changed

1. `package.json` — add `expo-av`
2. `assets/sounds/task-complete.wav` — new sound asset
3. `src/services/notificationService.ts` — new service
4. `src/hooks/useWebSocket.ts` — handle `task_status` completed
5. `app/_layout.tsx` — fix handler, add tap listener, cold-start navigation

---

## Out of scope (this iteration)

- Backend APNs integration (`POST /api/v1/devices/token`)
- User-facing notification settings toggle
- Notifications for `ask_question`, `task_failed`, or other event types
- Notification grouping / deduplication
