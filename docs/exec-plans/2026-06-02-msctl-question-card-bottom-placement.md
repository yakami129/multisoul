# msctl Question Card Bottom Placement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render `msctl ask-question` cards at the bottom of the loaded Chat transcript without changing server message order.

**Architecture:** Keep SQLite/API/WebSocket `seq` ordering unchanged. Add a small mobile-only transcript placement utility that detects `ask_question` payloads with `response_mode="user_message"`, removes them from their original visual position, and appends them to the loaded transcript window in original `seq` order. Reuse existing focus scrolling after the displayed list has been reordered.

**Tech Stack:** React Native, Expo SDK 55, TypeScript, Zustand, Jest, `@testing-library/react-native`.

---

## Interview Decisions

- Only `msctl ask-question` cards move: `ask_question.payload.response_mode === "user_message"`.
- Claude-native `AskUserQuestion` cards stay in their original timeline position.
- Cards are rendered as normal FlatList rows at the end of the transcript, not as a sticky overlay.
- Multiple msctl cards all appear at the bottom, sorted by their original `seq` from old to new.
- Answered msctl cards remain at the bottom.
- The original position leaves no placeholder, disabled duplicate, or marker.
- Only the currently loaded message window participates. Old cards outside the loaded page are not fetched just for bottom placement.
- `focus_ask_id` from Inbox/notifications should scroll to the card's displayed bottom position.

## Source Inputs

- Interview transcript in conversation `0b30a731-a80b-4518-bd8c-83bd8e94103f`.
- Existing HTTP ask payload: `cli/src/serve/routes/ask_question.rs` writes `response_mode: "user_message"`.
- Existing mobile type gap: `mobile/src/types.ts` has `AskQuestionPayload` without `response_mode`.
- Existing transcript derivation: `mobile/app/chat/useChatDetailHistory.ts`.
- Existing focus scroll logic: `mobile/app/chat/useChatDetailTranscriptScroll.ts`.

## File Structure

- Create `mobile/src/features/chat/utils/msctlQuestionPlacement.ts`
  - Owns the predicate and reorder function.
  - Keeps display-order logic out of Zustand and API services.
- Create `mobile/src/features/chat/utils/msctlQuestionPlacement.test.ts`
  - Covers pure ordering rules, no React dependency.
- Modify `mobile/src/types.ts`
  - Adds optional `response_mode?: 'user_message'` to `AskQuestionPayload`.
- Modify `mobile/app/chat/useChatDetailHistory.ts`
  - Applies placement after transcript renderability filtering.
- Create `mobile/src/__tests__/chatDetailMsctlQuestionPlacement.test.tsx`
  - Covers Chat Detail integration and `focus_ask_id` index using a new focused test file instead of growing `chatDetailRoute.test.tsx`.

## Task 1: Add msctl Question Placement Utility

**Files:**
- Create: `mobile/src/features/chat/utils/msctlQuestionPlacement.test.ts`
- Create: `mobile/src/features/chat/utils/msctlQuestionPlacement.ts`
- Modify: `mobile/src/types.ts`

- [ ] **Step 1: Write the failing utility tests**

Create `mobile/src/features/chat/utils/msctlQuestionPlacement.test.ts`:

