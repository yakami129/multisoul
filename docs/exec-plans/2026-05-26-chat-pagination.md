# Chat Pagination Loading Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Before writing code for any task, add or update the failing tests first.

**Spec:** [`docs/product-specs/SPEC-chat-pagination.md`](../product-specs/SPEC-chat-pagination.md)

**Goal:** Make Chat Detail load a larger initial message window, request older history earlier, and show a visible top loading indicator while older history is being loaded.

**Architecture:** Keep the existing REST contract (`before_seq`, `limit`, `around_ask_id`) and current `FlatList` transcript architecture. Change only pagination constants, expose a reactive `isLoadingOlder` state from `useChatDetailHistory`, and render a transparent 40px `ListHeaderComponent` in `ChatTranscriptList`. No server changes, background prefetch, focus jump redesign, or downward pagination are included.

**Tech Stack:** Expo Router, React Native `FlatList`, Zustand chat store, Jest + React Native Testing Library, TypeScript

---

## File Map

| File | Responsibility |
|------|----------------|
| `mobile/app/chat/chatDetailLimits.ts` | Chat Detail paging constants and visible-window helper |
| `mobile/app/chat/useChatDetailTranscriptScroll.ts` | Already consumes `TOP_LOAD_THRESHOLD`; behavior changes through constants |
| `mobile/app/chat/useChatDetailHistory.ts` | Initial fetch, cached older expansion, network older fetch, duplicate guards, and new `isLoadingOlder` state |
| `mobile/app/chat/ChatTranscriptList.tsx` | Transcript `FlatList`; add older-loading header UI |
| `mobile/app/chat/styles.ts` | Chat Detail styles; add loading header container style |
| `mobile/app/chat/[id].tsx` | Wire `isLoadingOlder` into the transcript list |
| `mobile/src/__tests__/chatDetailRoute.test.tsx` | Route-level regression coverage for limits, threshold, loading lifecycle, stale/failure behavior |
| `mobile/src/__tests__/ChatTranscriptList.loading.test.tsx` | Direct component coverage for the top loading header contract |
| `docs/exec-plans/index.json` | Canonical execution-plan manifest |

## Task 0: Baseline And Plan Registration

**Files:**
- Reference: `docs/product-specs/SPEC-chat-pagination.md`
- Modify: `docs/exec-plans/index.json`

- [x] **Step 1: Register this plan in the exec-plan index**

Add:

```json
{
  "file": "2026-05-26-chat-pagination.md",
  "title": "Chat Pagination Loading Feedback Implementation Plan"
}
```

- [ ] **Step 2: Run baseline route tests**

Run:

```bash
cd mobile && pnpm test -- chatDetailRoute.test.tsx --watchAll=false
```

Expected: PASS before feature edits.

- [ ] **Step 3: Run baseline typecheck**

Run:

```bash
cd mobile && pnpm typecheck
```

Expected: PASS before feature edits.

## Task 1: Pagination Constants And Early Top Threshold

**Files:**
- Modify: `mobile/app/chat/chatDetailLimits.ts`
- Modify: `mobile/src/__tests__/chatDetailRoute.test.tsx`

- [ ] **Step 1: Update existing route assertions for new limits**

Update the test named `loads the initial chat history with the latest 15 message limit` to assert `limit: 25` and rename it to `loads the initial chat history with the latest 25 message limit`.

Update the cached-window test comment and assertions:

```ts
/// Cached transcript windowing: reopening a conversation with a large store cache
/// must render only the newest visible window before the REST latest page returns.
///
/// Data construction:
///   cached store rows = seq 1..200, total 200 messages
///   initial window    = latest 25 rows = 200 - 25 + 1 = seq 176..200
///   REST request      = unresolved, so the assertion inspects the pre-REST first render
///
/// Execution process:
///   1. Seed chatStore with 200 cached rows for conv-1.
///   2. Render ChatDetailScreen while the initial latest-page request stays pending.
///   3. Inspect the FlatList data used for the first visible transcript render.
///
/// Expected result:
///   - Positive: FlatList data length is exactly 25.
///   - Positive: first visible seq is 176 and newest seq 200 is present.
///   - Negative: seq 1 is not present, so old cache is not rendered on open.
```

