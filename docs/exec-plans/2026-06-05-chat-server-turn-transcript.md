# Chat Server Turn Transcript Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Before writing code for any task, add or update the failing tests first. Project rule overrides generic Superpowers guidance: do not commit per task. Commit once after all tasks pass, code review is requested, and Critical/Important review feedback is addressed.

**Spec:** [`docs/product-specs/2026-06-05-SPEC-chat-server-turn-transcript.md`](../product-specs/2026-06-05-SPEC-chat-server-turn-transcript.md)

**Goal:** Make Chat Detail history load a server-authored turn transcript summary first, page history by turn, and lazy-load worked-row hidden messages only when the user expands that specific turn.

**Architecture:** Add CLI transcript summary and hidden-message endpoints backed by existing SQLite `messages` and `ask_answers`. The server uses each `user_text` seq as a stable turn id (`turn-{user_seq}`), returns historical completed turns as summaries, and returns the current active turn as raw messages for `running`, `awaiting_question`, and `failed` conversations. Mobile adds a transcript-summary data source for Chat Detail, keeps WebSocket raw messages for current-turn realtime updates, and stops using the visible raw message window as the authority for worked row grouping.

**Tech Stack:** Rust + axum + rusqlite; React Native + Expo SDK 55 + TypeScript + Zustand; Jest and Cargo tests.

---

## Product Decisions Locked

- History pagination unit is `turn`, not raw messages or display rows.
- Turn boundary is each `user_text`.
- Worked row metadata is server-authored from the complete DB turn.
- Worked hidden messages are lazy-loaded; if the user never expands a worked row, hidden raw process messages are not loaded.
- Running, awaiting-question, and failed conversations use a mixed view: historical turns as summaries, current latest turn as raw messages.
- Raw `/api/v1/conversations/:id/messages` remains available for realtime, catch-up, compatibility, and worked expansion details.

## Implementation Boundaries

- Do not add runtime `CREATE TABLE`; first version should derive turns dynamically from `messages(conversation_id, seq)`.
- Do not delete or break existing raw messages API.
- Do not redesign Activity or Inbox.
- Do not persist mobile worked-row expansion state.
- Keep source files under the repo 500-line limit. `cli/src/serve/mod.rs` is already close to the limit, so route registration must be split before adding new route lines.
- Mobile colors and UI styling must stay within `mobile/docs/design.md`.

## File Map

| File | Responsibility |
|------|----------------|
| `cli/src/serve/message_rows.rs` | Shared DB-to-API message row helpers, extracted from `routes/messages.rs` so raw messages and transcript endpoints serialize messages consistently. |
| `cli/src/serve/message_rows_tests.rs` | Focused tests for answered ask hydration and tool result row serialization. |
| `cli/src/serve/transcript.rs` | Pure turn-building and transcript-summary logic from ordered message rows and conversation status. |
| `cli/src/serve/transcript_tests.rs` | Pure unit tests for turn boundaries, summary rows, current raw turn, worked metadata, and hidden-message selection. |
| `cli/src/serve/routes/transcript.rs` | HTTP handlers for turn summary page and hidden messages. |
| `cli/src/serve/routes/transcript_tests.rs` | Route tests for auth, pagination, `around_ask_id`, hidden-message lazy endpoint, and current raw behavior. |
| `cli/src/serve/routes/messages.rs` | Use shared message row helpers without changing existing response shape. |
| `cli/src/serve/routes/mod.rs` | Export transcript routes/tests. |
| `cli/src/serve/mod.rs` and possibly `cli/src/serve/router.rs` | Keep router construction under line limit while registering transcript routes. |
| `mobile/src/features/chat/types.ts` | Add transcript summary and worked metadata types. |
| `mobile/src/features/chat/services/transcriptService.ts` | New API service for transcript summaries and hidden turn messages. |
| `mobile/src/features/chat/services/transcriptService.test.ts` | Service query-shape and response tests. |
| `mobile/src/features/chat/utils/serverTranscriptDisplayItems.ts` | Convert server transcript page to `ChatTranscriptDisplayItem[]` with stable keys. |
| `mobile/src/features/chat/utils/serverTranscriptDisplayItems.test.ts` | Pure mapping tests for summaries, current raw messages, and stable worked keys. |
| `mobile/app/chat/useChatDetailServerTranscript.ts` | New hook for initial turn summary load, older turn pagination, focus ask load, and hidden-message cache. |
| `mobile/app/chat/[id].tsx` | Switch Chat Detail data source to server transcript where available and keep WebSocket current-turn updates wired. |
| `mobile/app/chat/ChatTranscriptList.tsx` | Support server worked items that lazy-load hidden messages before expansion. |
| `mobile/app/chat/useChatDetailTranscriptScroll.ts` | Continue anchoring by final display item keys for summary pages and focus ask targets. |
| `mobile/src/__tests__/chatDetailRoute.test.tsx` | Integration coverage for summary-first loading, no hidden load before click, turn pagination, and focus ask. |
| `mobile/src/__tests__/ChatTranscriptList.loading.test.tsx` | Component coverage for server worked lazy expansion. |
| `docs/exec-plans/index.json` | Register this implementation plan. |