```ts
import type { WsMessage } from '@/types';
import {
  isUserMessageModeAskQuestion,
  placeMsctlQuestionCardsAtBottom,
} from './msctlQuestionPlacement';

function msg(seq: number, role: WsMessage['role'], payload: WsMessage['payload']): WsMessage {
  return { type: 'message', seq, role, payload, created_at: seq };
}

function expectEqualWithReason<T>(actual: T, expected: T, reason: string) {
  expect({ actual, reason }).toEqual({ actual: expected, reason });
}

/// msctl ask placement: user-message-mode ask cards are moved to the loaded
/// transcript tail without changing their underlying seq values.
///
/// Data construction:
///   seq 1 = agent_text "before"
///   seq 2 = msctl ask_question with response_mode=user_message
///   seq 3 = agent_text "after"
///   loaded window size = 3 messages, so no pagination fetch is involved
///
/// Execution process:
///   1. Build the three loaded transcript messages in server seq order.
///   2. Call placeMsctlQuestionCardsAtBottom(messages).
///   3. Read the returned seq order and object identities.
///
/// Expected result:
///   - Positive: visual order is 1, 3, 2, so the msctl ask is last.
///   - Positive: the moved ask keeps seq=2, proving server order is untouched.
///   - Negative: the moved ask does not remain in its original middle position.
test('moves loaded msctl user-message question cards to the transcript tail', () => {
  const ask = msg(2, 'ask_question', {
    ask_id: 'ask-msctl',
    allow_freeform: false,
    response_mode: 'user_message',
    questions: [{ id: '0', text: 'Pick?', options: [{ id: 'yes', label: 'Yes' }] }],
  });
  const messages = [
    msg(1, 'agent_text', { text: 'before' }),
    ask,
    msg(3, 'agent_text', { text: 'after' }),
  ];

  const placed = placeMsctlQuestionCardsAtBottom(messages);

  expectEqualWithReason(
    placed.map((m) => m.seq),
    [1, 3, 2],
    'msctl ask should be displayed after later regular transcript messages',
  );
  expectEqualWithReason(
    placed[2],
    ask,
    'placement must preserve the original ask object with seq=2',
  );
  expectEqualWithReason(
    placed[1].seq === 2,
    false,
    'msctl ask must not remain in its original middle display position',
  );
});

/// msctl ask placement: multiple moved cards keep their own chronological
/// ordering at the bottom.
///
/// Data construction:
///   seq 1 = msctl ask A
///   seq 2 = agent_text regular message
///   seq 3 = msctl ask B
///   seq 4 = user_text regular message
///
/// Execution process:
///   1. Build an interleaved loaded transcript window.
///   2. Call placeMsctlQuestionCardsAtBottom(messages).
///   3. Inspect the final display seq order.
///
/// Expected result:
///   - Positive: regular messages stay in relative order 2, 4.
///   - Positive: msctl asks appear at the tail in original order 1, 3.
///   - Negative: ask B must not jump ahead of ask A.
test('keeps multiple moved msctl cards sorted by original seq at the bottom', () => {
  const messages = [
    msg(1, 'ask_question', {
      ask_id: 'ask-a',
      allow_freeform: false,
      response_mode: 'user_message',
      questions: [{ id: '0', text: 'A?', options: [] }],
    }),
    msg(2, 'agent_text', { text: 'middle' }),
    msg(3, 'ask_question', {
      ask_id: 'ask-b',
      allow_freeform: false,
      response_mode: 'user_message',
      questions: [{ id: '0', text: 'B?', options: [] }],
    }),
    msg(4, 'user_text', { text: 'done' }),
  ];

  const placed = placeMsctlQuestionCardsAtBottom(messages);

  expectEqualWithReason(
    placed.map((m) => m.seq),
    [2, 4, 1, 3],
    'regular messages should stay first, followed by msctl asks in original seq order',
  );
  expectEqualWithReason(
    placed[2].seq < placed[3].seq,
    true,
    'older msctl ask should stay before newer msctl ask in the bottom group',
  );
  expectEqualWithReason(
    placed[2].seq === 3,
    false,
    'newer msctl ask must not jump ahead of the older ask',
  );
});

/// msctl ask placement: ordinary ask_question cards are not moved.
///
/// Data construction:
///   seq 1 = agent_text "before"
///   seq 2 = ordinary ask_question without response_mode=user_message
///   seq 3 = agent_text "after"
///
/// Execution process:
///   1. Build a loaded transcript containing a Claude-native ask card.
///   2. Verify isUserMessageModeAskQuestion returns false for the ordinary ask.
///   3. Call placeMsctlQuestionCardsAtBottom(messages).
///
/// Expected result:
///   - Positive: ordinary ask remains at seq order 1, 2, 3.
///   - Positive: predicate returns true for a user-message-mode ask.
///   - Negative: ordinary ask is not appended after seq 3.
test('does not move ordinary ask_question cards without user-message response mode', () => {
  const ordinaryAsk = msg(2, 'ask_question', {
    ask_id: 'ask-claude',
    allow_freeform: false,
    questions: [{ id: '0', text: 'Deploy?', options: [] }],
  });
  const msctlAsk = msg(4, 'ask_question', {
    ask_id: 'ask-msctl',
    allow_freeform: false,
    response_mode: 'user_message',
    questions: [{ id: '0', text: 'Pick?', options: [] }],
  });

  const placed = placeMsctlQuestionCardsAtBottom([
    msg(1, 'agent_text', { text: 'before' }),
    ordinaryAsk,
    msg(3, 'agent_text', { text: 'after' }),
  ]);

  expectEqualWithReason(
    placed.map((m) => m.seq),
    [1, 2, 3],
    'ordinary ask_question should keep its original visual position',
  );
  expectEqualWithReason(
    isUserMessageModeAskQuestion(msctlAsk),
    true,
    'predicate should identify msctl HTTP ask cards by response_mode=user_message',
  );
  expectEqualWithReason(
    placed[2].seq === 2,
    false,
    'ordinary ask must not be moved to the transcript tail',
  );
});
```