Required assertion values in that test:

```ts
expect({ actual: data.length, reason: 'cached long histories should expose only the latest 25 rows on initial open' }).toEqual({ actual: 25, reason: expect.any(String) });
expect({ actual: data[0]?.seq, reason: 'latest 25 from seq 1..200 should start at seq 176' }).toEqual({ actual: 176, reason: expect.any(String) });
expect({ actual: data.some((message) => message.seq === 200), reason: 'initial window must still include the newest cached message' }).toEqual({ actual: true, reason: expect.any(String) });
expect({ actual: data.some((message) => message.seq === 1), reason: 'initial window must not render the oldest cached message before user scrolls up' }).toEqual({ actual: false, reason: expect.any(String) });
```

Update older-fetch assertions from `limit: 50` to `limit: 30`:

```ts
expect(fetchMessages).toHaveBeenCalledWith('http://localhost:8080', 'token', 'conv-1', {
  before_seq: 11,
  limit: 30,
});
```

- [ ] **Step 2: Add the threshold regression test**

Add a route test with this shape:

```ts
/// Top-load threshold: user upward scroll should start older pagination before
/// reaching the absolute top of the transcript.
///
/// Data construction:
///   latest page first seq = 11
///   new threshold         = 300 px
///   y = 301 px            = just outside loading range
///   y = 299 px            = just inside loading range
///
/// Execution process:
///   1. Render ChatDetailScreen and wait for the latest prompt.
///   2. Mark the gesture as user-driven with onScrollBeginDrag.
///   3. Fire scroll at y=301 and verify no older request.
///   4. Fire scroll at y=299 and verify older request starts.
///
/// Expected result:
///   - Positive: before_seq 11 is requested once at y=299 with limit 30.
///   - Negative: y=301 does not request older history.
test('starts older pagination when user scrolls within the 300px top threshold', async () => {
  (fetchMessages as jest.Mock).mockImplementation(
    (_baseUrl: string, _token: string, _convId: string, options?: { before_seq?: number }) => {
      if (options?.before_seq === 11) {
        return Promise.resolve([
          {
            type: 'message',
            seq: 10,
            role: 'agent_text',
            payload: { text: 'older threshold response' },
            created_at: 10,
          },
        ]);
      }
      return Promise.resolve([
        {
          type: 'message',
          seq: 11,
          role: 'user_text',
          payload: { text: 'latest threshold prompt' },
          created_at: 11,
        },
      ]);
    },
  );
  const { UNSAFE_getByType, getByText } = render(<ChatDetailScreen />);

  await waitFor(() => expect(getByText('latest threshold prompt')).toBeTruthy());
  await act(async () => {
    UNSAFE_getByType(FlatList).props.onScrollBeginDrag?.({ nativeEvent: {} });
    UNSAFE_getByType(FlatList).props.onScroll({
      nativeEvent: {
        contentOffset: { y: 301 },
        layoutMeasurement: { height: 400 },
        contentSize: { height: 900 },
      },
    });
  });
  expect({
    actual: (fetchMessages as jest.Mock).mock.calls.some(
      ([, , , options]) => options?.before_seq === 11,
    ),
    reason: 'scroll y=301 is outside the 300px threshold and must not request older messages',
  }).toEqual({ actual: false, reason: expect.any(String) });

  await act(async () => {
    UNSAFE_getByType(FlatList).props.onScroll({
      nativeEvent: {
        contentOffset: { y: 299 },
        layoutMeasurement: { height: 400 },
        contentSize: { height: 900 },
      },
    });
  });

  await waitFor(() => expect(getByText('older threshold response')).toBeTruthy());
  const beforeSeqCalls = (fetchMessages as jest.Mock).mock.calls.filter(
    ([, , , options]) => options?.before_seq === 11,
  );
  expect({
    actual: beforeSeqCalls.length,
    reason: 'scroll y=299 should start exactly one older-page request',
  }).toEqual({ actual: 1, reason: expect.any(String) });
  expect({
    actual: beforeSeqCalls[0]?.[3],
    reason: 'older-page request should use before_seq 11 and the new 30-row limit',
  }).toEqual({ actual: { before_seq: 11, limit: 30 }, reason: expect.any(String) });
});
```

