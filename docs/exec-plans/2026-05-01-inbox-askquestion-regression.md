# Inbox AskQuestion Regression Fix Plan

**Goal:** Ensure every unanswered `ask_question` message appears in Inbox as an answerable item, including messages received through realtime WebSocket, reconnect catch-up, initial chat history load, and notification/deep-link flows.

**Architecture:** Centralize "mirror ask question message to Inbox" behavior in a small helper so realtime and fetched-message paths cannot drift. Keep Inbox storage idempotent, but update existing rows when a better payload arrives so old/null notification rows do not suppress answerable content.

**Tech Stack:** React Native + Expo, Zustand, Jest, TypeScript.

---

## Root Cause Summary

- `useWebSocket` mirrors `ask_question` into Inbox only for realtime `ws.onmessage` events.
- `fetchMessages()` paths in `mobile/app/chat/[id].tsx` and `mobile/app/agent/[id]/chat.tsx` render question cards in Chat but do not backfill Inbox.
- Reconnect catch-up in `useWebSocket` appends fetched messages but does not backfill Inbox.
- Notification-created Inbox rows use `payload: null`; `InboxScreen` only treats `pending_question` as answerable when `payload !== null`.
- `writeInboxItem()` uses `INSERT OR IGNORE`, so a stale/null row for the same `ask_id` blocks later payload repair.

## Files

- Create: `mobile/src/features/inbox/utils/mirrorAskQuestionsToInbox.ts`
- Create: `mobile/src/__tests__/mirrorAskQuestionsToInbox.test.ts`
- Modify: `mobile/src/features/inbox/services/inboxService.ts`
- Modify: `mobile/src/store/inboxStore.ts`
- Modify: `mobile/src/hooks/useWebSocket.ts`
- Modify: `mobile/app/chat/[id].tsx`
- Modify: `mobile/app/agent/[id]/chat.tsx`
- Test: `mobile/src/__tests__/useWebSocket.test.ts`
- Test: `mobile/src/__tests__/chatDetailRoute.test.tsx`
- Test: `mobile/src/__tests__/agentChatRoute.test.tsx`
- Test: `mobile/src/__tests__/inboxStore.test.ts`

---

## Task 1: Add Unit-Tested AskQuestion Mirroring Helper

**Files:**
- Create: `mobile/src/features/inbox/utils/mirrorAskQuestionsToInbox.ts`
- Create: `mobile/src/__tests__/mirrorAskQuestionsToInbox.test.ts`

- [ ] **Step 1: Write failing tests**

Create tests that assert:

```ts
import { mirrorAskQuestionsToInbox } from '@/features/inbox/utils/mirrorAskQuestionsToInbox';
import { type WsMessage } from '@/types';

const askMessage: WsMessage = {
  type: 'message',
  seq: 2,
  role: 'ask_question',
  payload: {
    ask_id: 'ask-1',
    allow_freeform: false,
    questions: [{ id: '0', text: 'Deploy now?', options: [{ id: 'yes', label: 'Yes' }] }],
  },
  created_at: 1000,
};

it('mirrors unanswered ask_question messages to inbox', async () => {
  const addItem = jest.fn().mockResolvedValue(undefined);

  await mirrorAskQuestionsToInbox({
    messages: [askMessage],
    endpoint_id: 'ep-1',
    agent_id: 'agent-1',
    agent_name: 'Deploy Bot',
    conversation_id: 'conv-1',
    addItem,
  });

  expect(addItem).toHaveBeenCalledWith(
    expect.objectContaining({
      id: 'ask-1',
      kind: 'pending_question',
      title: 'Deploy Bot',
      body: 'Deploy now?',
      received_at: 1000,
    }),
  );
});

it('does not mirror answered ask_question messages', async () => {
  const addItem = jest.fn().mockResolvedValue(undefined);

  await mirrorAskQuestionsToInbox({
    messages: [{ ...askMessage, answered: true }],
    endpoint_id: 'ep-1',
    agent_id: 'agent-1',
    conversation_id: 'conv-1',
    addItem,
  });

  expect(addItem).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Verify red**

Run:

```bash
cd mobile && pnpm test -- mirrorAskQuestionsToInbox.test.ts --watchAll=false
```

Expected: FAIL because `mirrorAskQuestionsToInbox` does not exist.

- [ ] **Step 3: Implement helper**

Implement a helper that accepts `messages`, endpoint/agent/conversation metadata, and `addItem`. It should:

- Ignore non-`ask_question` messages.
- Ignore messages with `answered === true`.
- Build items through `buildAskQuestionInboxItem`.
- Use `message.created_at` as `received_at`.
- Await all `addItem` calls.

- [ ] **Step 4: Verify green**

Run:

```bash
cd mobile && pnpm test -- mirrorAskQuestionsToInbox.test.ts --watchAll=false
```

Expected: PASS.

---

## Task 2: Make Inbox Storage Repair Existing Rows

**Files:**
- Modify: `mobile/src/features/inbox/services/inboxService.ts`
- Test: `mobile/src/__tests__/inboxStore.test.ts`

- [ ] **Step 1: Write failing store/storage test**

Add a focused test that uses `useInboxStore.getState().addItem()` to write a `pending_question` item with `payload: null`, then writes the same id again with a real payload, then calls `load()` and asserts the row is answerable:

```ts
const store = useInboxStore.getState();
await store.addItem({
  id: 'ask-1',
  endpoint_id: 'ep-1',
  agent_id: 'agent-1',
  conversation_id: 'conv-1',
  kind: 'pending_question',
  title: 'Deploy Bot',
  body: 'Needs input',
  payload: null,
  received_at: 1,
  read_at: null,
});
await store.addItem({
  id: 'ask-1',
  endpoint_id: 'ep-1',
  agent_id: 'agent-1',
  conversation_id: 'conv-1',
  kind: 'pending_question',
  title: 'Deploy Bot',
  body: 'Deploy now?',
  payload: {
    ask_id: 'ask-1',
    allow_freeform: false,
    questions: [{ id: '0', text: 'Deploy now?', options: [{ id: 'yes', label: 'Yes' }] }],
  },
  received_at: 2,
  read_at: null,
});

await store.load();
const items = useInboxStore.getState().items;