- [ ] **Step 2: Run the utility tests and verify they fail**

Run:

```bash
cd mobile && pnpm test -- msctlQuestionPlacement.test.ts --watchAll=false
```

Expected:

```text
Cannot find module './msctlQuestionPlacement'
```

- [ ] **Step 3: Add `response_mode` to the mobile payload type**

In `mobile/src/types.ts`, update `AskQuestionPayload`:

```ts
export interface AskQuestionPayload {
  ask_id: string;
  questions: Array<{
    id: string;
    text: string;
    options: { id: string; label: string }[];
    multi_select?: boolean;
  }>;
  allow_freeform: boolean;
  response_mode?: 'user_message';
}
```

- [ ] **Step 4: Implement the placement utility**

Create `mobile/src/features/chat/utils/msctlQuestionPlacement.ts`:

```ts
import type { AskQuestionPayload, WsMessage } from '@/types';

export function isUserMessageModeAskQuestion(msg: WsMessage): boolean {
  if (msg.role !== 'ask_question') return false;
  const payload = msg.payload as AskQuestionPayload;
  return payload.response_mode === 'user_message';
}

export function placeMsctlQuestionCardsAtBottom(messages: WsMessage[]): WsMessage[] {
  const regularMessages: WsMessage[] = [];
  const msctlQuestionCards: WsMessage[] = [];

  for (const message of messages) {
    if (isUserMessageModeAskQuestion(message)) {
      msctlQuestionCards.push(message);
    } else {
      regularMessages.push(message);
    }
  }

  return [...regularMessages, ...msctlQuestionCards];
}
```

- [ ] **Step 5: Run utility tests and verify they pass**

Run:

```bash
cd mobile && pnpm test -- msctlQuestionPlacement.test.ts --watchAll=false
```

Expected:

```text
PASS mobile/src/features/chat/utils/msctlQuestionPlacement.test.ts
```

## Task 2: Wire Placement Into Chat Detail Transcript

**Files:**
- Modify: `mobile/app/chat/useChatDetailHistory.ts`
- Create: `mobile/src/__tests__/chatDetailMsctlQuestionPlacement.test.tsx`

- [ ] **Step 1: Write the failing Chat Detail display-order test**

Create `mobile/src/__tests__/chatDetailMsctlQuestionPlacement.test.tsx`:

```tsx
import { render, waitFor } from '@testing-library/react-native';
import React from 'react';
import { FlatList } from 'react-native';
import { fetchMessages } from '@/features/chat/services/chatService';
import { useChatStore } from '@/store/chatStore';
import { useEndpointStore } from '@/store/endpointStore';
import type { WsMessage } from '@/types';
import ChatDetailScreen from '../../app/chat/[id]';

let mockSearchParams: Record<string, string | undefined> = {
  id: 'conv-1',
  endpoint_id: 'endpoint-1',
};

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockSearchParams,
  useRouter: () => ({ back: jest.fn() }),
}));

jest.mock('@/hooks/useWebSocket', () => ({
  useWebSocket: jest.fn(() => ({
    status: 'open',
    sendAnswer: jest.fn(),
    sendAnswerMulti: jest.fn(),
  })),
}));

jest.mock('@/features/chat/services/chatService', () => ({
  fetchMessages: jest.fn(),
  fetchRuntimeModels: jest.fn().mockResolvedValue([]),
  postMessage: jest.fn(),
  switchConversationModel: jest.fn(),
  uploadImage: jest.fn(),
  abortConversation: jest.fn().mockResolvedValue(undefined),
  resolveUserMessageImageUri: jest.fn(() => undefined),
}));

jest.mock('@/features/inbox/services/inboxService', () => ({
  loadAnsweredAsks: jest.fn().mockResolvedValue(new Map()),
  writeInboxItem: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/features/chat/components/MessageBubble', () => ({
  MessageBubble: ({ msg, waiting }: { msg: WsMessage; waiting?: boolean }) => {
    const { Text } = require('react-native');
    if (waiting) return <Text>waiting</Text>;
    if (msg.role === 'ask_question') {
      return <Text>{`ask:${(msg.payload as { ask_id: string }).ask_id}`}</Text>;
    }
    if ('text' in msg.payload) return <Text>{msg.payload.text}</Text>;
    return <Text>{msg.role}</Text>;
  },
}));

function message(seq: number, role: WsMessage['role'], payload: WsMessage['payload']): WsMessage {
  return { type: 'message', seq, role, payload, created_at: seq };
}

function setupStores() {
  useEndpointStore.setState({
    endpoints: [{ id: 'endpoint-1', label: 'Local', base_url: 'http://localhost:8080', token: 'token', last_seen_at: null }],
  });
  useChatStore.setState({
    conversations: [{
      id: 'conv-1',
      agent_id: 'agent-1',
      title: 'Chat',
      created_at: 1,
      last_message_at: 1,
      status: 'idle',
      model_id: null,
      endpoint_id: 'endpoint-1',
      agent_name: 'Agent',
    }],
    messages: {},
  });
}

beforeEach(() => {
  mockSearchParams = { id: 'conv-1', endpoint_id: 'endpoint-1' };
  setupStores();
  jest.clearAllMocks();
});

/// Chat Detail msctl placement: loaded user-message-mode ask cards render at
/// the visual transcript tail while ordinary ask cards stay in server order.
///
/// Data construction:
///   seq 1 = agent_text "first"
///   seq 2 = msctl ask_question response_mode=user_message
///   seq 3 = ordinary ask_question without response_mode
///   seq 4 = agent_text "last"
///   loaded window = all 4 messages from initial fetch
///
/// Execution process:
///   1. Mock fetchMessages() to return the four messages in seq order.
///   2. Render ChatDetailScreen.
///   3. Inspect FlatList data after initial history load.
///
/// Expected result:
///   - Positive: msctl ask moves to the final display index.
///   - Positive: ordinary ask remains before the later agent_text.
///   - Negative: msctl ask does not remain at its original index 1.
test('renders loaded msctl question cards at the bottom of Chat Detail', async () => {
  (fetchMessages as jest.Mock).mockResolvedValue([
    message(1, 'agent_text', { text: 'first' }),
    message(2, 'ask_question', {
      ask_id: 'ask-msctl',
      allow_freeform: false,
      response_mode: 'user_message',
      questions: [{ id: '0', text: 'Pick?', options: [] }],
    }),
    message(3, 'ask_question', {
      ask_id: 'ask-ordinary',
      allow_freeform: false,
      questions: [{ id: '0', text: 'Deploy?', options: [] }],
    }),
    message(4, 'agent_text', { text: 'last' }),
  ]);

  const { UNSAFE_getByType } = render(<ChatDetailScreen />);

  await waitFor(() => {
    const data = UNSAFE_getByType(FlatList).props.data as WsMessage[];
    expect({ actual: data.map((m) => m.seq), reason: 'msctl ask should be moved to visual tail' })
      .toEqual({ actual: [1, 3, 4, 2], reason: expect.any(String) });
  });

  const data = UNSAFE_getByType(FlatList).props.data as WsMessage[];
  expect({
    actual: (data[1].payload as { ask_id?: string }).ask_id,
    reason: 'ordinary ask should keep its original timeline position',
  }).toEqual({ actual: 'ask-ordinary', reason: expect.any(String) });
  expect({
    actual: data[1].seq === 2,
    reason: 'msctl ask must not remain in its original middle display index',
  }).toEqual({ actual: false, reason: expect.any(String) });
});
```

- [ ] **Step 2: Run the Chat Detail test and verify it fails**

Run:

```bash
cd mobile && pnpm test -- chatDetailMsctlQuestionPlacement.test.tsx --watchAll=false
```

