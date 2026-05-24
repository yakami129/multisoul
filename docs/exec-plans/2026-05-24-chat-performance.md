# Chat Long History Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Repository override:** This repo requires one final commit after all tasks pass verification. Do not commit after each task. Before that final commit, run `superpowers:requesting-code-review`, fix Critical/Important feedback, rerun verification, then commit once and update `docs/exec-plans/index.json` with `lastCompletedCommit`.

**Goal:** Make Chat open long conversations quickly by loading only the latest 15 messages initially, paginating older history, and virtualizing the message timeline without breaking Activity decision deep links.

**Architecture:** CLI keeps the existing `GET /api/v1/conversations/:id/messages` array response but adds optional pagination params: `limit`, `before_seq`, and `around_ask_id`. Mobile asks for the latest 15 messages on entry, uses `FlatList` for transcript virtualization, prepends older pages on upward scroll, and requests an `around_ask_id` window when Activity routes to an old pending decision. WebSocket still appends live messages into the same store, with seq-based merge and dedupe.

**Tech Stack:** Rust + axum + rusqlite for CLI API; React Native + Expo + Zustand + Jest for mobile; `FlatList` for virtualization.

---

## Files And Responsibilities

| Path | Action | Responsibility |
|---|---|---|
| `cli/src/serve/routes/messages.rs` | Modify | Parse pagination params, query latest/before/around windows, preserve answer metadata and old `since_seq` behavior |
| `cli/src/db.rs` | Modify | Add SQLite indexes for efficient `conversation_id + seq` history queries |
| `mobile/src/features/chat/services/chatService.ts` | Modify | Add typed `fetchMessages` options for `limit`, `before_seq`, `around_ask_id` |
| `mobile/src/features/chat/services/chatService.test.ts` | Modify | Verify latest, before, and focus-window request params |
| `mobile/src/store/chatStore.ts` | Modify | Add `mergeMessages`, `prependMessages`, and reset helpers with seq dedupe |
| `mobile/src/store/chatStore.test.ts` | Modify | Verify duplicate-safe merge, older prepend ordering, and preview/status recalculation |
| `mobile/app/chat/[id].tsx` | Modify | Replace full-history `ScrollView` mapping with paginated `FlatList` and focus-window load |
| `mobile/app/chat/styles.ts` | Modify | Replace `scroll`/`scrollContent` styles with list equivalents if needed |
| `mobile/src/__tests__/chatDetailRoute.test.tsx` | Modify | Verify initial `limit=15`, load older history, no duplicate messages, and `around_ask_id` focus behavior |
| `docs/product-specs/SPEC-chat-performance.md` | Reference only | Product requirements already approved |

---

## Task 1: CLI Message Pagination API

**Files:**
- Modify: `cli/src/serve/routes/messages.rs`
- Modify: `cli/src/db.rs`

- [ ] **Step 1: Write failing CLI tests for latest, before, and ask-window pagination**

Add these tests inside `cli/src/serve/routes/messages.rs` `#[cfg(test)] mod tests`.

