# Chat Completed Transcript Folding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Before writing code for any task, add or update the failing tests first.

**Spec:** [`docs/product-specs/2026-06-04-SPEC-chat-completed-transcript-folding.md`](../product-specs/2026-06-04-SPEC-chat-completed-transcript-folding.md)

**Goal:** In completed Chat Detail conversations, collapse loaded process messages behind a subtle borderless `Worked for <duration>` row while keeping the final user prompt and final assistant answer visible by default.

**Architecture:** Keep REST/WebSocket/Zustand message storage unchanged. Add a mobile render-state utility that groups an already-loaded transcript window into display items only when the conversation status is `completed`. Render the fold trigger as a lightweight transcript metadata row with no border or card background. When expanded, render the folded messages using the existing `MessageBubble` and `ToolCallRow` paths so original chat item styles are preserved.

**Tech Stack:** React Native, Expo SDK 55, TypeScript, Zustand, Jest, `@testing-library/react-native`.

---

## Interview Decisions

- Auto-fold only when conversation status is `completed`.
- Running, awaiting-question, and failed conversations keep the full transcript visible.
- Completed default view keeps the last loaded `user_text`, the last loaded `agent_text`, and any unanswered `ask_question`.
- Answered `ask_question` rows fold into the worked section.
- The fold trigger text is `Worked for <duration>`, not a process count.
- The trigger is borderless and should not look like a card.
- Expanded content is inline at the trigger position.
- Expanded content keeps original chat item styles; no outer grouped border or wrapper.
- Duration is computed only from the currently loaded window, with no full-history fetch.
- `created_at` is a millisecond timestamp; duration formatting must convert deltas to seconds.

## Source Inputs

- Product spec: `docs/product-specs/2026-06-04-SPEC-chat-completed-transcript-folding.md`.
- Prototype image: `tmp/prototypes/chat-completed-transcript-folding-prototype-v2.png`.
- Existing transcript render-state utilities: `mobile/src/features/chat/utils/chatRenderState.ts`.
- Existing transcript list renderer: `mobile/app/chat/ChatTranscriptList.tsx`.
- Existing chat detail composition: `mobile/app/chat/[id].tsx`.
- Existing transcript styles: `mobile/app/chat/styles.ts`.

## File Map

| File | Responsibility |
|------|----------------|
| `mobile/src/features/chat/utils/chatRenderState.ts` | Add completed transcript grouping and `Worked for <duration>` model. |
| `mobile/src/features/chat/utils/chatRenderState.test.ts` | Pure utility tests for grouping rules and duration formatting. |
| `mobile/app/chat/ChatTranscriptList.tsx` | Render grouped transcript display items and manage local expand/collapse state. |
| `mobile/app/chat/styles.ts` | Add borderless worked-row typography/layout styles only if needed. |
| `mobile/app/chat/[id].tsx` | Pass conversation status into `ChatTranscriptList`. |
| `mobile/src/__tests__/ChatTranscriptList.loading.test.tsx` or new focused test | Component-level tests for trigger rendering and inline expansion. |
| `docs/exec-plans/index.json` | Register this implementation plan. |

## Task 0: Baseline And Registration

**Files:**
- Modify: `docs/exec-plans/index.json`

- [x] **Step 1: Register this plan in the exec-plan index**

Add a new entry:

```json
{
  "file": "2026-06-04-chat-completed-transcript-folding.md",
  "title": "Chat Completed Transcript Folding Implementation Plan"
}
```

- [x] **Step 2: Run baseline targeted tests**

Run:

```bash
cd mobile && pnpm test -- chatRenderState.test.ts ChatTranscriptList.loading.test.tsx --watchAll=false
```

Expected: PASS before feature edits, unless existing unrelated worktree changes have already broken the suite.

- [x] **Step 3: Run baseline typecheck**

Run:

```bash
cd mobile && pnpm typecheck
```

Expected: PASS before feature edits, unless existing unrelated worktree changes have already introduced errors.

## Task 1: Completed Transcript Grouping Utility

**Files:**
- Modify: `mobile/src/features/chat/utils/chatRenderState.test.ts`
- Modify: `mobile/src/features/chat/utils/chatRenderState.ts`

- [x] **Step 1: Add failing pure-function tests**