expect(items[0]).toMatchObject({
  id: 'ask-1',
  kind: 'pending_question',
  body: 'Deploy now?',
});
expect(items[0].payload).toMatchObject({ ask_id: 'ask-1' });
```

- [ ] **Step 2: Verify red**

Run:

```bash
cd mobile && pnpm test -- inboxStore.test.ts --watchAll=false
```

Expected: FAIL because `INSERT OR IGNORE` preserves the null payload.

- [ ] **Step 3: Replace `INSERT OR IGNORE`**

Change `writeInboxItem()` to upsert:

- Insert new rows normally.
- On `id` conflict, update `endpoint_id`, `agent_id`, `conversation_id`, `kind`, `title`, `body`, `payload`, and `received_at`.
- Preserve `read_at` unless the incoming item explicitly has a non-null `read_at`.

- [ ] **Step 4: Verify green**

Run:

```bash
cd mobile && pnpm test -- inboxStore.test.ts --watchAll=false
```

Expected: PASS.

---

## Task 3: Backfill Inbox From Chat History Loads

**Files:**
- Modify: `mobile/app/chat/[id].tsx`
- Modify: `mobile/app/agent/[id]/chat.tsx`
- Test: `mobile/src/__tests__/chatDetailRoute.test.tsx`
- Test: `mobile/src/__tests__/agentChatRoute.test.tsx`

- [ ] **Step 1: Write failing route tests**

In `chatDetailRoute.test.tsx`, mock `useInboxStore.addItem`. Mock `fetchMessages()` to return:

```ts
const askMessage: WsMessage = {
  type: 'message',
  seq: 3,
  role: 'ask_question',
  payload: {
    ask_id: 'ask-1',
    allow_freeform: false,
    questions: [{ id: '0', text: 'Deploy now?', options: [{ id: 'yes', label: 'Yes' }] }],
  },
  created_at: 3,
};
```

Render `ChatDetailScreen` and assert:

```ts
await waitFor(() =>
  expect(mockAddInboxItem).toHaveBeenCalledWith(expect.objectContaining({ id: 'ask-1' })),
);
```

Create `agentChatRoute.test.tsx` with `useLocalSearchParams()` returning `{ id: 'agent-1', endpoint_id: 'endpoint-1', agent_name: 'Agent', conv_id: 'conv-1' }`. Mock `fetchMessages()` with the same `askMessage`, render `AgentChatRoute`, and assert `mockAddInboxItem` receives `id: 'ask-1'`.

- [ ] **Step 2: Verify red**

Run:

```bash
cd mobile && pnpm test -- chatDetailRoute.test.tsx agentChatRoute.test.tsx --watchAll=false
```

Expected: FAIL because history load only calls `setMessages`.

- [ ] **Step 3: Call the helper after merging messages**

After `fetchMessages()` and answered-ask merge, call `mirrorAskQuestionsToInbox()` with the same message array that is passed to `setMessages()`.

For `agent/[id]/chat.tsx`, ensure the notification deep-link branch also calls the helper after `fetchMessages(initialConvId)`.

- [ ] **Step 4: Verify green**

Run:

```bash
cd mobile && pnpm test -- chatDetailRoute.test.tsx agentChatRoute.test.tsx --watchAll=false
```

Expected: PASS.

---

## Task 4: Backfill Inbox From WebSocket Reconnect Catch-Up

**Files:**
- Modify: `mobile/src/hooks/useWebSocket.ts`
- Test: `mobile/src/__tests__/useWebSocket.test.ts`

- [ ] **Step 1: Write failing hook test**

Mock `fetchMessages()` to resolve with an `ask_question` message during `onopen` catch-up. Assert `addItem` is called with `id: ask-1`.

- [ ] **Step 2: Verify red**

Run:

```bash
cd mobile && pnpm test -- useWebSocket.test.ts --watchAll=false
```

Expected: FAIL because catch-up appends messages but does not mirror to Inbox.

- [ ] **Step 3: Call helper in catch-up**

In the `fetchMessages(...).then((msgs) => ...)` branch inside `useWebSocket`, call `mirrorAskQuestionsToInbox()` after appending messages and updating `lastSeqRef`.

Keep the existing realtime `ask_question` path, or replace it with a one-message call to the same helper.

- [ ] **Step 4: Verify green**

Run the hook test again. Expected: PASS.

---

## Task 5: Full Verification

- [ ] **Step 1: Mobile typecheck**

```bash
cd mobile && pnpm typecheck
```

Expected: PASS.

- [ ] **Step 2: Focused regression tests**

```bash
cd mobile && pnpm test -- mirrorAskQuestionsToInbox.test.ts inboxStore.test.ts useWebSocket.test.ts chatDetailRoute.test.tsx agentChatRoute.test.tsx --watchAll=false
```

Expected: PASS.

- [ ] **Step 3: Full mobile tests**

```bash
cd mobile && pnpm test -- --watchAll=false
```

Expected: PASS.

- [ ] **Step 4: Manual smoke check**

Create or open a conversation with an unanswered `ask_question`; verify:

- Chat shows the question card.
- Inbox shows a pending question row.
- Tapping the Inbox row expands the answer card.
- Answering from Inbox removes the row and marks the Chat card answered.

---

## Regression Rule

This bug class must stay covered by tests. Future changes to Chat loading, notification handling, WebSocket reconnect, Inbox persistence, or AskQuestion card rendering must include regression tests proving unanswered `ask_question` messages still appear as answerable Inbox items.