---

## Task 0: Baseline And Registration

**Files:**
- Modify: `docs/exec-plans/index.json`

- [ ] **Step 1: Register this plan**

Add:

```json
{
  "file": "2026-06-05-chat-server-turn-transcript.md",
  "title": "Chat Server Turn Transcript Implementation Plan"
}
```

- [ ] **Step 2: Capture current worktree**

Run:

```bash
git status --short
```

Expected: note unrelated modified files, especially existing user changes such as `mobile/app.json`, and do not revert them.

- [ ] **Step 3: Run baseline focused tests**

Run:

```bash
cd cli && cargo test routes::messages_tests
cd mobile && pnpm test -- chatRenderState.test.ts ChatTranscriptList.loading.test.tsx chatDetailRoute.test.tsx --watchAll=false
```

Expected: PASS before feature edits, unless unrelated local changes already broke the suite.

- [ ] **Step 4: Run baseline type/build checks**

Run:

```bash
cd cli && cargo build
cd mobile && pnpm typecheck
```

Expected: PASS before feature edits.

---

## Task 1: Extract Shared CLI Message Row Serialization

**Files:**
- Create: `cli/src/serve/message_rows.rs`
- Create: `cli/src/serve/message_rows_tests.rs`
- Modify: `cli/src/serve/mod.rs`
- Modify: `cli/src/serve/routes/messages.rs`

- [ ] **Step 1: Add failing shared-helper tests**

Cover:

- `ask_question` rows left-join `ask_answers` and expose `answered`, `answeredChoiceId`, and `answeredChoiceIds`.
- Non-ask rows omit answered fields.
- Invalid JSON payload still serializes as `null`, matching existing raw messages behavior.
- Rows are returned in ascending seq order for latest, before, since, and around queries.

- [ ] **Step 2: Extract message row structs and SQL helpers**

Move reusable pieces out of `routes/messages.rs`:

- `MessageRow`.
- `MessagesQuery` if useful, or keep route-only query struct in the route.
- `message_select_sql`.
- `collect_message_rows`.
- DB row conversion helpers.

Keep public API names conservative:

```rust
pub struct MessageRow { ... }
pub fn message_select_sql(where_clause: &str, suffix: &str) -> String;
pub fn collect_message_rows<P>(stmt: &mut rusqlite::Statement<'_>, params: P) -> Result<Vec<MessageRow>, StatusCode>
where
    P: rusqlite::Params;
```

- [ ] **Step 3: Update raw messages route to use shared helpers**

`routes/messages.rs` should keep behavior unchanged:

- `limit`, `before_seq`, `since_seq`, and `around_ask_id` semantics remain identical.
- `POST /messages` response shape remains identical.

- [ ] **Step 4: Verify raw messages compatibility**

Run:

```bash
cd cli && cargo test routes::messages_tests message_rows
```

Expected: existing raw messages tests still pass.

---

## Task 2: CLI Turn Summary Domain Logic

**Files:**
- Create: `cli/src/serve/transcript.rs`
- Create: `cli/src/serve/transcript_tests.rs`
- Modify: `cli/src/serve/mod.rs`

- [ ] **Step 1: Add failing pure tests for turn boundaries**

Data setup should use concrete seqs:

- Prelude messages before the first `user_text` stay as raw prelude items.
- Each `user_text` starts `turn-{seq}`.
- A turn ends before the next `user_text`.
- `completed` conversations summarize all turns.
- `running`, `awaiting_question`, and `failed` conversations summarize older turns and return only the latest turn as `current_turn_raw`.

