# Task Completion Notification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Play a sound (foreground) or push a local notification (background) when an agent task completes, with tap-to-navigate to the task's chat screen.

**Architecture:** A new `notificationService` module handles the foreground/background split — it checks `AppState` and either plays a bundled `.wav` via `expo-av` or schedules a `UNUserNotificationCenter` local notification. `useWebSocket` is extended to call this service when it receives a `task_status` message with `status === 'completed'`. The root layout is updated to suppress foreground banners and handle notification taps for deep-linking.

**Tech Stack:** expo-notifications (already installed), expo-av (new), React Native AppState, Expo Router `router.push`

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `mobile/package.json` | Add `expo-av` dependency |
| Create | `mobile/assets/sounds/task-complete.wav` | Bundled terminal beep sound |
| Create | `mobile/src/services/notificationService.ts` | Foreground sound + background local notification |
| Create | `mobile/src/__tests__/notificationService.test.ts` | Unit tests for the service |
| Modify | `mobile/src/hooks/useWebSocket.ts` | Handle `task_status` completed, call service |
| Modify | `mobile/app/_layout.tsx` | Fix foreground suppression, add tap-to-navigate listener |

---

## Task 1: Install expo-av

**Files:**
- Modify: `mobile/package.json`

- [ ] **Step 1: Add expo-av to package.json**

In `mobile/package.json`, add to `dependencies` (match the expo 55 compatible version):

```json
"expo-av": "~15.0.2"
```

- [ ] **Step 2: Install**

```bash
cd mobile && pnpm install
```

Expected: `expo-av` appears in `node_modules/expo-av/`.

- [ ] **Step 3: Commit**

```bash
git add mobile/package.json mobile/pnpm-lock.yaml
git commit -m "chore(mobile): add expo-av for foreground task-complete sound"
```

---

## Task 2: Add the sound asset

**Files:**
- Create: `mobile/assets/sounds/task-complete.wav`

The project needs a short (~0.5s) terminal-style beep. We'll generate a minimal valid WAV file programmatically since we can't bundle a binary in the plan. Use this Node script once to produce the file:

- [ ] **Step 1: Generate the WAV file**

Run from `mobile/`:

```bash
node -e "
const fs = require('fs');
const sampleRate = 44100;
const duration = 0.3;
const freq = 880;
const numSamples = Math.floor(sampleRate * duration);
const buf = Buffer.alloc(44 + numSamples * 2);
// RIFF header
buf.write('RIFF', 0); buf.writeUInt32LE(36 + numSamples * 2, 4);
buf.write('WAVE', 8); buf.write('fmt ', 12);
buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
buf.writeUInt32LE(sampleRate, 24); buf.writeUInt32LE(sampleRate * 2, 28);
buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
buf.write('data', 36); buf.writeUInt32LE(numSamples * 2, 40);
for (let i = 0; i < numSamples; i++) {
  const t = i / sampleRate;
  const envelope = Math.exp(-t * 8);
  const sample = Math.round(envelope * Math.sin(2 * Math.PI * freq * t) * 16000);
  buf.writeInt16LE(sample, 44 + i * 2);
}
fs.mkdirSync('assets/sounds', { recursive: true });
fs.writeFileSync('assets/sounds/task-complete.wav', buf);
console.log('Written assets/sounds/task-complete.wav');
"
```

Expected output: `Written assets/sounds/task-complete.wav`

- [ ] **Step 2: Commit**

```bash
git add mobile/assets/sounds/task-complete.wav
git commit -m "feat(mobile): add task-complete beep sound asset"
```

---

## Task 3: Create notificationService

**Files:**
- Create: `mobile/src/services/notificationService.ts`
- Create: `mobile/src/__tests__/notificationService.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `mobile/src/__tests__/notificationService.test.ts`:

```typescript
import * as Notifications from 'expo-notifications';
import { AppState } from 'react-native';

