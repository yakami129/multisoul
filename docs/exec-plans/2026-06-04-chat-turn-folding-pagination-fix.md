# Chat Turn Folding And Pagination Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Before writing code for any task, add or update the failing tests first.

**Spec:** [`docs/product-specs/2026-06-04-SPEC-chat-completed-transcript-folding.md`](../product-specs/2026-06-04-SPEC-chat-completed-transcript-folding.md)

**Goal:** Fix completed Chat Detail folding so each user turn has at most one `Worked for <duration>` row, question cards remain in the turn instead of being pushed to the bottom, and older-message pagination keeps the current view stable.

**Architecture:** Keep backend messages and Zustand storage unchanged. Rework the mobile render-state pure function to group completed transcripts by user turn, remove Chat Detail ask-card bottom placement, and make scroll/focus behavior operate on the final display-item order with stable keys. Verify with focused render-state tests, ChatTranscriptList tests, and Chat Detail route/placement regressions.

**Tech Stack:** React Native, Expo SDK 55, TypeScript, Jest, `@testing-library/react-native`.

---

## File Map

| File | Responsibility |
|------|----------------|
| `mobile/src/features/chat/utils/chatRenderState.ts` | Build turn-based completed display items and one worked row per turn. |
| `mobile/src/features/chat/utils/chatRenderState.test.ts` | Pure tests for multi-turn grouping, ask visibility, duration, and full non-completed passthrough. |
| `mobile/app/chat/useChatDetailHistory.ts` | Stop applying `placeMsctlQuestionCardsAtBottom` in Chat Detail transcript generation. |
| `mobile/app/chat/useChatDetailTranscriptScroll.ts` | Keep focus ask and older pagination anchored to final display items. |
| `mobile/app/chat/ChatTranscriptList.tsx` | Render worked rows with stable keys and forward viewability callbacks for scroll anchoring. |
| `mobile/src/__tests__/ChatTranscriptList.loading.test.tsx` | Component tests for per-turn worked rows and expansion. |
| `mobile/src/__tests__/chatDetailMsctlQuestionPlacement.test.tsx` | Update expectations: Chat Detail no longer pushes ask cards to the bottom. |
| `mobile/src/__tests__/chatDetailRoute.test.tsx` | Regression coverage for focus ask and older-message scroll stability. |

## Task 0: Baseline

**Files:** none

- [x] **Step 1: Check current worktree**

Run:

```bash
git status --short
```

Expected: note any unrelated user changes, especially `mobile/app.json`, and do not revert them.

- [x] **Step 2: Run current focused tests**

Run:

```bash
cd mobile && pnpm test -- chatRenderState.test.ts ChatTranscriptList.loading.test.tsx chatDetailMsctlQuestionPlacement.test.tsx --watchAll=false
```

Expected: current suite may pass with old behavior; record failures before editing.

- [x] **Step 3: Run baseline typecheck**

Run:

```bash
cd mobile && pnpm typecheck
```

Expected: PASS before feature edits, unless unrelated worktree changes have already introduced errors.

## Task 1: Turn-Based Completed Render State

**Files:**
- Modify: `mobile/src/features/chat/utils/chatRenderState.test.ts`
- Modify: `mobile/src/features/chat/utils/chatRenderState.ts`

- [x] **Step 1: Replace global-fold tests with per-turn failing tests**

In `chatRenderState.test.ts`, add explicit tests with concrete positive and negative assertions:

```ts
test('completed transcript folds each user turn independently with one worked row per turn', () => {
  const messages = [
    message(1, 'user_text', { payload: { text: 'first prompt' }, created_at: 1_700_000_000_000 }),
    message(2, 'agent_text', { payload: { text: 'first progress' }, created_at: 1_700_000_005_000 }),
    message(3, 'tool_call', { created_at: 1_700_000_010_000 }),
    message(4, 'agent_text', { payload: { text: 'first answer' }, created_at: 1_700_000_020_000 }),
    message(5, 'user_text', { payload: { text: 'second prompt' }, created_at: 1_700_000_030_000 }),
    message(6, 'tool_call', { payload: { tool: 'shell', args: '{}', call_id: 'call-2' }, created_at: 1_700_000_040_000 }),
    message(7, 'agent_text', { payload: { text: 'second answer' }, created_at: 1_700_000_050_000 }),
  ];

  const items = buildCompletedTranscriptDisplayItems(messages, 'completed');

  expect(displaySeqs(items)).toEqual([1, [2, 3], 4, 5, [6], 7]);
  expect(items.filter((item) => item.kind === 'worked')).toHaveLength(2);
  expect(items.some((item) => item.kind === 'worked' && item.messages.some((msg) => msg.seq === 1))).toBe(
    false,
  );
});
```

Also add a focused ask-card test:

```ts
test('completed turn keeps ask cards visible and still uses one worked row', () => {
  const messages = [
    message(1, 'user_text', { created_at: 1_700_000_000_000 }),
    message(2, 'tool_call', { created_at: 1_700_000_005_000 }),
    message(3, 'ask_question', { answered: true, created_at: 1_700_000_010_000 }),
    message(4, 'agent_text', { payload: { text: 'progress after ask' }, created_at: 1_700_000_015_000 }),
    message(5, 'ask_question', { answered: false, payload: { ask_id: 'ask-2', allow_freeform: false, questions: [] }, created_at: 1_700_000_020_000 }),
    message(6, 'agent_text', { payload: { text: 'final answer' }, created_at: 1_700_000_030_000 }),
  ];

  const items = buildCompletedTranscriptDisplayItems(messages, 'completed');

  expect(displaySeqs(items)).toEqual([1, [2, 4], 3, 5, 6]);
  expect(items.filter((item) => item.kind === 'worked')).toHaveLength(1);
});
```

Add an explicit running-conversation guard:

```ts
test('running transcript does not fold earlier completed-looking turns', () => {
  const messages = [
    message(1, 'user_text', { payload: { text: 'first prompt' } }),
    message(2, 'tool_call'),
    message(3, 'agent_text', { payload: { text: 'first answer' } }),
    message(4, 'user_text', { payload: { text: 'second prompt' } }),
    message(5, 'tool_call', { payload: { tool: 'shell', args: '{}', call_id: 'call-2' } }),
  ];

  const items = buildCompletedTranscriptDisplayItems(messages, 'running');

  expect(displaySeqs(items)).toEqual([1, 2, 3, 4, 5]);
  expect(items.some((item) => item.kind === 'worked')).toBe(false);
});
```

- [x] **Step 2: Run tests and verify they fail**

Run:

```bash
cd mobile && pnpm test -- chatRenderState.test.ts --watchAll=false
```

Expected: FAIL because current implementation creates a global fold or splits worked rows around asks.

- [x] **Step 3: Implement turn grouping**

In `chatRenderState.ts`, replace completed-only grouping with this behavior:

```ts
function isVisibleAskQuestion(msg: WsMessage): boolean {
  return msg.role === 'ask_question';
}

function splitIntoTurns(messages: WsMessage[]): WsMessage[][] {
  const turns: WsMessage[][] = [];
  let current: WsMessage[] = [];
  for (const msg of messages) {
    if (msg.role === 'user_text') {
      if (current.length > 0) turns.push(current);
      current = [msg];
      continue;
    }
    current.push(msg);
  }
  if (current.length > 0) turns.push(current);
  return turns;
}
```

For each turn:

- If the turn has no `user_text`, return its renderable messages unchanged.
- Find `finalAgentSeq` as the last `agent_text` in that turn.
- Keep visible: the turn `user_text`, all `ask_question`, and `agent_text` whose seq equals `finalAgentSeq`.
- Hide in one worked item: all other renderable messages.
- Emit display order as user, worked if present, ask cards in original relative order, final assistant if present.

Preserve existing non-completed behavior:

```ts
if (status !== 'completed') {
  return renderableMessages.map((msg) => ({ kind: 'message', message: msg }));
}
```

- [x] **Step 4: Run render-state tests**

Run:

```bash
cd mobile && pnpm test -- chatRenderState.test.ts --watchAll=false
```

Expected: PASS.

## Task 2: Remove Chat Detail Ask Bottom Placement

**Files:**
- Modify: `mobile/app/chat/useChatDetailHistory.ts`
- Modify: `mobile/src/__tests__/chatDetailMsctlQuestionPlacement.test.tsx`
- Keep unchanged: `mobile/src/features/chat/utils/msctlQuestionPlacement.ts`

- [x] **Step 1: Update tests to expect chronological Chat Detail ask placement**

In `chatDetailMsctlQuestionPlacement.test.tsx`, change assertions that expect msctl ask cards at the displayed bottom. Add explicit negative assertions that Chat Detail does not reorder asks after later agent messages.

Use a message sequence like:

```ts
[
  userText(1, 'deploy'),
  askQuestion(2, 'ask-msctl', 'user_message'),
  agentText(3, 'after ask'),
]
```

Expected displayed order: `deploy`, ask card, `after ask`.

- [x] **Step 2: Run placement tests and verify failure**

Run:

```bash
cd mobile && pnpm test -- chatDetailMsctlQuestionPlacement.test.tsx --watchAll=false
```

Expected: FAIL while Chat Detail still calls `placeMsctlQuestionCardsAtBottom`.

- [x] **Step 3: Remove bottom placement from Chat Detail history**

In `useChatDetailHistory.ts`, remove this import:

```ts
import { placeMsctlQuestionCardsAtBottom } from '@/features/chat/utils/msctlQuestionPlacement';
```

Change transcript generation from:

```ts
placeMsctlQuestionCardsAtBottom(
  collapseTodoToolCallSnapshots(visibleMessages.filter(isRenderableInChatTranscript)),
)
```

to:

```ts
collapseTodoToolCallSnapshots(visibleMessages.filter(isRenderableInChatTranscript))
```

- [x] **Step 4: Run placement tests**

Run:

```bash
cd mobile && pnpm test -- chatDetailMsctlQuestionPlacement.test.tsx --watchAll=false
```

Expected: PASS with chronological Chat Detail ask cards.

## Task 3: Display-Item Focus And Pagination Anchor Stability

**Files:**
- Modify: `mobile/app/chat/useChatDetailTranscriptScroll.ts`
- Modify: `mobile/app/chat/ChatTranscriptList.tsx`
- Modify: `mobile/src/__tests__/chatDetailRoute.test.tsx`
- Modify: `mobile/src/__tests__/ChatTranscriptList.loading.test.tsx`

- [x] **Step 1: Add failing focus and prepend regression tests**

Add or update tests so they prove:

- `focus_ask_id` scrolls to the displayed ask card after completed turn grouping.
- Loading older messages does not call `scrollToEnd` when the user is reading history.
- Display item keys for existing visible messages stay stable when older messages are prepended.

Use assertion messages that identify the broken behavior. Example negative assertion:

```ts
expect(scrollToEndSpy).not.toHaveBeenCalledWith(
  expect.objectContaining({ animated: true }),
);
```

- [x] **Step 2: Run the focused tests and verify failure**

Run:

```bash
cd mobile && pnpm test -- chatDetailRoute.test.tsx ChatTranscriptList.loading.test.tsx --watchAll=false
```

Expected: at least one new regression test fails before scroll/key fixes.

- [x] **Step 3: Make display item keys stable**

In `ChatTranscriptList.tsx`, keep message keys as `message.seq`. For worked rows, use a key that is tied to the turn and hidden seqs:

```ts
keyExtractor={(item) => getDisplayItemKey(item)}
```

Define the helper in the same file so scroll code and tests can reason about the same key shape:

```ts
function getDisplayItemKey(item: ChatTranscriptDisplayItem): string {
  return item.kind === 'message' ? `message-${item.message.seq}` : item.id;
}
```

Keep the existing `testID="worked-row"` for worked rows so current tests can still query the trigger.

- [x] **Step 4: Keep focus ask lookup on final display items**