```rust
/// Latest page pagination: opening Chat fetches only the newest N messages.
///
/// 数据构造（含关键数值的推导过程）：
///   Seeded messages seq=1..25
///   limit = 15
///   Expected latest window = 25 - 15 + 1 = seq 11..25
///
/// 执行过程（逐步说明系统如何处理）：
///   1. 插入 25 条 user_text 消息
///   2. 调用 list_messages(conv-1, limit=15)
///   3. API 按 seq 倒序取 15 条后恢复升序返回
///
/// 预期结果：
///   - 断言 A：返回 15 条，说明首屏不会全量返回 25 条
///   - 断言 B：第一条 seq=11，说明窗口从 newest-limit+1 开始
///   - 断言 C：最后一条 seq=25，说明包含最新消息
///   - 断言 D：不包含 seq=10，说明更旧消息被留给 before_seq 分页
#[tokio::test]
async fn list_messages_with_limit_returns_latest_window_only() {
    let state = test_state();
    {
        let db = state.db.lock().unwrap();
        db.execute("DELETE FROM messages WHERE conversation_id = 'conv-1'", [])
            .expect("seed cleanup should succeed");
        for seq in 1..=25 {
            db.execute(
                "INSERT INTO messages (id, conversation_id, role, payload, created_at, seq)
                 VALUES (?1, 'conv-1', 'user_text', ?2, ?3, ?4)",
                rusqlite::params![
                    format!("msg-{seq}"),
                    serde_json::json!({ "text": format!("message {seq}") }).to_string(),
                    seq,
                    seq
                ],
            )
            .expect("message seed should succeed");
        }
    }

    let Json(messages) = list_messages(
        State(state),
        Path("conv-1".to_string()),
        Query(MessagesQuery {
            since_seq: None,
            limit: Some(15),
            before_seq: None,
            around_ask_id: None,
        }),
    )
    .await
    .expect("latest page should load");

    assert_eq!(messages.len(), 15, "latest page must return exactly the requested 15 rows");
    assert_eq!(messages.first().map(|m| m.seq), Some(11), "latest page should start at seq 11");
    assert_eq!(messages.last().map(|m| m.seq), Some(25), "latest page should end at latest seq 25");
    assert!(
        !messages.iter().any(|m| m.seq == 10),
        "seq 10 is older than the latest 15 window and must not be returned"
    );
}

/// Older page pagination: before_seq returns only messages older than the anchor.
///
/// 数据构造（含关键数值的推导过程）：
///   Seeded messages seq=1..25
///   before_seq = 11
///   limit = 5
///   Expected older window = seq 6..10
///
/// 执行过程（逐步说明系统如何处理）：
///   1. 插入 25 条 user_text 消息
///   2. 调用 list_messages(conv-1, before_seq=11, limit=5)
///   3. API 只查询 seq < 11 的 5 条最近旧消息
///
/// 预期结果：
///   - 断言 A：返回 seq 6..10，说明向上翻页窗口正确
///   - 断言 B：不包含 seq=11，说明 before_seq 是排他锚点
///   - 断言 C：不包含 seq=5，说明 limit 生效
#[tokio::test]
async fn list_messages_before_seq_returns_older_page() {
    let state = test_state();
    {
        let db = state.db.lock().unwrap();
        db.execute("DELETE FROM messages WHERE conversation_id = 'conv-1'", [])
            .expect("seed cleanup should succeed");
        for seq in 1..=25 {
            db.execute(
                "INSERT INTO messages (id, conversation_id, role, payload, created_at, seq)
                 VALUES (?1, 'conv-1', 'user_text', ?2, ?3, ?4)",
                rusqlite::params![
                    format!("msg-{seq}"),
                    serde_json::json!({ "text": format!("message {seq}") }).to_string(),
                    seq,
                    seq
                ],
            )
            .expect("message seed should succeed");
        }
    }

    let Json(messages) = list_messages(
        State(state),
        Path("conv-1".to_string()),
        Query(MessagesQuery {
            since_seq: None,
            limit: Some(5),
            before_seq: Some(11),
            around_ask_id: None,
        }),
    )
    .await
    .expect("older page should load");

    let seqs: Vec<i64> = messages.iter().map(|m| m.seq).collect();
    assert_eq!(seqs, vec![6, 7, 8, 9, 10], "older page should return seq 6..10 in ascending order");
    assert!(!seqs.contains(&11), "before_seq must be exclusive; seq 11 should not be returned");
    assert!(!seqs.contains(&5), "limit=5 should exclude seq 5 from this page");
}

/// Activity focus pagination: around_ask_id loads a window containing the target ask.
///
/// 数据构造（含关键数值的推导过程）：
///   Seeded messages seq=1..30
///   ask_question with ask_id='ask-focus' at seq=18
///   limit = 9
///   Expected window includes seq=18 and stays bounded at 9 rows
///
/// 执行过程（逐步说明系统如何处理）：
///   1. 插入普通消息 seq=1..30
///   2. 将 seq=18 替换为 ask_question ask-focus
///   3. 调用 list_messages(conv-1, around_ask_id=ask-focus, limit=9)
///   4. API 查询目标 ask seq，再取其附近窗口
///
/// 预期结果：
///   - 断言 A：返回不超过 9 条，说明 focus window 有上限
///   - 断言 B：包含 seq=18，说明目标决策可定位
///   - 断言 C：包含 ask-focus payload，说明不是只返回邻近普通消息
///   - 断言 D：不包含 seq=1，说明没有退化为全量历史
#[tokio::test]
async fn list_messages_around_ask_id_returns_bounded_focus_window() {
    let state = test_state();
    {
        let db = state.db.lock().unwrap();
        db.execute("DELETE FROM messages WHERE conversation_id = 'conv-1'", [])
            .expect("seed cleanup should succeed");
        for seq in 1..=30 {
            let (role, payload) = if seq == 18 {
                (
                    "ask_question",
                    serde_json::json!({
                        "ask_id": "ask-focus",
                        "questions": [{
                            "id": "0",
                            "text": "Approve?",
                            "options": [{ "id": "yes", "label": "Yes" }]
                        }],
                        "allow_freeform": false
                    }),
                )
            } else {
                ("user_text", serde_json::json!({ "text": format!("message {seq}") }))
            };
            db.execute(
                "INSERT INTO messages (id, conversation_id, role, payload, created_at, seq)
                 VALUES (?1, 'conv-1', ?2, ?3, ?4, ?5)",
                rusqlite::params![format!("msg-{seq}"), role, payload.to_string(), seq, seq],
            )
            .expect("message seed should succeed");
        }
    }

    let Json(messages) = list_messages(
        State(state),
        Path("conv-1".to_string()),
        Query(MessagesQuery {
            since_seq: None,
            limit: Some(9),
            before_seq: None,
            around_ask_id: Some("ask-focus".to_string()),
        }),
    )
    .await
    .expect("focus page should load");

    assert!(
        messages.len() <= 9,
        "focus window should be bounded by limit=9 but returned {} rows",
        messages.len()
    );
    assert!(messages.iter().any(|m| m.seq == 18), "focus window must contain target seq 18");
    assert!(
        messages.iter().any(|m| {
            m.role == "ask_question" && m.payload.get("ask_id").and_then(|v| v.as_str()) == Some("ask-focus")
        }),
        "focus window must contain the ask_question payload for ask-focus"
    );
    assert!(
        !messages.iter().any(|m| m.seq == 1),
        "focus window must not degrade to full history from seq 1"
    );
}
```

- [ ] **Step 2: Run the focused CLI tests and verify they fail**

Run:

```bash
cd cli && cargo test serve::routes::messages::tests::list_messages_with_limit_returns_latest_window_only serve::routes::messages::tests::list_messages_before_seq_returns_older_page serve::routes::messages::tests::list_messages_around_ask_id_returns_bounded_focus_window
```

Expected: compile failure for `MessagesQuery` or assertion failures because pagination params are not implemented yet.

- [ ] **Step 3: Replace the query type and route selection logic**

In `cli/src/serve/routes/messages.rs`, replace `SinceSeqQuery` with:

```rust
#[derive(Deserialize, Default)]
pub struct MessagesQuery {
    pub since_seq: Option<i64>,
    pub limit: Option<i64>,
    pub before_seq: Option<i64>,
    pub around_ask_id: Option<String>,
}

const DEFAULT_HISTORY_LIMIT: i64 = 15;
const MAX_HISTORY_LIMIT: i64 = 100;

fn normalized_limit(limit: Option<i64>) -> i64 {
    limit
        .unwrap_or(DEFAULT_HISTORY_LIMIT)
        .clamp(1, MAX_HISTORY_LIMIT)
}
```

Then change the `list_messages` signature to:

```rust
pub async fn list_messages(
    State(state): State<AppState>,
    Path(conv_id): Path<String>,
    Query(q): Query<MessagesQuery>,
) -> Result<Json<Vec<MessageRow>>, StatusCode> {
```

Inside `list_messages`, keep the DB lock and dispatch:

```rust
    let rows = if let Some(ask_id) = q.around_ask_id.as_deref() {
        query_messages_around_ask(&db, &conv_id, ask_id, normalized_limit(q.limit))
    } else if let Some(before_seq) = q.before_seq {
        query_messages_before_seq(&db, &conv_id, before_seq, normalized_limit(q.limit))
    } else if q.limit.is_some() {
        query_latest_messages(&db, &conv_id, normalized_limit(q.limit))
    } else {
        query_messages_since_seq(&db, &conv_id, q.since_seq.unwrap_or(0))
    }
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(rows))
```

- [ ] **Step 4: Extract shared row mapping and implement query helpers**

Add these helpers below `post_message` and above `insert_user_message_and_mark_running`.

```rust
type RawMessageRow = (
    String,
    String,
    String,
    String,
    i64,
    i64,
    i64,
    Option<String>,
    Option<String>,
);

fn map_raw_message_row(raw: RawMessageRow) -> MessageRow {
    let (
        id,
        conversation_id,
        role,
        payload_str,
        created_at,
        seq,
        answered_flag,
        answered_choice_id,
        answered_choice_ids_json,
    ) = raw;
    let is_ask = role == "ask_question";
    let answered = is_ask.then_some(answered_flag != 0);
    let answered_choice_ids =
        answered_choice_ids_json.and_then(|json| serde_json::from_str::<HashMap<String, String>>(&json).ok());
    MessageRow {
        id,
        conversation_id,
        role,
        payload: serde_json::from_str(&payload_str).unwrap_or(serde_json::Value::Null),
        created_at,
        seq,
        answered,
        answered_choice_id,
        answered_choice_ids,
    }
}

fn base_select_sql(where_clause: &str, order_clause: &str) -> String {
    format!(
        "SELECT
            m.id,
            m.conversation_id,
            m.role,
            m.payload,
            m.created_at,
            m.seq,
            CASE WHEN aa.ask_id IS NULL THEN 0 ELSE 1 END AS answered,
            aa.choice_id,
            aa.choice_ids
         FROM messages m
         LEFT JOIN ask_answers aa
           ON m.role = 'ask_question'
          AND aa.conversation_id = m.conversation_id
          AND aa.ask_id = json_extract(m.payload, '$.ask_id')
         WHERE {where_clause}
         {order_clause}"
    )
}

fn collect_message_rows(mut rows: rusqlite::Rows<'_>) -> rusqlite::Result<Vec<MessageRow>> {
    let mut out = Vec::new();
    while let Some(r) = rows.next()? {
        out.push(map_raw_message_row((
            r.get(0)?,
            r.get(1)?,
            r.get(2)?,
            r.get(3)?,
            r.get(4)?,
            r.get(5)?,
            r.get(6)?,
            r.get::<_, Option<String>>(7)?,
            r.get::<_, Option<String>>(8)?,
        )));
    }
    Ok(out)
}

fn query_messages_since_seq(
    db: &rusqlite::Connection,
    conv_id: &str,
    since_seq: i64,
) -> rusqlite::Result<Vec<MessageRow>> {
    let sql = base_select_sql(
        "m.conversation_id = ?1 AND m.seq > ?2",
        "ORDER BY m.seq ASC",
    );
    let mut stmt = db.prepare(&sql)?;
    collect_message_rows(stmt.query(rusqlite::params![conv_id, since_seq])?)
}

fn query_latest_messages(
    db: &rusqlite::Connection,
    conv_id: &str,
    limit: i64,
) -> rusqlite::Result<Vec<MessageRow>> {
    let sql = format!(
        "SELECT * FROM ({}) ORDER BY seq ASC",
        base_select_sql("m.conversation_id = ?1", "ORDER BY m.seq DESC LIMIT ?2")
    );
    let mut stmt = db.prepare(&sql)?;
    collect_message_rows(stmt.query(rusqlite::params![conv_id, limit])?)
}

fn query_messages_before_seq(
    db: &rusqlite::Connection,
    conv_id: &str,
    before_seq: i64,
    limit: i64,
) -> rusqlite::Result<Vec<MessageRow>> {
    let sql = format!(
        "SELECT * FROM ({}) ORDER BY seq ASC",
        base_select_sql(
            "m.conversation_id = ?1 AND m.seq < ?2",
            "ORDER BY m.seq DESC LIMIT ?3",
        )
    );
    let mut stmt = db.prepare(&sql)?;
    collect_message_rows(stmt.query(rusqlite::params![conv_id, before_seq, limit])?)
}

fn query_messages_around_ask(
    db: &rusqlite::Connection,
    conv_id: &str,
    ask_id: &str,
    limit: i64,
) -> rusqlite::Result<Vec<MessageRow>> {
    let target_seq: i64 = db.query_row(
        "SELECT seq FROM messages
         WHERE conversation_id = ?1
           AND role = 'ask_question'
           AND json_extract(payload, '$.ask_id') = ?2
         ORDER BY seq DESC
         LIMIT 1",
        rusqlite::params![conv_id, ask_id],
        |r| r.get(0),
    )?;
    let before_limit = limit / 2;
    let after_limit = limit - before_limit;

    let mut rows = query_messages_before_seq(db, conv_id, target_seq, before_limit)?;
    let sql = base_select_sql(
        "m.conversation_id = ?1 AND m.seq >= ?2",
        "ORDER BY m.seq ASC LIMIT ?3",
    );
    let mut stmt = db.prepare(&sql)?;
    rows.extend(collect_message_rows(
        stmt.query(rusqlite::params![conv_id, target_seq, after_limit])?,
    )?);
    rows.sort_by_key(|m| m.seq);
    rows.dedup_by_key(|m| m.seq);
    Ok(rows)
}
```