// Mock expo-av
const mockPlayAsync = jest.fn().mockResolvedValue(undefined);
const mockUnloadAsync = jest.fn().mockResolvedValue(undefined);
const mockCreateAsync = jest.fn().mockResolvedValue({
  sound: { playAsync: mockPlayAsync, unloadAsync: mockUnloadAsync },
});
jest.mock('expo-av', () => ({
  Audio: {
    Sound: { createAsync: mockCreateAsync },
  },
}));

// Mock expo-notifications
jest.mock('expo-notifications', () => ({
  scheduleNotificationAsync: jest.fn().mockResolvedValue('notif-id'),
}));

// Mock the sound asset require
jest.mock('../../assets/sounds/task-complete.wav', () => 1, { virtual: true });

import { notifyTaskComplete } from '@/services/notificationService';

const baseArgs = {
  agentName: 'Deploy Bot',
  summary: 'Deployment finished successfully',
  agentId: 'agent-1',
  convId: 'conv-1',
  endpointId: 'ep-1',
};

describe('notifyTaskComplete', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('plays sound and does NOT schedule notification when app is active', async () => {
    /// App is in foreground (active state).
    /// Expected: sound plays, no notification scheduled.
    jest.spyOn(AppState, 'currentState', 'get').mockReturnValue('active');

    await notifyTaskComplete(baseArgs);

    expect(mockCreateAsync).toHaveBeenCalledTimes(1);
    expect(mockPlayAsync).toHaveBeenCalledTimes(1);
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('schedules notification and does NOT play sound when app is background', async () => {
    /// App is in background state.
    /// Expected: local notification scheduled with correct content, no sound played.
    jest.spyOn(AppState, 'currentState', 'get').mockReturnValue('background');

    await notifyTaskComplete(baseArgs);

    expect(mockCreateAsync).not.toHaveBeenCalled();
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    const call = (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls[0][0];
    expect(call.content.title).toBe('Deploy Bot 任务完成');
    expect(call.content.body).toBe('Deployment finished successfully');
    expect(call.content.data).toMatchObject({
      type: 'task_completed',
      agentId: 'agent-1',
      convId: 'conv-1',
      endpointId: 'ep-1',
    });
    expect(call.trigger).toBeNull();
  });

  it('truncates summary to 100 chars in notification body', async () => {
    /// Summary longer than 100 chars should be truncated with ellipsis.
    jest.spyOn(AppState, 'currentState', 'get').mockReturnValue('background');
    const longSummary = 'A'.repeat(120);

    await notifyTaskComplete({ ...baseArgs, summary: longSummary });

    const call = (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls[0][0];
    expect(call.content.body.length).toBeLessThanOrEqual(103); // 100 + '...'
    expect(call.content.body).toMatch(/\.\.\.$/);
  });

  it('uses fallback body when summary is empty', async () => {
    /// Empty summary should fall back to a default message.
    jest.spyOn(AppState, 'currentState', 'get').mockReturnValue('background');

    await notifyTaskComplete({ ...baseArgs, summary: '' });

    const call = (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls[0][0];
    expect(call.content.body).toBe('点击查看详情');
  });

  it('unloads sound after playing to free memory', async () => {
    /// Sound object should be unloaded after playback to avoid memory leaks.
    jest.spyOn(AppState, 'currentState', 'get').mockReturnValue('active');

    await notifyTaskComplete(baseArgs);

    expect(mockUnloadAsync).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd mobile && pnpm test -- --watchAll=false --testPathPattern="notificationService"
```

Expected: FAIL — `Cannot find module '@/services/notificationService'`

- [ ] **Step 3: Implement notificationService**

Create `mobile/src/services/notificationService.ts`:

```typescript
import * as Notifications from 'expo-notifications';
import { AppState } from 'react-native';

interface NotifyTaskCompleteArgs {
  agentName: string;
  summary: string;
  agentId: string;
  convId: string;
  endpointId: string;
}

export async function notifyTaskComplete({
  agentName,
  summary,
  agentId,
  convId,
  endpointId,
}: NotifyTaskCompleteArgs): Promise<void> {
  if (AppState.currentState === 'active') {
    await playForegroundSound();
  } else {
    await scheduleBackgroundNotification({ agentName, summary, agentId, convId, endpointId });
  }
}

async function playForegroundSound(): Promise<void> {
  const { Audio } = await import('expo-av');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const asset = require('../../assets/sounds/task-complete.wav') as number;
  const { sound } = await Audio.Sound.createAsync(asset);
  await sound.playAsync();
  // Unload after a short delay to allow playback to complete
  setTimeout(() => {
    void sound.unloadAsync();
  }, 2000);
}

async function scheduleBackgroundNotification({
  agentName,
  summary,
  agentId,
  convId,
  endpointId,
}: NotifyTaskCompleteArgs): Promise<void> {
  const body = summary.length === 0
    ? '点击查看详情'
    : summary.length > 100
    ? summary.slice(0, 100) + '...'
    : summary;

  await Notifications.scheduleNotificationAsync({
    content: {
      title: `${agentName} 任务完成`,
      body,
      sound: 'default',
      data: {
        type: 'task_completed',
        agentId,
        convId,
        endpointId,
      },
    },
    trigger: null,
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd mobile && pnpm test -- --watchAll=false --testPathPattern="notificationService"
```

Expected: PASS — 5 tests passing

- [ ] **Step 5: Commit**

```bash
git add mobile/src/services/notificationService.ts mobile/src/__tests__/notificationService.test.ts
git commit -m "feat(mobile): add notificationService for task-complete alerts"
```

---

## Task 4: Handle task_status in useWebSocket

**Files:**
- Modify: `mobile/src/hooks/useWebSocket.ts`

The hook currently ignores `task_status` messages. We need to call `notifyTaskComplete` when `status === 'completed'`.

- [ ] **Step 1: Write the failing test**

Add a new test file `mobile/src/__tests__/useWebSocketNotification.test.ts`:

```typescript
/// Tests that useWebSocket calls notifyTaskComplete when a task_status
/// message with status=completed arrives over the WebSocket.

import { renderHook, act } from '@testing-library/react-native';
import { useWebSocket } from '@/hooks/useWebSocket';

// Mock notificationService
const mockNotifyTaskComplete = jest.fn().mockResolvedValue(undefined);
jest.mock('@/services/notificationService', () => ({
  notifyTaskComplete: mockNotifyTaskComplete,
}));

// Mock dependencies
jest.mock('@/features/chat/services/chatService', () => ({
  fetchMessages: jest.fn().mockResolvedValue([]),
}));
jest.mock('@/features/inbox/services/inboxService', () => ({
  markAskAnswered: jest.fn(),
}));
jest.mock('@/features/inbox/utils/buildAskQuestionInboxItem', () => ({
  buildAskQuestionInboxItem: jest.fn(),
}));
jest.mock('@/store/chatStore', () => ({
  useChatStore: (sel: (s: unknown) => unknown) =>
    sel({ messages: {}, appendMessage: jest.fn(), setMessages: jest.fn(), markAnswered: jest.fn() }),
}));
jest.mock('@/store/inboxStore', () => ({
  useInboxStore: (sel: (s: unknown) => unknown) =>
    sel({ addItem: jest.fn(), removeItem: jest.fn() }),
}));

// Minimal WebSocket mock
class MockWebSocket {
  static OPEN = 1;
  readyState = MockWebSocket.OPEN;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  send = jest.fn();
  close = jest.fn();
}
let mockWs: MockWebSocket;
global.WebSocket = jest.fn().mockImplementation(() => {
  mockWs = new MockWebSocket();
  return mockWs;
}) as unknown as typeof WebSocket;

describe('useWebSocket task_status notification', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('calls notifyTaskComplete when task_status completed message arrives', async () => {
    /// A task_status message with status=completed should trigger notifyTaskComplete
    /// with the agent name and task summary.
    renderHook(() =>
      useWebSocket({
        base_url: 'http://localhost:8080',
        token: 'tok',
        conv_id: 'conv-1',
        endpoint_id: 'ep-1',
        agent_id: 'agent-1',
        agent_name: 'Deploy Bot',
      }),
    );

    await act(async () => {
      mockWs.onopen?.();
    });

    await act(async () => {
      mockWs.onmessage?.({
        data: JSON.stringify({
          type: 'message',
          seq: 5,
          role: 'task_status',
          payload: {
            task_id: 'task-abc',
            status: 'completed',
            importance: 'normal',
            summary: 'Build succeeded',
          },
          created_at: Date.now(),
        }),
      });
    });

    expect(mockNotifyTaskComplete).toHaveBeenCalledTimes(1);
    expect(mockNotifyTaskComplete).toHaveBeenCalledWith({
      agentName: 'Deploy Bot',
      summary: 'Build succeeded',
      agentId: 'agent-1',
      convId: 'conv-1',
      endpointId: 'ep-1',
    });
  });

  it('does NOT call notifyTaskComplete for task_status with status=running', async () => {
    /// Only completed tasks should trigger a notification, not running ones.
    renderHook(() =>
      useWebSocket({
        base_url: 'http://localhost:8080',
        token: 'tok',
        conv_id: 'conv-1',
        endpoint_id: 'ep-1',
        agent_id: 'agent-1',
        agent_name: 'Deploy Bot',
      }),
    );

    await act(async () => {
      mockWs.onopen?.();
    });

    await act(async () => {
      mockWs.onmessage?.({
        data: JSON.stringify({
          type: 'message',
          seq: 3,
          role: 'task_status',
          payload: {
            task_id: 'task-abc',
            status: 'running',
            importance: 'normal',
            summary: '',
          },
          created_at: Date.now(),
        }),
      });
    });

    expect(mockNotifyTaskComplete).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd mobile && pnpm test -- --watchAll=false --testPathPattern="useWebSocketNotification"
```

Expected: FAIL — `notifyTaskComplete` not called (function not yet wired up)

- [ ] **Step 3: Modify useWebSocket to call notifyTaskComplete**

In `mobile/src/hooks/useWebSocket.ts`, add the import at the top (after existing imports):

```typescript
import { notifyTaskComplete } from '@/services/notificationService';
```

Then in the `ws.onmessage` handler, after the existing `ask_question` block (around line 122), add:

```typescript
          // Notify user when a task completes
          if (msg.role === 'task_status' && msg.payload) {
            const p = msg.payload as TaskStatusPayload;
            if (p.status === 'completed') {
              void notifyTaskComplete({
                agentName: agent_name ?? agent_id,
                summary: p.summary,
                agentId: agent_id,
                convId: conv_id,
                endpointId: endpoint_id,
              });
            }
          }
```

Also add `TaskStatusPayload` to the existing import from `@/types` (it's already imported in `app/agent/[id]/chat.tsx` but not in this hook):

```typescript
import { type WsMessage, type AskQuestionPayload, InboxItem, type TaskStatusPayload } from '@/types';
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd mobile && pnpm test -- --watchAll=false --testPathPattern="useWebSocketNotification"
```

Expected: PASS — 2 tests passing

- [ ] **Step 5: Run full test suite to check for regressions**

```bash
cd mobile && pnpm test -- --watchAll=false
```

Expected: all tests pass

- [ ] **Step 6: Commit**

```bash
git add mobile/src/hooks/useWebSocket.ts mobile/src/__tests__/useWebSocketNotification.test.ts
git commit -m "feat(mobile): trigger task-complete notification from WebSocket handler"
```

---

## Task 5: Fix root layout — foreground suppression + tap navigation

**Files:**
- Modify: `mobile/app/_layout.tsx`

Two changes:
1. The current `setNotificationHandler` shows banners even when the app is active. Fix it to suppress banners/sound when active (the service handles sound directly).
2. Add `addNotificationResponseReceivedListener` to navigate to the task's chat screen when the user taps a notification. Also handle cold-start (app killed) via `getLastNotificationResponseAsync`.

- [ ] **Step 1: Update setNotificationHandler to suppress foreground banners**

In `mobile/app/_layout.tsx`, replace the existing `setNotificationHandler` block:

```typescript
// Before:
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});
```

```typescript
// After:
import { AppState } from 'react-native';

Notifications.setNotificationHandler({
  handleNotification: async () => {
    const isForeground = AppState.currentState === 'active';
    return {
      shouldShowAlert: !isForeground,
      shouldPlaySound: !isForeground,
      shouldSetBadge: true,
      shouldShowBanner: !isForeground,
      shouldShowList: true,
    };
  },
});
```

Note: `AppState` must be imported from `react-native`. Add it to the existing import line.

- [ ] **Step 2: Add tap-to-navigate listener in RootLayout**

In `mobile/app/_layout.tsx`, add the `useRouter` import from `expo-router`:

```typescript
import { Stack, useRouter } from 'expo-router';
```

Then add a helper function outside the component (after `registerPushToken`):

```typescript
function getNotificationNavTarget(
  data: Record<string, string | undefined>,
): string | null {
  if (data?.type !== 'task_completed') return null;
  const { agentId, convId, endpointId } = data;
  if (!agentId || !convId || !endpointId) return null;
  return `/agent/${agentId}/chat?conv_id=${convId}&endpoint_id=${endpointId}`;
}
```

Inside `RootLayout`, add `useRouter` and two new `useEffect` hooks — one for tap responses, one for cold-start:

```typescript
  const router = useRouter();

  // Handle notification tap while app is running
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as Record<string, string | undefined>;
      const target = getNotificationNavTarget(data);
      if (target) router.push(target as Parameters<typeof router.push>[0]);
    });
    return () => sub.remove();
  }, [router]);

  // Handle cold-start: app was killed, user tapped notification to open it
  useEffect(() => {
    if (!splashDone) return;
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!response) return;
      const data = response.notification.request.content.data as Record<string, string | undefined>;
      const target = getNotificationNavTarget(data);
      if (target) router.push(target as Parameters<typeof router.push>[0]);
    });
  }, [splashDone, router]);
```

- [ ] **Step 3: Type-check**

```bash
cd mobile && pnpm typecheck
```

Expected: no errors

- [ ] **Step 4: Run full test suite**

```bash
cd mobile && pnpm test -- --watchAll=false
```

Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add mobile/app/_layout.tsx
git commit -m "feat(mobile): suppress foreground notification banners and add tap-to-navigate"
```

---

## Task 6: Manual smoke test checklist

No automated test can cover the full iOS notification flow. After building and running on a device or simulator:

- [ ] **Foreground test:** Open the app, trigger a task completion via WebSocket (or send a mock `task_status` message from the server). Verify: a short beep plays, no notification banner appears.

- [ ] **Background test:** Start a task, press the Home button to background the app, wait for task completion. Verify: a notification banner appears with title `"[AgentName] 任务完成"` and the task summary as body.

- [ ] **Tap test:** Tap the background notification. Verify: app opens and navigates directly to the agent's chat screen for that conversation.

- [ ] **Cold-start test:** Kill the app, wait for a task to complete (requires APNs or a queued local notification), tap the notification. Verify: app launches and navigates to the correct chat screen.

- [ ] **Permission denied test:** Reset notification permissions (Settings > [App] > Notifications > off), relaunch app. Verify: no crash, foreground sound still plays.