- [ ] **Step 3: Verify RED**

Run:

```bash
cd mobile && pnpm test -- chatDetailRoute.test.tsx --watchAll=false
```

Expected: FAIL because production constants still use `15`, `50`, and `80`.

- [ ] **Step 4: Update constants**

Change `mobile/app/chat/chatDetailLimits.ts` to:

```ts
export const INITIAL_MESSAGE_LIMIT = 25;
export const OLDER_MESSAGE_LIMIT = 30;
export const FOCUS_MESSAGE_LIMIT = 100;
export const TOP_LOAD_THRESHOLD = 300;
export const BOTTOM_STICKY_THRESHOLD = 120;
```

Do not change `FOCUS_MESSAGE_LIMIT`, `BOTTOM_STICKY_THRESHOLD`, or `getLatestWindowMinSeq`.

- [ ] **Step 5: Verify GREEN**

Run:

```bash
cd mobile && pnpm test -- chatDetailRoute.test.tsx --watchAll=false
```

Expected: PASS.

## Task 2: Transcript Top Loading Header

**Files:**
- Create: `mobile/src/__tests__/ChatTranscriptList.loading.test.tsx`
- Modify: `mobile/app/chat/ChatTranscriptList.tsx`
- Modify: `mobile/app/chat/styles.ts`

- [ ] **Step 1: Write the component RED tests**

Create `mobile/src/__tests__/ChatTranscriptList.loading.test.tsx`. Import `ChatTranscriptList` from `../../app/chat/ChatTranscriptList`, mock `MessageBubble`, and render one `WsMessage`.

Use this complete file:

```tsx
import { render } from '@testing-library/react-native';
import React from 'react';
import { ActivityIndicator, FlatList, StyleSheet } from 'react-native';
import type { WsMessage } from '@/types';
import ChatTranscriptList from '../../app/chat/ChatTranscriptList';

jest.mock('@/features/chat/components/MessageBubble', () => ({
  MessageBubble: ({ msg, waiting }: any) => {
    const { Text } = require('react-native');
    return <Text>{waiting ? 'waiting' : msg.payload.text}</Text>;
  },
}));

const message: WsMessage = {
  type: 'message',
  seq: 1,
  role: 'agent_text',
  payload: { text: 'hello' },
  created_at: 1,
};

function renderList(isLoadingOlder: boolean) {
  return render(
    <ChatTranscriptList
      listRef={{ current: null }}
      messages={[message]}
      isLoadingOlder={isLoadingOlder}
      isAgentRunning={false}
      incomingAgentActivitySeq={null}
      activeTypewriterSeq={null}
      shouldForceComplete={false}
      serverUrl="http://localhost:8080"
      token="token"
      onAnswer={jest.fn()}
      onAnswerMulti={jest.fn()}
      imageUriForMessage={() => undefined}
      onScroll={jest.fn()}
      onScrollBeginDrag={jest.fn()}
      onContentSizeChange={jest.fn()}
      onScrollToIndexFailed={jest.fn()}
    />,
  );
}

/// Older loading header: ChatTranscriptList should expose a transparent top
/// spinner while older messages are being fetched.
///
/// Data construction:
///   messages length = 1, so the FlatList has normal transcript content
///   isLoadingOlder = true, so the header should render
///   required header height = 40 px, with 8 px vertical padding
///
/// Execution process:
///   1. Render ChatTranscriptList with isLoadingOlder=true.
///   2. Inspect the header wrapper and ActivityIndicator props.
///   3. Inspect the FlatList maintainVisibleContentPosition prop.
///
/// Expected result:
///   - Positive: older loading wrapper exists and is 40 px tall.
///   - Positive: ActivityIndicator uses #FF6B35.
///   - Negative: the list position lock is not removed.
test('renders the top older-loading header while loading older messages', () => {
  const { getByTestId, UNSAFE_getByType } = renderList(true);
  const headerStyle = StyleSheet.flatten(getByTestId('older-messages-loading').props.style);
  const indicator = UNSAFE_getByType(ActivityIndicator);
  const list = UNSAFE_getByType(FlatList);

  expect({
    actual: headerStyle.height,
    reason: 'older loading header must reserve the specified 40px top area',
  }).toEqual({ actual: 40, reason: expect.any(String) });
  expect({
    actual: headerStyle.backgroundColor,
    reason: 'older loading header must stay transparent and not cover transcript content',
  }).toEqual({ actual: 'transparent', reason: expect.any(String) });
  expect({
    actual: indicator.props.color,
    reason: 'older loading spinner must use the chat accent color',
  }).toEqual({ actual: '#FF6B35', reason: expect.any(String) });
  expect({
    actual: list.props.maintainVisibleContentPosition,
    reason: 'top loading header must keep FlatList visible-position locking enabled',
  }).toEqual({ actual: { minIndexForVisible: 0 }, reason: expect.any(String) });
});

/// Older loading idle state: no header should render when older pagination is
/// idle, including when transcript content itself is present.
///
/// Data construction:
///   messages length = 1
///   isLoadingOlder = false
///
/// Execution process:
///   1. Render ChatTranscriptList with isLoadingOlder=false.
///   2. Query the older loading test id.
///
/// Expected result:
///   - Positive: normal message content still renders.
///   - Negative: older loading wrapper is absent.
test('does not render the older-loading header while idle', () => {
  const { getByText, queryByTestId } = renderList(false);

  expect({
    actual: getByText('hello') != null,
    reason: 'idle transcript should still render regular messages',
  }).toEqual({ actual: true, reason: expect.any(String) });
  expect({
    actual: queryByTestId('older-messages-loading'),
    reason: 'idle transcript must not reserve top loading space',
  }).toEqual({ actual: null, reason: expect.any(String) });
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
cd mobile && pnpm test -- ChatTranscriptList.loading.test.tsx --watchAll=false
```

Expected: FAIL because `ChatTranscriptList` has no `isLoadingOlder` prop or loading header.

- [ ] **Step 3: Add the loading style**

In `mobile/app/chat/styles.ts`, add:

```ts
olderMessagesLoading: {
  height: 40,
  paddingVertical: 8,
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: 'transparent',
},
```

- [ ] **Step 4: Add the prop and header UI**

In `mobile/app/chat/ChatTranscriptList.tsx`:

```tsx
import {
  ActivityIndicator,
  FlatList,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  View,
} from 'react-native';
```

Add `isLoadingOlder: boolean` to `Props`, destructure it, and add:

```tsx
const renderOlderLoading = () =>
  isLoadingOlder ? (
    <View testID="older-messages-loading" style={s.olderMessagesLoading}>
      <ActivityIndicator testID="older-messages-loading-indicator" color="#FF6B35" />
    </View>
  ) : null;
```

Pass it to `FlatList`:

```tsx
ListHeaderComponent={renderOlderLoading}
```

Keep `maintainVisibleContentPosition={{ minIndexForVisible: 0 }}` unchanged.

- [ ] **Step 5: Verify GREEN**

Run:

```bash
cd mobile && pnpm test -- ChatTranscriptList.loading.test.tsx --watchAll=false
```