- [ ] **Step 5: Add DB index migration**

In `cli/src/db.rs`, after the table creation block and before ad-hoc column migrations:

```rust
    conn.execute_batch(
        r#"
        CREATE INDEX IF NOT EXISTS idx_messages_conversation_seq
            ON messages(conversation_id, seq);
        CREATE INDEX IF NOT EXISTS idx_ask_answers_conversation_ask
            ON ask_answers(conversation_id, ask_id);
    "#,
    )?;
```

- [ ] **Step 6: Run CLI tests**

Run:

```bash
cd cli && cargo test serve::routes::messages::tests::list_messages_with_limit_returns_latest_window_only serve::routes::messages::tests::list_messages_before_seq_returns_older_page serve::routes::messages::tests::list_messages_around_ask_id_returns_bounded_focus_window
cd cli && cargo test
```

Expected: all tests pass. If `base_select_sql` with `SELECT * FROM (...)` causes SQLite column alias ambiguity, replace `SELECT *` wrappers with explicit outer column lists and keep the final order ascending.

---

## Task 2: Mobile Chat Service Pagination Params

**Files:**
- Modify: `mobile/src/features/chat/services/chatService.ts`
- Modify: `mobile/src/features/chat/services/chatService.test.ts`

- [ ] **Step 1: Write failing service tests**

Append these tests under `describe('chatService', ...)`.

```ts
describe('fetchMessages pagination', () => {
  /// Initial history page: Chat Detail fetches only the latest 15 messages.
  ///
  /// Data construction:
  ///   conv_id = conv-1
  ///   limit = 15, matching SPEC-chat-performance initial window
  ///
  /// Execution process:
  ///   1. Mock endpoint client with get spy.
  ///   2. Call fetchMessages with { limit: 15 }.
  ///   3. Inspect axios path and params.
  ///
  /// Expected result:
  ///   - Positive: params.limit is 15.
  ///   - Negative: since_seq is not sent, because initial page is newest-window pagination.
  it('requests the latest bounded page with limit only', async () => {
    const mockGet = jest.fn().mockResolvedValue({ data: [] });
    const { getEndpointClient } = require('@/api/endpointClient');
    getEndpointClient.mockReturnValue({ get: mockGet });

    await fetchMessages('http://localhost', 'tok', 'conv-1', { limit: 15 });

    expect(mockGet).toHaveBeenCalledWith('/api/v1/conversations/conv-1/messages', {
      params: { limit: 15 },
    });
    expect(mockGet.mock.calls[0][1].params.since_seq).toBeUndefined();
  });

  /// Older history page: before_seq is exclusive and paired with the page limit.
  ///
  /// Data construction:
  ///   before_seq = 101
  ///   limit = 50
  ///
  /// Execution process:
  ///   1. Mock endpoint client with get spy.
  ///   2. Call fetchMessages with { before_seq: 101, limit: 50 }.
  ///   3. Inspect axios params.
  ///
  /// Expected result:
  ///   - Positive: params include before_seq=101 and limit=50.
  ///   - Negative: around_ask_id is absent, so this is not a focus-window request.
  it('requests older messages before a seq anchor', async () => {
    const mockGet = jest.fn().mockResolvedValue({ data: [] });
    const { getEndpointClient } = require('@/api/endpointClient');
    getEndpointClient.mockReturnValue({ get: mockGet });

    await fetchMessages('http://localhost', 'tok', 'conv-1', { before_seq: 101, limit: 50 });

    expect(mockGet).toHaveBeenCalledWith('/api/v1/conversations/conv-1/messages', {
      params: { before_seq: 101, limit: 50 },
    });
    expect(mockGet.mock.calls[0][1].params.around_ask_id).toBeUndefined();
  });

  /// Activity focus page: around_ask_id requests the target decision window.
  ///
  /// Data construction:
  ///   around_ask_id = ask-focus
  ///   limit = 100
  ///
  /// Execution process:
  ///   1. Mock endpoint client with get spy.
  ///   2. Call fetchMessages with focus params.
  ///
  /// Expected result:
  ///   - Positive: params include around_ask_id=ask-focus.
  ///   - Negative: before_seq is absent, so the API does not request an older page.
  it('requests a focus window around an ask id', async () => {
    const mockGet = jest.fn().mockResolvedValue({ data: [] });
    const { getEndpointClient } = require('@/api/endpointClient');
    getEndpointClient.mockReturnValue({ get: mockGet });

    await fetchMessages('http://localhost', 'tok', 'conv-1', {
      around_ask_id: 'ask-focus',
      limit: 100,
    });

    expect(mockGet).toHaveBeenCalledWith('/api/v1/conversations/conv-1/messages', {
      params: { around_ask_id: 'ask-focus', limit: 100 },
    });
    expect(mockGet.mock.calls[0][1].params.before_seq).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
cd mobile && pnpm test -- --runTestsByPath src/features/chat/services/chatService.test.ts --watchAll=false
```