- [ ] **Step 2: Add failing worked metadata tests**

Cover:

- Summary keeps user, all ask cards, and final agent.
- Worked metadata includes stable id `worked-turn-{user_seq}`.
- Worked metadata includes `duration_ms`, `hidden_count`, `first_hidden_seq`, `last_hidden_seq`, and label.
- Worked duration is computed from complete hidden messages, not from a caller-provided visible window.
- No hidden messages means no worked metadata.
- `tool_result` is not counted as a standalone visible summary row.

- [ ] **Step 3: Add failing hidden-message selection tests**

Cover:

- Hidden endpoint selection returns only target turn hidden messages.
- Matching `tool_result` rows for hidden `tool_call` rows are included.
- Visible user, visible asks, and visible final agent are excluded.
- Result order is seq ascending.

- [ ] **Step 4: Implement transcript domain types**

Add serializable types along these lines:

```rust
pub struct TranscriptPage {
    pub conversation_id: String,
    pub status: String,
    pub items: Vec<TranscriptItem>,
    pub page_info: TranscriptPageInfo,
}

#[serde(tag = "kind")]
pub enum TranscriptItem {
    #[serde(rename = "prelude_raw")]
    PreludeRaw { messages: Vec<MessageRow> },
    #[serde(rename = "turn_summary")]
    TurnSummary(TurnSummary),
    #[serde(rename = "current_turn_raw")]
    CurrentTurnRaw(CurrentTurnRaw),
}
```

Use `MessageRow` from `message_rows.rs` for embedded messages.

- [ ] **Step 5: Implement pure builder helpers**

Core functions:

```rust
pub fn build_transcript_page(
    conversation_id: &str,
    status: &str,
    messages: Vec<MessageRow>,
    limit: usize,
    before_turn: Option<&str>,
    around_ask_id: Option<&str>,
) -> TranscriptPage;

pub fn hidden_messages_for_turn(
    messages: Vec<MessageRow>,
    turn_id: &str,
) -> Vec<MessageRow>;
```

Implementation may be refined, but tests must enforce public behavior rather than implementation details.

- [ ] **Step 6: Verify pure transcript logic**

Run:

```bash
cd cli && cargo test transcript
```

Expected: PASS.

---

## Task 3: CLI Transcript REST Routes

**Files:**
- Create: `cli/src/serve/routes/transcript.rs`
- Create: `cli/src/serve/routes/transcript_tests.rs`
- Modify: `cli/src/serve/routes/mod.rs`
- Modify: `cli/src/serve/mod.rs`
- Create or modify: `cli/src/serve/router.rs` if needed to keep `serve/mod.rs` under 500 lines.

- [ ] **Step 1: Split router construction before adding routes**

`cli/src/serve/mod.rs` is near the 500-line limit. Before adding route lines, extract router construction into a smaller helper module if needed:

- `cli/src/serve/router.rs` owns `build_router`.
- `serve/mod.rs` keeps `run_server`, scheduler startup, and test module if still under limit.
- Existing router tests must keep passing.

- [ ] **Step 2: Add failing route auth tests**

Cover both endpoints:

- `GET /api/v1/conversations/:id/transcript-turns` requires Bearer auth.
- `GET /api/v1/conversations/:id/turns/:turn_id/hidden-messages` requires Bearer auth.

- [ ] **Step 3: Add failing summary page tests**

Seed one conversation with multiple turns:

- `limit=2` returns the newest two turns in ascending transcript order.
- `before_turn=turn-20` returns older turns before that turn.
- `around_ask_id=ask-1` returns a bounded page containing the ask's turn.
- `completed` returns turn summaries only.
- `running` returns older summaries plus latest `current_turn_raw`.

- [ ] **Step 4: Add failing hidden endpoint tests**

Cover:

- Expanding `turn-10` returns hidden messages for that turn only.
- Matching `tool_result` for hidden tool calls is present.
- Unknown turn returns `404`.
- Conversation mismatch does not leak messages across conversations.

- [ ] **Step 5: Implement summary route**

Endpoint:

```http
GET /api/v1/conversations/:id/transcript-turns?limit=20&before_turn=turn-10
GET /api/v1/conversations/:id/transcript-turns?limit=20&around_ask_id=ask-1
```

Rules:

- Clamp `limit` to a conservative range, e.g. `1..=50`.
- Fetch all rows needed to compute complete turn summaries. First version may query all conversation messages, relying on indexed `(conversation_id, seq)` and local SQLite.
- Return `404` if conversation is missing.
- Return stable `page_info.oldest_turn_id` and `page_info.has_older`.

- [ ] **Step 6: Implement hidden route**

Endpoint:

```http
GET /api/v1/conversations/:id/turns/:turn_id/hidden-messages
```

Rules:

- Parse `turn-{seq}`.
- Return hidden rows and matching tool results in seq order.
- Keep ask answered hydration consistent with raw messages.

- [ ] **Step 7: Verify CLI routes**

Run:

```bash
cd cli && cargo test transcript routes::transcript_tests routes::messages_tests
cd cli && cargo build
```

Expected: PASS.

---

## Task 4: Mobile Transcript API Types And Services

**Files:**
- Modify: `mobile/src/features/chat/types.ts`
- Create: `mobile/src/features/chat/services/transcriptService.ts`
- Create: `mobile/src/features/chat/services/transcriptService.test.ts`
- Modify only if needed: `mobile/src/features/chat/index.ts`

- [ ] **Step 1: Add failing service tests**

Cover:

- `fetchTranscriptTurns(endpoint, convId, { limit })` calls `/api/v1/conversations/:id/transcript-turns`.
- `fetchTranscriptTurns(..., { beforeTurn })` sends `before_turn`.
- `fetchTranscriptTurns(..., { aroundAskId })` sends `around_ask_id`.
- `fetchTurnHiddenMessages(endpoint, convId, turnId)` calls `/api/v1/conversations/:id/turns/:turn_id/hidden-messages`.
- Service functions do not call raw `/messages`.

- [ ] **Step 2: Add TypeScript types**

Types should mirror server JSON:

- `TranscriptPage`.
- `TranscriptPageInfo`.
- `TranscriptItem`.
- `TurnSummaryItem`.
- `CurrentTurnRawItem`.
- `WorkedSummary`.
- `HiddenMessagesResponse`.

Use existing `WsMessage` for embedded messages.

- [ ] **Step 3: Implement service functions**

Create focused service module instead of expanding `chatService.ts` too much:

```ts
export async function fetchTranscriptTurns(...): Promise<TranscriptPage>;
export async function fetchTurnHiddenMessages(...): Promise<HiddenMessagesResponse>;
```

- [ ] **Step 4: Verify mobile service tests**

Run:

```bash
cd mobile && pnpm test -- transcriptService.test.ts --watchAll=false
```

Expected: PASS.

---

## Task 5: Mobile Server Transcript Display Model

**Files:**
- Create: `mobile/src/features/chat/utils/serverTranscriptDisplayItems.ts`
- Create: `mobile/src/features/chat/utils/serverTranscriptDisplayItems.test.ts`
- Modify: `mobile/src/features/chat/utils/chatRenderState.ts` only if type reuse is needed.

- [ ] **Step 1: Add failing display mapping tests**

Cover:

- A `turn_summary` maps to user message row, stable worked row, ask rows, final agent row.
- Worked row key is `worked-${turn_id}`, not hidden seq range.
- `current_turn_raw` maps raw messages in seq order.
- Prelude raw maps raw messages in seq order.
- `getAskId` works for summary ask rows.

- [ ] **Step 2: Extend display item type carefully**

Add a server-worked item variant without breaking existing client-folding tests:

```ts
type ChatTranscriptDisplayItem =
  | { kind: 'message'; message: WsMessage }
  | { kind: 'worked'; id: string; label: string; messages: WsMessage[] }
  | { kind: 'server_worked'; id: string; turnId: string; label: string; hiddenCount: number; messages?: WsMessage[]; isLoading?: boolean };
```

If keeping the existing `worked` kind is cleaner, add fields in a backward-compatible way and ensure existing tests still pass.

- [ ] **Step 3: Implement mapper**

Function:

```ts
export function buildServerTranscriptDisplayItems(pageItems: TranscriptItem[]): ChatTranscriptDisplayItem[];
```

Rules:

- Preserve server item order.
- Use stable row ids.
- Do not insert hidden messages until they are loaded.

- [ ] **Step 4: Verify pure mapping**

Run:

```bash
cd mobile && pnpm test -- serverTranscriptDisplayItems.test.ts chatRenderState.test.ts --watchAll=false
```

Expected: PASS.

---