Cover these scenarios:

- `completed` keeps the last loaded `user_text` and last loaded `agent_text` visible.
- Earlier user/assistant messages, `tool_call`, `system_event`, and answered `ask_question` are folded.
- Unanswered `ask_question` remains visible.
- Non-completed statuses return the original renderable transcript without folding.
- Fold model contains `Worked for <duration>` based on folded message `created_at`.
- No folded messages means no worked row.

- [x] **Step 2: Implement display-item model**

Add types along these lines:

```ts
export type ChatTranscriptDisplayItem =
  | { kind: 'message'; message: WsMessage }
  | { kind: 'worked'; id: string; label: string; messages: WsMessage[] };
```

Add a function such as:

```ts
export function buildCompletedTranscriptDisplayItems(
  messages: WsMessage[],
  status: Conversation['status'],
): ChatTranscriptDisplayItem[];
```

Keep existing helpers intact for current callers.

- [x] **Step 3: Implement duration formatting**

Use folded messages' `created_at` values to produce `Worked for <duration>`.

Rules:

- Use only folded messages in the currently loaded transcript window.
- Use earliest and latest folded `created_at`.
- Convert the millisecond delta to seconds before formatting.
- Clamp missing or sub-second duration to a readable minimum.
- Keep the helper deterministic and unit-tested.

## Task 2: Transcript List Rendering And Expansion

**Files:**
- Modify: `mobile/app/chat/ChatTranscriptList.tsx`
- Modify: `mobile/app/chat/styles.ts`
- Modify or create focused component test under `mobile/src/__tests__/`

- [x] **Step 1: Add failing component tests**

Cover:

- Completed transcript renders `Worked for 20s` by default.
- Folded messages are absent before tapping the trigger.
- Tapping the trigger renders folded messages inline.
- Tapping again hides folded messages.
- Trigger has no border style and no card background style.
- Expanded `tool_call` still receives matching `tool_resultMessages`.

- [x] **Step 2: Update `ChatTranscriptList` props and data model**

Pass conversation status into the component. Internally derive display items using the new utility.

Use `FlatList<ChatTranscriptDisplayItem>` and key rows by message seq or worked item id.

- [x] **Step 3: Render borderless worked trigger**

Add a `Pressable` row with text `Worked for <duration>` and a chevron.

Style constraints:

- No border.
- No card background.
- No outer grouped container.
- Low-emphasis text compatible with `mobile/docs/design.md`.

- [x] **Step 4: Render expanded messages through existing paths**

When expanded, map folded messages through the same rendering branch used for normal transcript messages.

Do not wrap the expanded group in a bordered section.

## Task 3: Chat Detail Wiring

**Files:**
- Modify: `mobile/app/chat/[id].tsx`
- Update integration test if needed.

- [x] **Step 1: Pass conversation status**

Pass `conversationStatus` to `ChatTranscriptList`.

- [x] **Step 2: Preserve focus and pagination behavior**

Ensure focus ask scrolling still works for visible pending asks. Folded answered asks do not need focus behavior unless explicitly linked by `focus_ask_id`.

- [x] **Step 3: Preserve running state behavior**

Ensure waiting footer and active typewriter behavior still use normal messages while the conversation is running.

## Task 4: Verification

- [x] **Step 1: Run targeted tests**

Run:

```bash
cd mobile && pnpm test -- chatRenderState.test.ts ChatTranscriptList.loading.test.tsx --watchAll=false
```

If a new focused test file is created, include it in the command.

- [x] **Step 2: Run typecheck**

Run:

```bash
cd mobile && pnpm typecheck
```

- [x] **Step 3: Check source file line limits**

Confirm touched files under `mobile/src|app` remain at or below 500 lines, or split before committing.

- [x] **Step 4: Review UI constraints**

Check the worked trigger against `mobile/docs/design.md`:

- Colors come from the allowed palette.
- No visible border or card background on the trigger.
- Expanded messages preserve original chat row styling.

## Completion Criteria

- Product spec behavior is implemented for completed conversations.
- Running, awaiting-question, and failed transcripts are unchanged.
- `Worked for <duration>` row is borderless.
- Expanded process rows reuse original transcript item styles.
- Targeted tests and `pnpm typecheck` pass.