Expected: TypeScript/Jest failure because `fetchMessages` still accepts `since_seq?: number`.

- [ ] **Step 3: Implement typed options**

In `chatService.ts`, add:

```ts
export interface FetchMessagesOptions {
  since_seq?: number;
  limit?: number;
  before_seq?: number;
  around_ask_id?: string;
}
```

Replace `fetchMessages` with:

```ts
export async function fetchMessages(
  base_url: string,
  token: string,
  conv_id: string,
  options?: number | FetchMessagesOptions,
): Promise<WsMessage[]> {
  const client = getEndpointClient(base_url, token);
  const params =
    typeof options === 'number'
      ? { since_seq: options }
      : {
          ...(options?.since_seq != null ? { since_seq: options.since_seq } : {}),
          ...(options?.limit != null ? { limit: options.limit } : {}),
          ...(options?.before_seq != null ? { before_seq: options.before_seq } : {}),
          ...(options?.around_ask_id ? { around_ask_id: options.around_ask_id } : {}),
        };
  const res = await client.get<WsMessage[]>(`/api/v1/conversations/${conv_id}/messages`, {
    params,
  });
  return res.data;
}
```

The `number | FetchMessagesOptions` signature preserves the existing WebSocket reconnect call in `mobile/src/hooks/useWebSocket.ts`.

- [ ] **Step 4: Run service tests**

Run:

```bash
cd mobile && pnpm test -- --runTestsByPath src/features/chat/services/chatService.test.ts --watchAll=false
```

Expected: all `chatService` tests pass.

---

## Task 3: Chat Store Window Merge And Dedupe

**Files:**
- Modify: `mobile/src/store/chatStore.ts`
- Modify: `mobile/src/store/chatStore.test.ts`

- [ ] **Step 1: Write failing store tests**

Append these tests to `mobile/src/store/chatStore.test.ts`.

```ts
/// Message window merge: latest page and websocket overlap must not duplicate rows.
///
/// Data construction:
///   Existing store messages = seq 10, 11, 12
///   Incoming page messages  = seq 12, 13
///   Expected merged seqs    = 10, 11, 12, 13
///
/// Execution:
///   1. Seed messages for conv-1.
///   2. mergeMessages with an overlapping page.
///   3. Read store seq order.
///
/// Expected:
///   - Positive: seq 13 exists after merge.
///   - Negative: seq 12 appears only once.
it('mergeMessages dedupes by seq while preserving ascending order', () => {
  useChatStore.getState().setMessages('conv-1', [
    { type: 'message', seq: 10, role: 'user_text', payload: { text: '10' }, created_at: 10 },
    { type: 'message', seq: 11, role: 'agent_text', payload: { text: '11' }, created_at: 11 },
    { type: 'message', seq: 12, role: 'user_text', payload: { text: '12' }, created_at: 12 },
  ]);

  useChatStore.getState().mergeMessages('conv-1', [
    { type: 'message', seq: 12, role: 'user_text', payload: { text: '12 duplicate' }, created_at: 12 },
    { type: 'message', seq: 13, role: 'agent_text', payload: { text: '13' }, created_at: 13 },
  ]);

  const seqs = useChatStore.getState().messages['conv-1'].map((m) => m.seq);
  expect(seqs).toEqual([10, 11, 12, 13]);
  expect(seqs.filter((seq) => seq === 12)).toHaveLength(1);
});

/// Older page prepend: loading before the current first seq keeps a single ordered timeline.
///
/// Data construction:
///   Existing latest page = seq 11..15
///   Older page           = seq 6..10
///   Expected timeline    = seq 6..15
///
/// Execution:
///   1. Seed latest page.
///   2. prependMessages with older page.
///   3. Inspect first and last seq.
///
/// Expected:
///   - Positive: first seq becomes 6.
///   - Positive: last seq remains 15.
///   - Negative: seq 11 is not duplicated.
it('prependMessages adds older rows before the current window without duplicates', () => {
  useChatStore.getState().setMessages(
    'conv-1',
    [11, 12, 13, 14, 15].map((seq) => ({
      type: 'message' as const,
      seq,
      role: 'user_text' as const,
      payload: { text: String(seq) },
      created_at: seq,
    })),
  );

  useChatStore.getState().prependMessages(
    'conv-1',
    [6, 7, 8, 9, 10, 11].map((seq) => ({
      type: 'message' as const,
      seq,
      role: 'user_text' as const,
      payload: { text: String(seq) },
      created_at: seq,
    })),
  );

  const seqs = useChatStore.getState().messages['conv-1'].map((m) => m.seq);
  expect(seqs[0]).toBe(6);
  expect(seqs.at(-1)).toBe(15);
  expect(seqs.filter((seq) => seq === 11)).toHaveLength(1);
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
cd mobile && pnpm test -- --runTestsByPath src/store/chatStore.test.ts --watchAll=false
```

Expected: compile/runtime failure because `mergeMessages` and `prependMessages` do not exist.

- [ ] **Step 3: Implement merge helpers**

In `mobile/src/store/chatStore.ts`, extend `ChatState`:

```ts
  mergeMessages: (conv_id: string, msgs: WsMessage[]) => void;
  prependMessages: (conv_id: string, msgs: WsMessage[]) => void;
  resetMessages: (conv_id: string, msgs: WsMessage[]) => void;
```

Add this helper above `useChatStore`:

```ts
function mergeBySeq(existing: WsMessage[], incoming: WsMessage[]): WsMessage[] {
  const bySeq = new Map<number, WsMessage>();
  for (const msg of existing) bySeq.set(msg.seq, msg);
  for (const msg of incoming) {
    if (!bySeq.has(msg.seq)) bySeq.set(msg.seq, msg);
  }
  return Array.from(bySeq.values()).sort((a, b) => a.seq - b.seq);
}
```

Then implement the store methods:

```ts
  mergeMessages: (conv_id, msgs) =>
    set((s) => {
      const merged = mergeBySeq(s.messages[conv_id] ?? [], msgs);
      const fromMsgs = resolveConversationStatusFromMessageHistory(merged);
      return {
        conversations: s.conversations.map((conv) => {
          if (conv.id !== conv_id) return conv;
          let next = applyConversationPreviewMessages(conv, merged);
          if (fromMsgs != null) next = { ...next, status: fromMsgs };
          return next;
        }),
        messages: { ...s.messages, [conv_id]: merged },
      };
    }),
  prependMessages: (conv_id, msgs) =>
    set((s) => {
      const merged = mergeBySeq(msgs, s.messages[conv_id] ?? []);
      const fromMsgs = resolveConversationStatusFromMessageHistory(merged);
      return {
        conversations: s.conversations.map((conv) => {
          if (conv.id !== conv_id) return conv;
          let next = applyConversationPreviewMessages(conv, merged);
          if (fromMsgs != null) next = { ...next, status: fromMsgs };
          return next;
        }),
        messages: { ...s.messages, [conv_id]: merged },
      };
    }),
  resetMessages: (conv_id, msgs) =>
    set((s) => {
      const deduped = mergeBySeq([], msgs);
      const fromMsgs = resolveConversationStatusFromMessageHistory(deduped);
      return {
        conversations: s.conversations.map((conv) => {
          if (conv.id !== conv_id) return conv;
          let next = applyConversationPreviewMessages(conv, deduped);
          if (fromMsgs != null) next = { ...next, status: fromMsgs };
          return next;
        }),
        messages: { ...s.messages, [conv_id]: deduped },
      };
    }),
```

Update the existing `appendMessage` to use the same helper if desired, but keep its preview/status behavior intact.

- [ ] **Step 4: Run store tests**

Run:

```bash
cd mobile && pnpm test -- --runTestsByPath src/store/chatStore.test.ts --watchAll=false
```

Expected: all `chatStore` tests pass.

---

## Task 4: Chat Detail Paginated FlatList

**Files:**
- Modify: `mobile/app/chat/[id].tsx`
- Modify: `mobile/app/chat/styles.ts`
- Modify: `mobile/src/__tests__/chatDetailRoute.test.tsx`

- [ ] **Step 1: Update the test mock and write failing route tests**

In `mobile/src/__tests__/chatDetailRoute.test.tsx`, change the React Native import:

```ts
import { Alert, FlatList } from 'react-native';
```

Replace `ScrollView` scroll spying in the existing focus test with `FlatList` scroll spying after implementation. First add these tests:

```ts
test('loads only the latest 15 messages on initial chat open', async () => {
  render(<ChatDetailScreen />);

  await waitFor(() =>
    expect(fetchMessages).toHaveBeenCalledWith('http://localhost:8080', 'token', 'conv-1', {
      limit: 15,
    }),
  );
  expect(fetchMessages).not.toHaveBeenCalledWith(
    'http://localhost:8080',
    'token',
    'conv-1',
    undefined,
  );
});

test('loads older messages before the first loaded seq when the list reaches top', async () => {
  (fetchMessages as jest.Mock)
    .mockResolvedValueOnce([
      { type: 'message', seq: 11, role: 'user_text', payload: { text: '11' }, created_at: 11 },
      { type: 'message', seq: 12, role: 'agent_text', payload: { text: '12' }, created_at: 12 },
    ])
    .mockResolvedValueOnce([
      { type: 'message', seq: 6, role: 'user_text', payload: { text: '6' }, created_at: 6 },
      { type: 'message', seq: 7, role: 'agent_text', payload: { text: '7' }, created_at: 7 },
    ]);

  const { UNSAFE_getByType, getByText } = render(<ChatDetailScreen />);
  await waitFor(() => expect(getByText('12')).toBeTruthy());

  await act(async () => {
    UNSAFE_getByType(FlatList).props.onStartReached();
  });

  await waitFor(() =>
    expect(fetchMessages).toHaveBeenCalledWith('http://localhost:8080', 'token', 'conv-1', {
      before_seq: 11,
      limit: 50,
    }),
  );
  await waitFor(() => expect(getByText('6')).toBeTruthy());
});

test('loads a focus window when focus_ask_id is outside the latest page', async () => {
  mockSearchParams = {
    id: 'conv-1',
    endpoint_id: 'endpoint-1',
    focus_ask_id: 'ask-focus',
  };
  const latestOnly: WsMessage[] = [
    { type: 'message', seq: 100, role: 'user_text', payload: { text: 'latest' }, created_at: 100 },
  ];
  const focusedAsk: WsMessage = {
    type: 'message',
    seq: 18,
    role: 'ask_question',
    payload: {
      ask_id: 'ask-focus',
      allow_freeform: false,
      questions: [{ id: '0', text: 'Deploy now?', options: [{ id: 'yes', label: 'Yes' }] }],
    },
    created_at: 18,
  };
  (fetchMessages as jest.Mock)
    .mockResolvedValueOnce(latestOnly)
    .mockResolvedValueOnce([focusedAsk, ...latestOnly]);

  const { getByTestId } = render(<ChatDetailScreen />);

  await waitFor(() =>
    expect(fetchMessages).toHaveBeenCalledWith('http://localhost:8080', 'token', 'conv-1', {
      limit: 15,
    }),
  );
  await waitFor(() =>
    expect(fetchMessages).toHaveBeenCalledWith('http://localhost:8080', 'token', 'conv-1', {
      around_ask_id: 'ask-focus',
      limit: 100,
    }),
  );
  await waitFor(() => expect(getByTestId('chat-ask-ask-focus')).toBeTruthy());
});
```