## Task 6: Mobile Chat Detail Summary Hook

**Files:**
- Create: `mobile/app/chat/useChatDetailServerTranscript.ts`
- Modify: `mobile/app/chat/useChatDetailHistory.ts` only to keep raw-history fallback isolated.
- Modify: `mobile/app/chat/useChatDetailAgentTurn.ts` if current raw turn needs an append hook.
- Modify: `mobile/src/__tests__/chatDetailRoute.test.tsx`

- [ ] **Step 1: Add failing route tests for summary-first load**

In `chatDetailRoute.test.tsx` or a new focused test:

- Opening Chat Detail calls `fetchTranscriptTurns`, not initial raw `fetchMessages`, for transcript display.
- A completed historical turn shows worked row even when no hidden raw messages are loaded.
- Hidden endpoint is not called before pressing worked row.
- Raw `fetchMessages` is still allowed for WebSocket catch-up only after a cursor exists, if retained.

- [ ] **Step 2: Add failing older-turn pagination tests**

Cover:

- User-driven top scroll calls `fetchTranscriptTurns` with `before_turn`.
- Older summary prepend restores the visible display-item anchor.
- No raw `before_seq` call is made for history main-list pagination.

- [ ] **Step 3: Add failing focus ask tests**

Cover:

- If focused ask is in current summary page, scrolls to that ask row.
- If focused ask is outside current page, calls `fetchTranscriptTurns` with `around_ask_id`.
- Focus scroll targets final display item order.

- [ ] **Step 4: Implement hook state**

`useChatDetailServerTranscript` should own:

- Loaded transcript pages/items.
- `oldestTurnId`.
- `hasOlder`.
- `isLoadingOlder`.
- `loadOlderTurns`.
- `loadAroundAsk`.
- Hidden messages cache by `turnId`.
- `expandWorkedTurn(turnId)` lazy load state.

Do not mix hidden expanded messages into global `chatStore.messages`; keep them in transcript UI state.

- [ ] **Step 5: Integrate WebSocket current-turn updates**

When `useWebSocket` appends raw messages:

- Current raw turn should show new messages.
- Historical summaries should not duplicate the same seq as raw rows.
- On terminal `task_status`, either trigger a summary refresh or mark that next page entry should refresh from server before compressing the current turn.

- [ ] **Step 6: Verify hook route tests**

Run:

```bash
cd mobile && pnpm test -- chatDetailRoute.test.tsx --watchAll=false
```

Expected: PASS.

---

## Task 7: Mobile Transcript List Lazy Expansion

**Files:**
- Modify: `mobile/app/chat/ChatTranscriptList.tsx`
- Modify: `mobile/app/chat/styles.ts` only if loading row styling is needed.
- Modify: `mobile/src/__tests__/ChatTranscriptList.loading.test.tsx`

- [ ] **Step 1: Add failing component tests**

Cover:

- Server worked row renders collapsed with label and no hidden messages.
- Pressing server worked row calls `onExpandWorkedTurn(turnId)` exactly once.
- While loading, row shows subtle loading state without changing layout drastically.
- After messages are provided, expanded hidden messages render inline under the worked row.
- Collapsing and expanding again does not call loader again when messages are cached.
- Existing client-derived worked rows still expand as before until the old path is fully removed.

- [ ] **Step 2: Update `ChatTranscriptList` props**

Add props such as:

```ts
onExpandWorkedTurn?: (turnId: string) => void;
```

The component should not know how to fetch; it only calls the prop and renders provided display item state.

- [ ] **Step 3: Render server worked rows**

Rules:

- Keep the borderless visual treatment from existing worked row.
- Expanded hidden messages must reuse existing `renderMessage`.
- `toolResultMessages` must include hidden tool results so `ToolCallRow` can display status.

- [ ] **Step 4: Verify component tests**

Run:

```bash
cd mobile && pnpm test -- ChatTranscriptList.loading.test.tsx --watchAll=false
```

Expected: PASS.

---

## Task 8: Remove Client Window Folding As Historical Authority

**Files:**
- Modify: `mobile/app/chat/[id].tsx`
- Modify: `mobile/app/chat/useChatDetailHistory.ts`
- Modify: `mobile/src/features/chat/utils/chatRenderState.ts` only if keeping utility for fallback/tests.
- Modify relevant tests.

- [ ] **Step 1: Make server transcript the default Chat Detail data source**