In `useChatDetailTranscriptScroll.ts`, ensure `getDisplayItemAskId()` still only resolves top-level visible ask messages. With Task 1 ask cards are visible, so no auto-expand path is needed for ask cards.

Keep this guard:

```ts
if (focus_ask_id && hasDisplayItemAskId(transcriptItems, focus_ask_id)) return;
```

but make sure tests prove the displayed index is based on `transcriptDisplayItems`, not raw message order.

- [x] **Step 5: Add an explicit visible-item anchor**

In `useChatDetailTranscriptScroll.ts`, track the first visible display item key:

```ts
const firstVisibleDisplayItemKeyRef = useRef<string | null>(null);

function getDisplayItemKey(item: ChatTranscriptDisplayItem): string {
  return item.kind === 'message' ? `message-${item.message.seq}` : item.id;
}

const handleViewableItemsChanged = useRef(
  ({ viewableItems }: { viewableItems: Array<{ item?: ChatTranscriptDisplayItem; index: number | null }> }) => {
    const firstVisible = viewableItems.find((entry) => entry.index != null && entry.item);
    firstVisibleDisplayItemKeyRef.current = firstVisible?.item
      ? getDisplayItemKey(firstVisible.item)
      : firstVisibleDisplayItemKeyRef.current;
  },
).current;
```

Return `handleViewableItemsChanged` from the hook and pass it into `ChatTranscriptList`.

- [x] **Step 6: Restore the anchor after display items change**

In `handleContentSizeChange()`, before any bottom-stick behavior, restore the anchor when the user is reading history:

```ts
if (!isNearBottomRef.current && firstVisibleDisplayItemKeyRef.current) {
  const anchorIndex = transcriptItems.findIndex(
    (item) => getDisplayItemKey(item) === firstVisibleDisplayItemKeyRef.current,
  );
  if (anchorIndex >= 0) {
    listRef.current?.scrollToIndex({ index: anchorIndex, animated: false, viewPosition: 0 });
    return;
  }
}
```

This makes older-message prepend deterministic even when completed turn grouping changes display item count.

- [x] **Step 7: Prevent history-read scroll jumps**

When the user has scrolled history, `handleContentSizeChange()` must not auto-scroll to bottom just because older messages changed display item count. Preserve:

```ts
if (isNearBottomRef.current) {
  listRef.current?.scrollToEnd({ animated: true });
}
```

and update scroll tests so `isNearBottomRef.current` becomes false when the user scrolls away from the bottom.

- [x] **Step 8: Run scroll and list tests**

Run:

```bash
cd mobile && pnpm test -- chatDetailRoute.test.tsx ChatTranscriptList.loading.test.tsx --watchAll=false
```

Expected: PASS.

## Task 4: Final Verification

**Files:**
- Modify: `docs/exec-plans/index.json`

- [x] **Step 1: Run full focused mobile test set**

Run:

```bash
cd mobile && pnpm test -- chatRenderState.test.ts ChatTranscriptList.loading.test.tsx chatDetailMsctlQuestionPlacement.test.tsx chatDetailRoute.test.tsx --watchAll=false
```

Expected: PASS.

- [x] **Step 2: Run typecheck**

Run:

```bash
cd mobile && pnpm typecheck
```

Expected: PASS.

- [x] **Step 3: Check source file line limits**

Run:

```bash
wc -l mobile/src/features/chat/utils/chatRenderState.ts mobile/app/chat/ChatTranscriptList.tsx mobile/app/chat/useChatDetailHistory.ts mobile/app/chat/useChatDetailTranscriptScroll.ts
```

Expected: each touched source file remains at or below 500 lines.

- [x] **Step 4: Review UI constraints**

Check the worked row:

- No border.
- No card background.
- No outer grouped container.
- Colors come from `mobile/docs/design.md` allowed palette.

- [ ] **Step 5: Record completion commit after commit**

After implementation, verification, mandatory code review, and commit, add the resulting 40-character commit SHA to this plan's entry in `docs/exec-plans/index.json` as `lastCompletedCommit`.