- [ ] **Step 2: Run route tests and verify failure**

Run:

```bash
cd mobile && pnpm test -- --runTestsByPath src/__tests__/chatDetailRoute.test.tsx --watchAll=false
```

Expected: initial call still uses old full-history fetch and the component still renders a `ScrollView`.

- [ ] **Step 3: Replace `ScrollView` imports and refs**

In `mobile/app/chat/[id].tsx`, replace `ScrollView` with `FlatList` in the React Native import:

```ts
  FlatList,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
```

Replace refs/state near the top of `ChatDetailScreen`:

```ts
const listRef = useRef<FlatList<WsMessage>>(null);
const [isLoadingOlder, setIsLoadingOlder] = useState(false);
const [hasOlderMessages, setHasOlderMessages] = useState(true);
const isAtBottomRef = useRef(true);
```

Keep `askMessageYRef` only if still needed for tests; prefer `scrollToIndex` by seq when possible.

- [ ] **Step 4: Use new store methods and constants**

Change store selectors:

```ts
const resetMessages = useChatStore((s) => s.resetMessages);
const mergeMessages = useChatStore((s) => s.mergeMessages);
const prependMessages = useChatStore((s) => s.prependMessages);
```

Add constants above the component:

```ts
const INITIAL_MESSAGE_LIMIT = 15;
const OLDER_MESSAGE_LIMIT = 50;
const FOCUS_MESSAGE_LIMIT = 100;
```

- [ ] **Step 5: Update initial history load**

Replace the `fetchMessages(endpoint.base_url, endpoint.token, conv_id)` call with:

```ts
fetchMessages(endpoint.base_url, endpoint.token, conv_id, { limit: INITIAL_MESSAGE_LIMIT })
```

When the page resolves, use `resetMessages(conv_id, merged)` instead of `setMessages(conv_id, merged)`. After reset:

```ts
setHasOlderMessages(merged.length > 0 && Math.min(...merged.map((m) => m.seq)) > 1);
requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: false }));
```

If `focus_ask_id` is present and `merged` does not contain that ask, issue:

```ts
const focusMsgs = await fetchMessages(endpoint.base_url, endpoint.token, conv_id, {
  around_ask_id: focus_ask_id,
  limit: FOCUS_MESSAGE_LIMIT,
});
mergeMessages(conv_id, focusMsgs);
```

Then scroll to the target after the merged list renders.

- [ ] **Step 6: Add older page loader**

Inside `ChatDetailScreen`, add:

```ts
const loadOlderMessages = React.useCallback(async () => {
  if (!endpoint || isLoadingOlder || !hasOlderMessages) return;
  const firstSeq = messages[0]?.seq;
  if (firstSeq == null || firstSeq <= 1) {
    setHasOlderMessages(false);
    return;
  }
  setIsLoadingOlder(true);
  try {
    const older = await fetchMessages(endpoint.base_url, endpoint.token, conv_id, {
      before_seq: firstSeq,
      limit: OLDER_MESSAGE_LIMIT,
    });
    if (older.length === 0) {
      setHasOlderMessages(false);
      return;
    }
    prependMessages(conv_id, older);
    const minSeq = Math.min(...older.map((m) => m.seq));
    setHasOlderMessages(minSeq > 1);
  } catch (error: unknown) {
    recordDiagnosticsEvent('error', 'chat.history', 'failed to load older chat history', {
      conv_id,
      endpoint_id,
      before_seq: firstSeq,
      error,
    });
  } finally {
    setIsLoadingOlder(false);
  }
}, [conv_id, endpoint, endpoint_id, hasOlderMessages, isLoadingOlder, messages, prependMessages]);
```

- [ ] **Step 7: Render the transcript with `FlatList`**

Replace the current `<ScrollView>` block with:

```tsx
<FlatList
  ref={listRef}
  style={s.list}
  contentContainerStyle={s.listContent}
  data={transcriptMessages}
  keyExtractor={(msg) => `${msg.seq}`}
  onStartReached={() => {
    void loadOlderMessages();
  }}
  onStartReachedThreshold={0.2}
  onScroll={(event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { layoutMeasurement, contentOffset, contentSize } = event.nativeEvent;
    isAtBottomRef.current =
      layoutMeasurement.height + contentOffset.y >= contentSize.height - 48;
  }}
  maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
  renderItem={({ item: msg, index }) => {
    const askId =
      msg.role === 'ask_question' ? (msg.payload as { ask_id?: string }).ask_id : undefined;
    return (
      <View
        testID={askId ? `chat-ask-${askId}` : undefined}
        onLayout={() => {
          if (!askId || askId !== focus_ask_id || didScrollToFocusRef.current) return;
          listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.1 });
          didScrollToFocusRef.current = true;
        }}
      >
        <MessageBubble
          msg={msg}
          typewriter={msg.seq === activeTypewriterSeq}
          forceComplete={msg.seq === activeTypewriterSeq && shouldForceComplete}
          onAnswer={sendAnswer}
          onAnswerMulti={sendAnswerMulti}
          imageUri={imageUriForMessage(msg)}
          waiting={false}
          serverUrl={endpoint?.base_url ?? ''}
          token={endpoint?.token ?? ''}
        />
      </View>
    );
  }}
  ListFooterComponent={
    isAgentRunning && incomingAgentActivitySeq === null ? (
      <MessageBubble msg={WAITING_MESSAGE} waiting />
    ) : null
  }
  onContentSizeChange={() => {
    const currentCount = transcriptMessages.length + (isAgentRunning ? 1 : 0);
    if (currentCount > prevMessageCountRef.current && isAtBottomRef.current) {
      prevMessageCountRef.current = currentCount;
      listRef.current?.scrollToEnd({ animated: true });
    }
  }}
/>
```