Expected: PASS.

## Task 3: Older Loading State Lifecycle

**Files:**
- Modify: `mobile/app/chat/useChatDetailHistory.ts`
- Modify: `mobile/app/chat/[id].tsx`
- Modify: `mobile/src/__tests__/chatDetailRoute.test.tsx`

- [ ] **Step 1: Add route-level RED tests for loading lifecycle**

Add three route tests near the existing older-pagination tests.

Network success test:

```ts
/// Older loading UI: a network older-page request should show the top loading
/// indicator while pending and hide it after the messages are prepended.
///
/// Data construction:
///   latest page first seq = 11
///   older request before_seq = 11 remains pending until the test resolves it
///   loading UI test id = older-messages-loading
///
/// Execution process:
///   1. Render latest page.
///   2. Start a user top-scroll older request.
///   3. Assert loading indicator is visible before resolving the request.
///   4. Resolve with seq 10 and wait for prepend.
///
/// Expected result:
///   - Positive: loading indicator appears while request is pending.
///   - Positive: older response renders after resolve.
///   - Negative: loading indicator disappears after resolve.
test('shows and hides the older loading indicator around network pagination', async () => {
  let resolveOlder: ((messages: WsMessage[]) => void) | undefined;
  (fetchMessages as jest.Mock).mockImplementation(
    (_baseUrl: string, _token: string, _convId: string, options?: { before_seq?: number }) => {
      if (options?.before_seq === 11) {
        return new Promise((resolve) => {
          resolveOlder = resolve;
        });
      }
      return Promise.resolve([
        {
          type: 'message',
          seq: 11,
          role: 'user_text',
          payload: { text: 'latest loading prompt' },
          created_at: 11,
        },
      ]);
    },
  );
  const { UNSAFE_getByType, getByText, getByTestId, queryByTestId } = render(<ChatDetailScreen />);

  await waitFor(() => expect(getByText('latest loading prompt')).toBeTruthy());
  await act(async () => {
    UNSAFE_getByType(FlatList).props.onScrollBeginDrag?.({ nativeEvent: {} });
    UNSAFE_getByType(FlatList).props.onScroll({
      nativeEvent: {
        contentOffset: { y: 0 },
        layoutMeasurement: { height: 400 },
        contentSize: { height: 900 },
      },
    });
  });

  await waitFor(() =>
    expect({
      actual: getByTestId('older-messages-loading') != null,
      reason: 'pending older network request should render the top loading indicator',
    }).toEqual({ actual: true, reason: expect.any(String) }),
  );
  await act(async () => {
    resolveOlder?.([
      {
        type: 'message',
        seq: 10,
        role: 'agent_text',
        payload: { text: 'older loaded after spinner' },
        created_at: 10,
      },
    ]);
  });

  await waitFor(() => expect(getByText('older loaded after spinner')).toBeTruthy());
  await waitFor(() =>
    expect({
      actual: queryByTestId('older-messages-loading'),
      reason: 'older loading indicator must disappear after a successful prepend',
    }).toEqual({ actual: null, reason: expect.any(String) }),
  );
});
```

Network failure test:

```ts
/// Older loading failure: failed older-page requests should clear the loading
/// indicator and keep the existing retry behavior.
///
/// Data construction:
///   latest page first seq = 11
///   first older request rejects
///   second older request resolves with seq 10
///
/// Execution process:
///   1. Render latest page.
///   2. Trigger top-scroll request and let it reject.
///   3. Verify loading disappears.
///   4. Trigger top-scroll again and verify retry can load seq 10.
///
/// Expected result:
///   - Positive: loading indicator appears during the failed request.
///   - Positive: retry renders the older message.
///   - Negative: failed request does not leave loading stuck on screen.
test('clears the older loading indicator after pagination failure and still retries', async () => {
  let olderAttempts = 0;
  let rejectFirstOlder: ((error: Error) => void) | undefined;
  (fetchMessages as jest.Mock).mockImplementation(
    (_baseUrl: string, _token: string, _convId: string, options?: { before_seq?: number }) => {
      if (options?.before_seq === 11) {
        olderAttempts += 1;
        if (olderAttempts === 1) {
          return new Promise((_resolve, reject) => {
            rejectFirstOlder = reject;
          });
        }
        return Promise.resolve([
          {
            type: 'message',
            seq: 10,
            role: 'agent_text',
            payload: { text: 'older retry after loading failure' },
            created_at: 10,
          },
        ]);
      }
      return Promise.resolve([
        {
          type: 'message',
          seq: 11,
          role: 'user_text',
          payload: { text: 'latest failure prompt' },
          created_at: 11,
        },
      ]);
    },
  );
  const { UNSAFE_getByType, getByText, getByTestId, queryByTestId } = render(<ChatDetailScreen />);

  await waitFor(() => expect(getByText('latest failure prompt')).toBeTruthy());
  await act(async () => {
    UNSAFE_getByType(FlatList).props.onScrollBeginDrag?.({ nativeEvent: {} });
    UNSAFE_getByType(FlatList).props.onScroll({
      nativeEvent: {
        contentOffset: { y: 0 },
        layoutMeasurement: { height: 400 },
        contentSize: { height: 900 },
      },
    });
  });
  await waitFor(() => expect(getByTestId('older-messages-loading')).toBeTruthy());
  await act(async () => {
    rejectFirstOlder?.(new Error('temporary older failure'));
  });
  await waitFor(() =>
    expect({
      actual: queryByTestId('older-messages-loading'),
      reason: 'failed older request must clear loading before retry',
    }).toEqual({ actual: null, reason: expect.any(String) }),
  );

  await act(async () => {
    UNSAFE_getByType(FlatList).props.onScroll({
      nativeEvent: {
        contentOffset: { y: 0 },
        layoutMeasurement: { height: 400 },
        contentSize: { height: 900 },
      },
    });
  });

  await waitFor(() => expect(getByText('older retry after loading failure')).toBeTruthy());
  expect({
    actual: olderAttempts,
    reason: 'same before_seq must remain retryable after a transient failure',
  }).toEqual({ actual: 2, reason: expect.any(String) });
});
```

Cached store test:

```ts
/// Cached older loading: expanding a cached older window should still expose a
/// short loading indicator for consistent user feedback.
///
/// Data construction:
///   cached store rows = seq 1..60
///   visible initial window after constants = seq 36..60
///   cached older window with limit 30 expands visibleMinSeq to seq 6
///
/// Execution process:
///   1. Seed chatStore with 60 cached rows and keep REST latest-page pending.
///   2. Trigger user top-scroll.
///   3. Verify loading indicator appears, then cached seq 6 becomes visible.
///
/// Expected result:
///   - Positive: cached path renders the loading indicator at least once.
///   - Positive: cached older seq 6 becomes visible without a network before_seq call.
///   - Negative: cached path does not call fetchMessages with before_seq.
test('shows older loading feedback while expanding a cached older window', async () => {
  useChatStore.setState((state) => ({
    ...state,
    messages: { 'conv-1': makeNumberedMessages(1, 60) },
  }));
  (fetchMessages as jest.Mock).mockImplementation(() => new Promise(() => {}));
  const { UNSAFE_getByType, getByTestId, getByText } = render(<ChatDetailScreen />);

  await act(async () => {
    UNSAFE_getByType(FlatList).props.onScrollBeginDrag?.({ nativeEvent: {} });
    UNSAFE_getByType(FlatList).props.onScroll({
      nativeEvent: {
        contentOffset: { y: 0 },
        layoutMeasurement: { height: 400 },
        contentSize: { height: 1400 },
      },
    });
  });

  await waitFor(() =>
    expect({
      actual: getByTestId('older-messages-loading') != null,
      reason: 'cached older expansion should briefly show the same loading feedback',
    }).toEqual({ actual: true, reason: expect.any(String) }),
  );
  await waitFor(() => expect(getByText('cached message 6')).toBeTruthy());
  expect({
    actual: (fetchMessages as jest.Mock).mock.calls.some(
      ([, , , options]) => options?.before_seq != null,
    ),
    reason: 'cached older expansion should not add a network request',
  }).toEqual({ actual: false, reason: expect.any(String) });
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
cd mobile && pnpm test -- chatDetailRoute.test.tsx --watchAll=false
```