Expected:

```text
Expected: [1, 3, 4, 2]
Received: [1, 2, 3, 4]
```

- [ ] **Step 3: Apply placement in `useChatDetailHistory`**

In `mobile/app/chat/useChatDetailHistory.ts`, add the import:

```ts
import { placeMsctlQuestionCardsAtBottom } from '@/features/chat/utils/msctlQuestionPlacement';
```

Replace the `transcriptMessages` memo with:

```ts
  const transcriptMessages = React.useMemo(
    () =>
      placeMsctlQuestionCardsAtBottom(
        visibleMessages.filter(isRenderableInChatTranscript),
      ),
    [visibleMessages],
  );
```

- [ ] **Step 4: Run placement and Chat Detail tests**

Run:

```bash
cd mobile && pnpm test -- msctlQuestionPlacement.test.ts chatDetailMsctlQuestionPlacement.test.tsx --watchAll=false
```

Expected:

```text
PASS mobile/src/features/chat/utils/msctlQuestionPlacement.test.ts
PASS mobile/src/__tests__/chatDetailMsctlQuestionPlacement.test.tsx
```

## Task 3: Preserve `focus_ask_id` Behavior Against Reordered Display Data

**Files:**
- Modify: `mobile/src/__tests__/chatDetailMsctlQuestionPlacement.test.tsx`
- Verify: `mobile/app/chat/useChatDetailTranscriptScroll.ts`

- [ ] **Step 1: Add a failing focus-index regression test**

Append to `mobile/src/__tests__/chatDetailMsctlQuestionPlacement.test.tsx`:

```tsx
/// Chat Detail focus routing: focus_ask_id should scroll to the reordered
/// bottom position for an msctl user-message-mode ask.
///
/// Data construction:
///   route focus_ask_id = ask-msctl
///   seq 1 = agent_text
///   seq 2 = msctl ask_question response_mode=user_message
///   seq 3 = agent_text
///   display order after placement should be seq 1, 3, 2
///
/// Execution process:
///   1. Mock route params with focus_ask_id=ask-msctl.
///   2. Mock history fetch with seq order 1, 2, 3.
///   3. Render ChatDetailScreen and wait for focus scrolling.
///
/// Expected result:
///   - Positive: FlatList.scrollToIndex is called with index=2.
///   - Positive: FlatList data order is 1, 3, 2.
///   - Negative: FlatList.scrollToIndex is not called with original index=1.
test('scrolls focus_ask_id to the bottom display index for msctl cards', async () => {
  mockSearchParams = { id: 'conv-1', endpoint_id: 'endpoint-1', focus_ask_id: 'ask-msctl' };
  const flatListPrototype = FlatList.prototype as unknown as {
    scrollToIndex: (params: { index: number; animated?: boolean; viewPosition?: number }) => void;
    scrollToEnd: (params?: { animated?: boolean }) => void;
  };
  const scrollToIndexSpy = jest.spyOn(flatListPrototype, 'scrollToIndex').mockImplementation();
  const scrollToEndSpy = jest.spyOn(flatListPrototype, 'scrollToEnd').mockImplementation();
  try {
    (fetchMessages as jest.Mock).mockResolvedValue([
      message(1, 'agent_text', { text: 'first' }),
      message(2, 'ask_question', {
        ask_id: 'ask-msctl',
        allow_freeform: false,
        response_mode: 'user_message',
        questions: [{ id: '0', text: 'Pick?', options: [] }],
      }),
      message(3, 'agent_text', { text: 'last' }),
    ]);

    const { UNSAFE_getByType } = render(<ChatDetailScreen />);

    await waitFor(() => {
      const data = UNSAFE_getByType(FlatList).props.data as WsMessage[];
      expect({ actual: data.map((m) => m.seq), reason: 'focused msctl ask should be at bottom' })
        .toEqual({ actual: [1, 3, 2], reason: expect.any(String) });
    });

    await waitFor(() => {
      expect({
        actual: scrollToIndexSpy.mock.calls.some(([args]) => args.index === 2),
        reason: 'focus_ask_id should scroll to the reordered bottom index',
      }).toEqual({ actual: true, reason: expect.any(String) });
    });
    expect({
      actual: scrollToIndexSpy.mock.calls.some(([args]) => args.index === 1),
      reason: 'focus_ask_id must not scroll to the original seq index after reorder',
    }).toEqual({ actual: false, reason: expect.any(String) });
    expect({
      actual: scrollToEndSpy.mock.calls.length,
      reason: 'focus_ask_id scroll should not be overwritten by automatic scrollToEnd',
    }).toEqual({ actual: 0, reason: expect.any(String) });
  } finally {
    scrollToIndexSpy.mockRestore();
    scrollToEndSpy.mockRestore();
  }
});
```