If the installed React Native version complains about `onStartReached`, use `onScroll` with `contentOffset.y < 120` to trigger `loadOlderMessages` and keep the same test intent with `props.onScroll`.

- [ ] **Step 8: Update styles**

In `mobile/app/chat/styles.ts`, replace or add:

```ts
  list: { flex: 1 },
  listContent: { padding: 16, gap: 20 },
```

Remove unused `scroll`/`scrollContent` only after `rg "s\\.scroll"` and `rg "s\\.scrollContent"` show no remaining references.

- [ ] **Step 9: Run route tests**

Run:

```bash
cd mobile && pnpm test -- --runTestsByPath src/__tests__/chatDetailRoute.test.tsx --watchAll=false
```

Expected: tests pass. If focus test is still tied to `ScrollView.prototype.scrollTo`, update it to spy on `FlatList.prototype.scrollToIndex` and assert `viewPosition: 0.1`.

---

## Task 5: Full Verification And Documentation Checks

**Files:**
- Modify only if needed: `docs/product-specs/SPEC-chat-performance.md`
- Modify only after final commit: `docs/exec-plans/index.json`

- [ ] **Step 1: Run focused mobile tests**

Run:

```bash
cd mobile && pnpm test -- --runTestsByPath \
  src/features/chat/services/chatService.test.ts \
  src/store/chatStore.test.ts \
  src/__tests__/chatDetailRoute.test.tsx \
  --watchAll=false
```

Expected: all focused tests pass.

- [ ] **Step 2: Run mobile typecheck**

Run:

```bash
cd mobile && pnpm typecheck
```

Expected: TypeScript exits 0.

- [ ] **Step 3: Run CLI verification**

Run:

```bash
cd cli && cargo test
cd cli && cargo build
```

Expected: both commands exit 0.

- [ ] **Step 4: Run documentation index checks**

Run:

```bash
python3 scripts/check-docs-indices.py
```

Expected: exits 0.

- [ ] **Step 5: Manual smoke test**

Run CLI and mobile locally if environment is available:

```bash
cd cli && cargo run -- serve
```

In the app, open a seeded conversation with more than 15 messages. Verify:

- first request includes `limit=15`
- latest messages appear first
- scrolling up loads `before_seq=<first loaded seq>&limit=50`
- sending a message still shows waiting state and WebSocket appended output
- Activity route with `focus_ask_id` opens the ask card

- [ ] **Step 6: Request code review before commit**

Use `superpowers:requesting-code-review`. Fix Critical/Important feedback and rerun Steps 1-4.

- [ ] **Step 7: Final single commit and index update**

After all verification passes and review feedback is handled:

```bash
git add cli/src/serve/routes/messages.rs cli/src/db.rs \
  mobile/src/features/chat/services/chatService.ts \
  mobile/src/features/chat/services/chatService.test.ts \
  mobile/src/store/chatStore.ts mobile/src/store/chatStore.test.ts \
  mobile/app/chat/[id].tsx mobile/app/chat/styles.ts \
  mobile/src/__tests__/chatDetailRoute.test.tsx \
  docs/product-specs/SPEC-chat-performance.md \
  docs/product-specs/index.json \
  docs/exec-plans/2026-05-24-chat-performance.md \
  docs/exec-plans/index.json
git commit -m "perf(chat): paginate long conversation history"
```

Then get the 40-character SHA:

```bash
git rev-parse HEAD
```

Update this entry in `docs/exec-plans/index.json`:

```json
{
  "file": "2026-05-24-chat-performance.md",
  "title": "Chat Long History Performance Implementation Plan",
  "lastCompletedCommit": "<40-char-sha>"
}
```

Run `python3 scripts/check-docs-indices.py` again after editing the index.

---

## Self-Review

**Spec coverage:**  
- 1s latest-message opening: Task 1 latest API + Task 4 initial `limit=15`
- default latest bottom: Task 4 `scrollToEnd({ animated: false })`
- older history pagination: Task 1 `before_seq` + Task 4 `loadOlderMessages`
- long-history rendering: Task 4 `FlatList`
- Activity decision positioning: Task 1 `around_ask_id` + Task 4 focus window
- REST/WS consistency: Task 3 merge/dedupe + existing `useWebSocket` numeric `since_seq` compatibility in Task 2
- error behavior: Task 4 catches older-page failures without clearing existing messages

**Placeholder scan:** No placeholder markers or unspecified test steps remain.

**Type consistency:** `MessagesQuery` is the Rust route query type; `FetchMessagesOptions` is the mobile service type; mobile uses `limit`, `before_seq`, and `around_ask_id` with the same names sent to CLI.