Expected: FAIL because `useChatDetailHistory` does not expose reactive loading state and `ChatDetailScreen` is not passing it into `ChatTranscriptList`.

- [ ] **Step 3: Add reactive loading state**

In `mobile/app/chat/useChatDetailHistory.ts`, keep the ref and add state:

```ts
const [isLoadingOlder, setIsLoadingOlder] = useState(false);
const isLoadingOlderRef = useRef(false);
```

Add helpers inside the hook:

```ts
function startOlderLoading() {
  isLoadingOlderRef.current = true;
  setIsLoadingOlder(true);
}

function finishOlderLoading() {
  isLoadingOlderRef.current = false;
  setIsLoadingOlder(false);
}

function finishCachedOlderLoading() {
  requestAnimationFrame(finishOlderLoading);
}
```

Update the reset effect to call both:

```ts
isLoadingOlderRef.current = false;
setIsLoadingOlder(false);
```

In `loadOlderMessages()`:
- Keep the existing early returns for missing endpoint, duplicate load, no older messages, and no user scroll.
- Keep `lastOlderRequestBeforeSeqRef.current === firstLoadedSeq` before `startOlderLoading()`.
- Call `startOlderLoading()` before checking the cached older slice.
- For cached older messages, update `visibleMinSeq` exactly as today, do not set `lastOlderRequestBeforeSeqRef`, then call `finishCachedOlderLoading()` and return.
- For network older messages, keep current stale-generation, retry, `prependMessages`, and `lastSeenAgentActivitySeqRef` logic. Replace direct ref writes with `startOlderLoading()` and `finishOlderLoading()`.

Return the new state:

```ts
return {
  catchUpAfterSeq,
  transcriptMessages,
  isLoadingOlder,
  hasUserScrolledHistoryRef,
  hasLoadedInitialMessagesRef,
  loadOlderMessages,
};
```

- [ ] **Step 4: Wire the prop through Chat Detail**

In `mobile/app/chat/[id].tsx`, destructure `isLoadingOlder` from `useChatDetailHistory()` and pass it to `ChatTranscriptList`:

```tsx
<ChatTranscriptList
  listRef={listRef}
  messages={transcriptMessages}
  isLoadingOlder={isLoadingOlder}
  isAgentRunning={isAgentRunning}
  incomingAgentActivitySeq={incomingAgentActivitySeq}
  activeTypewriterSeq={activeTypewriterSeq}
  shouldForceComplete={shouldForceComplete}
  serverUrl={endpoint?.base_url ?? ''}
  token={endpoint?.token ?? ''}
  onAnswer={sendAnswer}
  onAnswerMulti={sendAnswerMulti}
  imageUriForMessage={imageUriForMessage}
  onScroll={handleTranscriptScroll}
  onScrollBeginDrag={handleTranscriptScrollBeginDrag}
  onContentSizeChange={handleContentSizeChange}
  onScrollToIndexFailed={handleScrollToIndexFailed}
/>
```

- [ ] **Step 5: Verify route GREEN**

Run:

```bash
cd mobile && pnpm test -- chatDetailRoute.test.tsx --watchAll=false
```

Expected: PASS.

## Task 4: Full Verification, Review, And Single Commit

**Files:**
- Review: all modified files from Tasks 1-3
- Modify after final commit: `docs/exec-plans/index.json`