Chat Detail should pass server-derived display items into `ChatTranscriptList`.

The old path that derives completed worked rows from `visibleMessages` may remain only as a fallback when the endpoint lacks transcript API support, but it must not run when server summary succeeds.

- [ ] **Step 2: Keep raw history for compatibility and realtime only**

Clarify hook responsibilities:

- `useChatDetailServerTranscript`: main display history.
- `useChatDetailHistory`: raw message fallback/catch-up support, or deprecate if superseded.
- `useWebSocket`: realtime raw messages and answer routing.

- [ ] **Step 3: Avoid duplicate current raw rows**

When server returns `current_turn_raw` and WebSocket appends the same seq:

- Deduplicate by `seq`.
- Preserve server order.
- Do not render the same current turn message both from summary and `chatStore.messages`.

- [ ] **Step 4: Verify no hidden preloading**

Add a regression assertion that completed initial open shows worked row but does not load hidden messages.

- [ ] **Step 5: Run broad chat tests**

Run:

```bash
cd mobile && pnpm test -- chatDetailRoute.test.tsx chatDetailMsctlQuestionPlacement.test.tsx ChatTranscriptList.loading.test.tsx useWebSocket.test.ts --watchAll=false
```

Expected: PASS.

---

## Task 9: Documentation And API Reference Updates

**Files:**
- Modify: `ARCHITECTURE.md`
- Modify: `docs/product-specs/2026-06-05-SPEC-chat-server-turn-transcript.md` only if implementation clarifies response details.
- Optional: `docs/references/cli-commands.md` only if endpoint references are maintained there.

- [ ] **Step 1: Update API table**

Add:

- `GET /api/v1/conversations/:id/transcript-turns`
- `GET /api/v1/conversations/:id/turns/:turn_id/hidden-messages`

- [ ] **Step 2: Update data-flow description**

Clarify:

- Chat historical browsing uses server turn summaries.
- Raw WebSocket messages remain realtime/catch-up.
- Worked hidden messages are lazy loaded.

- [ ] **Step 3: Review design-doc hash guard impact**

Tracked code changes may require updating design-doc code hashes. Before commit:

```bash
git diff -- docs/design-docs/2026-05-03-new-cli-runtime-integration-guide.md
```

If this implementation modifies tracked code referenced by design docs, review the relevant design doc and run:

```bash
python3 scripts/check-doc-code-hashes.py --update-doc <basename>.md
```

Do not bulk-refresh hashes without review.

---

## Task 10: Final Verification

- [ ] **Step 1: Run CLI checks**

Run:

```bash
cd cli && cargo test
cd cli && cargo build
```

- [ ] **Step 2: Run mobile checks**

Run:

```bash
cd mobile && pnpm typecheck
cd mobile && pnpm test -- --watchAll=false
```

- [ ] **Step 3: Check mechanized constraints**

Run:

```bash
./scripts/check-no-allow.sh
python3 scripts/check-doc-code-hashes.py
```

Also check touched source file sizes:

```bash
find mobile/src mobile/app cli/src -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.rs' \) -maxdepth 10 -print0 | xargs -0 wc -l | sort -nr | head
```

- [ ] **Step 4: Manual behavior check**

With a local `msctl serve` and a long completed chat:

- Open Chat Detail and confirm worked rows appear before expanding hidden data.
- Expand one worked row and confirm only that turn's hidden messages load.
- Scroll older turns and confirm anchor stability.
- Open a running conversation and confirm older turns are summarized while current turn remains raw.
- Navigate from Activity/Inbox with `focus_ask_id` and confirm the ask row is targeted.

- [ ] **Step 5: Request code review before commit**

Per repo rule, request code review before `git commit`. Fix Critical/Important feedback, rerun relevant checks, then commit once.

- [ ] **Step 6: Record completion commit**

After the single final commit, update `docs/exec-plans/index.json` with `lastCompletedCommit` using the full 40-character SHA.

## Completion Criteria

- Historical Chat Detail uses server turn summaries as the authority.
- Completed history shows worked rows on first load without loading hidden raw messages.
- Worked expansion lazy-loads only the selected turn's hidden messages.
- Running, awaiting-question, and failed chats show historical summaries plus current raw turn.
- Focus ask, older turn pagination, WebSocket catch-up, and hidden expansion do not duplicate or reorder rows.
- CLI and mobile verification commands pass.