- [ ] **Step 2: Run the focus test**

Run:

```bash
cd mobile && pnpm test -- chatDetailMsctlQuestionPlacement.test.tsx --watchAll=false
```

Expected after Task 2 implementation:

```text
PASS mobile/src/__tests__/chatDetailMsctlQuestionPlacement.test.tsx
```

If it fails with `index=1`, inspect `mobile/app/chat/useChatDetailTranscriptScroll.ts`. The hook should receive the reordered `transcriptMessages` from `ChatDetailScreen`; do not add separate reorder logic in the scroll hook unless the prop is still the original list.

## Task 4: Verification

**Files:**
- Verify all files changed in Tasks 1-3.

- [ ] **Step 1: Run focused mobile tests**

Run:

```bash
cd mobile && pnpm test -- msctlQuestionPlacement.test.ts chatDetailMsctlQuestionPlacement.test.tsx --watchAll=false
```

Expected:

```text
PASS mobile/src/features/chat/utils/msctlQuestionPlacement.test.ts
PASS mobile/src/__tests__/chatDetailMsctlQuestionPlacement.test.tsx
```

- [ ] **Step 2: Run TypeScript typecheck**

Run:

```bash
cd mobile && pnpm typecheck
```

Expected:

```text
No TypeScript errors.
```

- [ ] **Step 3: Review final diff against constraints**

Run:

```bash
git diff -- mobile/src/types.ts \
  mobile/src/features/chat/utils/msctlQuestionPlacement.ts \
  mobile/src/features/chat/utils/msctlQuestionPlacement.test.ts \
  mobile/app/chat/useChatDetailHistory.ts \
  mobile/app/chat/useChatDetailTranscriptScroll.ts \
  mobile/src/__tests__/chatDetailMsctlQuestionPlacement.test.tsx \
  docs/design-docs/2026-05-03-new-cli-runtime-integration-guide.md \
  docs/design-docs/index.json \
  docs/exec-plans/2026-06-02-msctl-question-card-bottom-placement.md \
  docs/exec-plans/index.json
```

Expected:

```text
Diff only contains the placement utility, payload type, Chat transcript wiring,
focus-scroll handling, regression tests, and required doc/hash updates.
```

- [ ] **Step 4: Single commit after all tasks pass**

This repository overrides the generic Superpowers frequent-commit rule. After all tasks pass, run code review first, then create one commit for the whole plan.

Required pre-commit review:

```bash
# Use superpowers:requesting-code-review before committing.
```

Commit command:

```bash
git add mobile/src/types.ts \
  mobile/src/features/chat/utils/msctlQuestionPlacement.ts \
  mobile/src/features/chat/utils/msctlQuestionPlacement.test.ts \
  mobile/app/chat/useChatDetailHistory.ts \
  mobile/app/chat/useChatDetailTranscriptScroll.ts \
  mobile/src/__tests__/chatDetailMsctlQuestionPlacement.test.tsx \
  docs/design-docs/2026-05-03-new-cli-runtime-integration-guide.md \
  docs/design-docs/index.json \
  docs/exec-plans/2026-06-02-msctl-question-card-bottom-placement.md \
  docs/exec-plans/index.json
git commit -m "fix(chat): keep msctl question cards at transcript bottom"
```

After commit, update `docs/exec-plans/index.json` with `lastCompletedCommit` for this plan using the 40-character commit SHA.

## Self-Review

- Spec coverage: all interview decisions map to Task 1 utility tests, Task 2 Chat display wiring, or Task 3 focus routing.
- Placeholder scan: no placeholder markers remain.
- Type consistency: `response_mode?: 'user_message'`, `isUserMessageModeAskQuestion`, and `placeMsctlQuestionCardsAtBottom` are named consistently across tests, implementation, and integration wiring.