- [ ] **Step 1: Run focused component and route tests**

Run:

```bash
cd mobile && pnpm test -- ChatTranscriptList.loading.test.tsx chatDetailRoute.test.tsx --watchAll=false
```

Expected: PASS.

- [ ] **Step 2: Run full mobile test suite**

Run:

```bash
cd mobile && pnpm test -- --watchAll=false
```

Expected: PASS.

- [ ] **Step 3: Run mobile typecheck**

Run:

```bash
cd mobile && pnpm typecheck
```

Expected: PASS.

- [ ] **Step 4: Run docs index verification**

Run:

```bash
python3 scripts/check-docs-indices.py
```

Expected: PASS.

- [ ] **Step 5: Inspect final diff**

Run:

```bash
git diff -- mobile/app/chat/chatDetailLimits.ts \
  mobile/app/chat/useChatDetailHistory.ts \
  mobile/app/chat/ChatTranscriptList.tsx \
  mobile/app/chat/styles.ts \
  'mobile/app/chat/[id].tsx' \
  mobile/src/__tests__/chatDetailRoute.test.tsx \
  mobile/src/__tests__/ChatTranscriptList.loading.test.tsx \
  docs/exec-plans/2026-05-26-chat-pagination.md \
  docs/exec-plans/index.json
```

Expected:
- No unrelated files.
- No `console.log`, `@ts-ignore`, `eslint-disable`, or `#[allow(...)]`.
- `FOCUS_MESSAGE_LIMIT` remains `100`.
- `BOTTOM_STICKY_THRESHOLD` remains `120`.
- No new API route or CLI code.

- [ ] **Step 6: Request code review before commit**

Use `superpowers:requesting-code-review` before committing. Fix all Critical and Important feedback, then rerun Steps 1-4.

- [ ] **Step 7: Create one final commit**

The repository rule overrides per-task commits. Commit once after all tasks pass and review is complete:

```bash
git add mobile/app/chat/chatDetailLimits.ts \
  mobile/app/chat/useChatDetailHistory.ts \
  mobile/app/chat/ChatTranscriptList.tsx \
  mobile/app/chat/styles.ts \
  'mobile/app/chat/[id].tsx' \
  mobile/src/__tests__/chatDetailRoute.test.tsx \
  mobile/src/__tests__/ChatTranscriptList.loading.test.tsx \
  docs/exec-plans/2026-05-26-chat-pagination.md \
  docs/exec-plans/index.json
git commit -m "feat(mobile): improve chat history pagination feedback"
```

- [ ] **Step 8: Record completion commit**

After the commit succeeds, get the 40-character SHA:

```bash
git rev-parse HEAD
```

Update this plan entry in `docs/exec-plans/index.json`:

```json
{
  "file": "2026-05-26-chat-pagination.md",
  "title": "Chat Pagination Loading Feedback Implementation Plan",
  "lastCompletedCommit": "<40-char-sha>"
}
```

Amend the final commit if the workflow requires the plan completion marker to live in the same commit; otherwise commit the manifest marker as a tiny follow-up.

## Self-Review

**Spec coverage:**
- Initial latest page limit `25`: Task 1.
- Older page limit `30`: Task 1.
- Top load threshold `300`: Task 1.
- Loading indicator at list top: Task 2.
- Loading state true/false for network, failure, and cached paths: Task 3.
- No background prefetch, no server/API change, no focus jump redesign, no downward pagination: File Map and Task 4 diff inspection.
- Validation commands `pnpm typecheck` and `pnpm test -- --watchAll=false`: Task 4.

**Placeholder scan:** This plan contains no `TBD`, no unbounded "add tests" step, and no open-ended "handle edge cases" instruction.

**Type consistency:** `isLoadingOlder` is consistently named in hook return value, `ChatDetailScreen`, `ChatTranscriptList` props, and tests. The loading test ids are consistently `older-messages-loading` and `older-messages-loading-indicator`.
