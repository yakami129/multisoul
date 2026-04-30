# Swipe-to-Delete Recent Conversations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add WeChat-style left-swipe delete to the Recent conversations list, with optimistic UI and permanent backend deletion.

**Architecture:** Backend gains `DELETE /api/v1/conversations/:id` (SQLite cascade handles messages/tasks). Frontend adds `deleteConversation` to chatService, `removeConversation`/`restoreConversation` to chatStore, and wraps each FlatList row in `Swipeable` from `react-native-gesture-handler` with a red DELETE action button.

**Tech Stack:** Rust/axum (backend), React Native, react-native-gesture-handler (Swipeable — already bundled with Expo SDK 54), Zustand, @testing-library/react-native

---

## File Structure

```
cli/src/serve/routes/conversations.rs   MODIFY — add delete_conversation handler
cli/src/serve/mod.rs                    MODIFY — register DELETE route

mobile/src/features/chat/services/chatService.ts          MODIFY — add deleteConversation()
mobile/src/store/chatStore.ts                             MODIFY — add removeConversation / restoreConversation
mobile/src/features/chat/components/ChatHomeScreen.tsx    MODIFY — wrap rows in Swipeable
mobile/src/features/chat/components/ChatHomeScreen.test.tsx  CREATE — swipe-delete tests
```

---

## Task 1: Backend — DELETE /api/v1/conversations/:id

**Files:**
- Modify: `cli/src/serve/routes/conversations.rs`
- Modify: `cli/src/serve/mod.rs`

- [ ] **Step 1: Write the failing test**

Add to the bottom of `cli/src/serve/routes/conversations.rs` (inside the existing `#[cfg(test)] mod tests` block):

```rust
/// DELETE /api/v1/conversations/:id removes the conversation and returns 204.
///
/// Data construction:
///   - Insert agent "test-agent"
///   - POST to create a conversation → capture id
///
/// Execution:
///   1. DELETE /api/v1/conversations/:id with valid token
///   2. Query DB to confirm row is gone
///
/// Expected:
///   - status == 204 (no content)
///   - conversation row no longer exists in DB
///   - DELETE again returns 404 (already gone)
#[tokio::test]
async fn test_delete_conversation_returns_204() {
    let (app, agent_id) = make_conv_app("tok").await;

    // Create a conversation first
    let create_body = serde_json::json!({ "title": "To delete" });
    let create_resp = app.clone().oneshot(
        Request::builder()
            .method("POST")
            .uri(format!("/api/v1/agents/{}/conversations", agent_id))
            .header("Authorization", "Bearer tok")
            .header("Content-Type", "application/json")
            .body(Body::from(create_body.to_string())).unwrap()
    ).await.unwrap();
    assert_eq!(create_resp.status(), StatusCode::CREATED, "setup: create must succeed");
    let bytes = axum::body::to_bytes(create_resp.into_body(), 4096).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    let conv_id = json["id"].as_str().unwrap().to_string();

    // Register the delete route on the same app
    let app_with_delete = make_conv_app_with_delete("tok").await;

    // DELETE it
    let del_resp = app_with_delete.clone().oneshot(
        Request::builder()
            .method("DELETE")
            .uri(format!("/api/v1/conversations/{}", conv_id))
            .header("Authorization", "Bearer tok")
            .body(Body::empty()).unwrap()
    ).await.unwrap();
    assert_eq!(del_resp.status(), StatusCode::NO_CONTENT, "delete must return 204");

    // DELETE again → 404
    let del_again = app_with_delete.oneshot(
        Request::builder()
            .method("DELETE")
            .uri(format!("/api/v1/conversations/{}", conv_id))
            .header("Authorization", "Bearer tok")
            .body(Body::empty()).unwrap()
    ).await.unwrap();
    assert_eq!(del_again.status(), StatusCode::NOT_FOUND, "second delete must return 404");
}
```

Also add the `make_conv_app_with_delete` helper inside the same `mod tests` block:

```rust
async fn make_conv_app_with_delete(token: &str) -> axum::Router {
    let dir = tempdir().unwrap();
    let conn = db::open_at(&dir.path().join("t.db")).unwrap();
    let agent_id = insert_agent(&conn, "test-agent", "/p", "claude-code").unwrap();
    // Insert a known conversation so we can delete it
    conn.execute(
        "INSERT INTO conversations (id, agent_id, title, created_at, last_message_at, status) VALUES ('conv-del-1',?1,'Del me',1,1,'idle')",
        [&agent_id],
    ).unwrap();
    let state = AppState::new(conn, token.to_string());
    axum::Router::new()
        .route("/api/v1/agents/:id/conversations",
            axum::routing::get(list_conversations).post(create_conversation))
        .route("/api/v1/conversations/:id",
            axum::routing::delete(delete_conversation))
        .layer(axum::middleware::from_fn_with_state(state.clone(), bearer_auth))
        .with_state(state)
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd cli && cargo test test_delete_conversation_returns_204 -- --nocapture
```

Expected: compile error — `delete_conversation` not found.

- [ ] **Step 3: Implement delete_conversation handler**

Add to `cli/src/serve/routes/conversations.rs` (before the `#[cfg(test)]` block):

```rust
pub async fn delete_conversation(
    State(state): State<AppState>,
    Path(conv_id): Path<String>,
) -> Result<StatusCode, StatusCode> {
    let db = state.db.lock().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let n = db.execute("DELETE FROM conversations WHERE id = ?1", [&conv_id])
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    if n == 0 { Err(StatusCode::NOT_FOUND) } else { Ok(StatusCode::NO_CONTENT) }
}
```

- [ ] **Step 4: Register the route**

In `cli/src/serve/mod.rs`, add the new route inside `build_router`:

```rust
.route("/api/v1/conversations/:id",
    axum::routing::delete(conversations::delete_conversation))
```

The full updated route block (replace the existing `.route` lines):

```rust
Router::new()
    .route("/api/v1/healthz", axum::routing::get(healthz::healthz))
    .route("/api/v1/agents",                          axum::routing::get(agents::list_agents))
    .route("/api/v1/agents/:id",                      axum::routing::get(agents::get_agent))
    .route("/api/v1/agents/:id/conversations",        axum::routing::get(conversations::list_conversations).post(conversations::create_conversation))
    .route("/api/v1/conversations/:id",               axum::routing::delete(conversations::delete_conversation))
    .route("/api/v1/conversations/:id/messages",      axum::routing::get(messages::list_messages).post(messages::post_message))
    .route("/api/v1/push-tokens",                     axum::routing::post(push_tokens::register_token))
    .route("/api/v1/push-tokens/:id",                 axum::routing::delete(push_tokens::delete_token))
    .route("/ws/conversations/:id",                   axum::routing::get(ws::ws_handler))
    .layer(middleware::from_fn_with_state(state.clone(), auth::bearer_auth))
    .layer(CorsLayer::permissive())
    .with_state(state)
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd cli && cargo test test_delete_conversation_returns_204 -- --nocapture
```

Expected: PASS

- [ ] **Step 6: Run all CLI tests**

```bash
cd cli && cargo test
```

Expected: all tests pass, no regressions.

- [ ] **Step 7: Commit**

```bash
git add cli/src/serve/routes/conversations.rs cli/src/serve/mod.rs
git commit -m "feat(cli): add DELETE /api/v1/conversations/:id"
```

---

## Task 2: Frontend — deleteConversation service + chatStore actions

**Files:**
- Modify: `mobile/src/features/chat/services/chatService.ts`
- Modify: `mobile/src/store/chatStore.ts`

- [ ] **Step 1: Add deleteConversation to chatService**

In `mobile/src/features/chat/services/chatService.ts`, add after `postMessage`:

```ts
export async function deleteConversation(
  base_url: string,
  token: string,
  conv_id: string,
): Promise<void> {
  const client = getEndpointClient(base_url, token);
  await client.delete(`/api/v1/conversations/${conv_id}`);
}
```

- [ ] **Step 2: Add removeConversation and restoreConversation to chatStore**

Replace the full content of `mobile/src/store/chatStore.ts` with:

```ts
import { create } from 'zustand';
import { type Conversation, type WsMessage } from '@/types';

interface ChatState {
  conversations: Conversation[];
  messages: Record<string, WsMessage[]>;
  setConversations: (convs: Conversation[]) => void;
  removeConversation: (id: string) => void;
  restoreConversation: (conv: Conversation, index: number) => void;
  appendMessage: (conv_id: string, msg: WsMessage) => void;
  setMessages: (conv_id: string, msgs: WsMessage[]) => void;
}

export const useChatStore = create<ChatState>((set) => ({
  conversations: [],
  messages: {},
  setConversations: (conversations) => set({ conversations }),
  removeConversation: (id) =>
    set((s) => ({ conversations: s.conversations.filter((c) => c.id !== id) })),
  restoreConversation: (conv, index) =>
    set((s) => {
      const next = [...s.conversations];
      next.splice(index, 0, conv);
      return { conversations: next };
    }),
  appendMessage: (conv_id, msg) =>
    set((s) => {
      const existing = s.messages[conv_id] ?? [];
      if (existing.some((m) => m.seq === msg.seq)) return s;
      return { messages: { ...s.messages, [conv_id]: [...existing, msg] } };
    }),
  setMessages: (conv_id, msgs) =>
    set((s) => ({ messages: { ...s.messages, [conv_id]: msgs } })),
}));
```

- [ ] **Step 3: Run typecheck**

```bash
cd mobile && pnpm typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add mobile/src/features/chat/services/chatService.ts mobile/src/store/chatStore.ts
git commit -m "feat(mobile): add deleteConversation service + store actions"
```

---

## Task 3: Frontend — Swipeable row in ChatHomeScreen

**Files:**
- Modify: `mobile/src/features/chat/components/ChatHomeScreen.tsx`
- Create: `mobile/src/features/chat/components/ChatHomeScreen.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `mobile/src/features/chat/components/ChatHomeScreen.test.tsx`:

```tsx
import { render, fireEvent } from '@testing-library/react-native';
import React from 'react';
import ChatHomeScreen from './ChatHomeScreen';
import { type Conversation } from '@/types';

// Mock gesture handler — Swipeable renders children in test env
jest.mock('react-native-gesture-handler', () => {
  const { View } = require('react-native');
  return {
    Swipeable: ({ children, renderRightActions }: any) => (
      <View>
        {children}
        {renderRightActions && renderRightActions()}
      </View>
    ),
    GestureHandlerRootView: ({ children }: any) => children,
  };
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }: any) => children,
}));

const makeConv = (id: string): Conversation => ({
  id,
  agent_id: 'agent-1',
  title: `Conv ${id}`,
  created_at: 1000,
  last_message_at: 2000,
  status: 'idle',
  endpoint_id: 'ep-1',
  agent_name: 'TestAgent',
  first_user_message: 'hello',
});

// T-1: delete button is visible after swipe (rendered via renderRightActions)
//
// Data: 1 conversation
//
// Execution:
//   1. Render ChatHomeScreen with 1 conversation
//   2. Mock renders renderRightActions immediately
//
// Expected:
//   - "DELETE" text is visible in the rendered output
test('renders DELETE action button for each row', () => {
  const { getAllByText } = render(
    <ChatHomeScreen
      conversations={[makeConv('c1')]}
      onPressConversation={jest.fn()}
      onPressNewChat={jest.fn()}
      onDeleteConversation={jest.fn()}
    />,
  );
  expect(getAllByText('DELETE').length).toBeGreaterThan(0);
});

// T-2: pressing DELETE calls onDeleteConversation with the conversation id
//
// Data: 1 conversation with id 'c1'
//
// Execution:
//   1. Render ChatHomeScreen
//   2. Press the DELETE button
//
// Expected:
//   - onDeleteConversation called with 'c1'
test('pressing DELETE calls onDeleteConversation with conversation id', () => {
  const onDelete = jest.fn();
  const { getAllByText } = render(
    <ChatHomeScreen
      conversations={[makeConv('c1')]}
      onPressConversation={jest.fn()}
      onPressNewChat={jest.fn()}
      onDeleteConversation={onDelete}
    />,
  );
  fireEvent.press(getAllByText('DELETE')[0]);
  expect(onDelete).toHaveBeenCalledWith('c1');
});

// T-3: multiple conversations each get their own DELETE button
//
// Data: 2 conversations c1, c2
//
// Expected:
//   - 2 DELETE buttons rendered
//   - pressing second DELETE calls onDeleteConversation with 'c2'
test('each conversation row has its own DELETE button', () => {
  const onDelete = jest.fn();
  const { getAllByText } = render(
    <ChatHomeScreen
      conversations={[makeConv('c1'), makeConv('c2')]}
      onPressConversation={jest.fn()}
      onPressNewChat={jest.fn()}
      onDeleteConversation={onDelete}
    />,
  );
  const buttons = getAllByText('DELETE');
  expect(buttons.length).toBe(2);
  fireEvent.press(buttons[1]);
  expect(onDelete).toHaveBeenCalledWith('c2');
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd mobile && pnpm test -- --watchAll=false --testPathPattern="ChatHomeScreen.test"
```

Expected: FAIL — `onDeleteConversation` prop not accepted, no DELETE button.

- [ ] **Step 3: Update ChatHomeScreen to accept onDeleteConversation and use Swipeable**

Replace the full content of `mobile/src/features/chat/components/ChatHomeScreen.tsx`:

```tsx
import { Swipeable } from 'react-native-gesture-handler';
import { Search, Pencil } from 'lucide-react-native';
import React, { useRef } from 'react';
import { View, Text, FlatList, TouchableOpacity, TextInput, StyleSheet } from 'react-native';
import { type Conversation } from '@/types';

const truncate = (s: string, max = 50) => (s.length > max ? s.slice(0, max) + '...' : s);

interface Props {
  conversations: Conversation[];
  onPressConversation: (conv: Conversation) => void;
  onPressNewChat: () => void;
  onDeleteConversation: (id: string) => void;
}

export default function ChatHomeScreen({
  conversations,
  onPressConversation,
  onPressNewChat,
  onDeleteConversation,
}: Props) {
  const [search, setSearch] = React.useState('');
  const openSwipeableRef = useRef<Swipeable | null>(null);

  const filtered = conversations.filter(
    (c) =>
      c.agent_name.toLowerCase().includes(search.toLowerCase()) ||
      c.title.toLowerCase().includes(search.toLowerCase()) ||
      (c.first_user_message ?? '').toLowerCase().includes(search.toLowerCase()),
  );

  const renderDeleteAction = (conv: Conversation) => (
    <TouchableOpacity
      style={s.deleteAction}
      onPress={() => onDeleteConversation(conv.id)}
    >
      <Text style={s.deleteText}>DELETE</Text>
    </TouchableOpacity>
  );

  return (
    <View style={s.root}>
      <View style={s.header}>
        <Text style={s.headerTitle}>MULTISOUL</Text>
        <TouchableOpacity onPress={onPressNewChat}>
          <Pencil size={20} color="#20C20E" />
        </TouchableOpacity>
      </View>

      <View style={s.searchWrap}>
        <View style={s.searchBar}>
          <Search size={16} color="#2D8B2D" />
          <TextInput
            style={s.searchInput}
            placeholder="Search..."
            placeholderTextColor="#2D8B2D"
            value={search}
            onChangeText={setSearch}
          />
        </View>
      </View>

      <View style={s.sectionWrap}>
        <Text style={s.sectionLabel}>RECENT</Text>
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        style={s.list}
        renderItem={({ item }) => {
          const initials = item.agent_name.slice(0, 2).toUpperCase();
          const running = item.status === 'running' || item.status === 'awaiting_question';
          return (
            <Swipeable
              ref={(ref) => {
                // close previously opened swipeable when a new one opens
                if (ref && openSwipeableRef.current && openSwipeableRef.current !== ref) {
                  openSwipeableRef.current.close();
                }
                openSwipeableRef.current = ref;
              }}
              renderRightActions={() => renderDeleteAction(item)}
              overshootRight={false}
            >
              <TouchableOpacity style={s.row} onPress={() => onPressConversation(item)}>
                <View style={s.avatarWrap}>
                  <View style={s.avatar}>
                    <Text style={s.avatarText}>{initials}</Text>
                  </View>
                  {running && <View style={s.unreadDot} />}
                </View>
                <View style={s.rowContent}>
                  <View style={s.rowTop}>
                    <Text style={s.agentName}>{item.agent_name}</Text>
                    <Text style={s.timestamp}>
                      {new Date(item.last_message_at).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </Text>
                  </View>
                  <Text style={s.lastMessage} numberOfLines={1}>
                    {item.first_user_message ?? ''}
                  </Text>
                  {item.last_ai_reply ? (
                    <Text style={s.description} numberOfLines={1}>
                      {truncate(item.last_ai_reply)}
                    </Text>
                  ) : null}
                </View>
              </TouchableOpacity>
            </Swipeable>
          );
        }}
      />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#040D04' },
  header: {
    height: 52,
    backgroundColor: '#061206',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#0F2B0F',
  },
  headerTitle: { fontFamily: 'Anton', fontSize: 22, color: '#20C20E' },
  searchWrap: { height: 68, backgroundColor: '#040D04', padding: 12 },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0A1A0A',
    borderRadius: 2,
    borderWidth: 1,
    borderColor: '#0F2B0F',
    paddingHorizontal: 12,
    gap: 8,
  },
  searchInput: { flex: 1, fontFamily: 'Geist', fontSize: 14, color: '#20C20E', height: 44 },
  sectionWrap: { height: 36, justifyContent: 'center', paddingHorizontal: 16 },
  sectionLabel: { fontFamily: 'Inter', fontSize: 11, color: '#2D8B2D', letterSpacing: 2 },
  list: { flex: 1 },
  row: { height: 80, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, gap: 12, backgroundColor: '#040D04' },
  avatarWrap: { position: 'relative' },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#0F2B0F',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontFamily: 'Anton', fontSize: 11, color: '#20C20E' },
  unreadDot: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#FFB000',
  },
  rowContent: { flex: 1, gap: 3 },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  agentName: { fontFamily: 'Anton', fontSize: 14, color: '#20C20E' },
  timestamp: { fontFamily: 'Inter', fontSize: 11, color: '#0F6B0F' },
  lastMessage: { fontFamily: 'Geist', fontSize: 13, color: '#2D8B2D' },
  description: { fontFamily: 'Geist', fontSize: 12, color: '#147A16' },
  deleteAction: {
    width: 80,
    backgroundColor: '#1A0000',
    borderLeftWidth: 1,
    borderLeftColor: '#8B0000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteText: { fontFamily: 'Anton', fontSize: 13, color: '#FF3333' },
});
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd mobile && pnpm test -- --watchAll=false --testPathPattern="ChatHomeScreen.test"
```

Expected: all 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/features/chat/components/ChatHomeScreen.tsx \
        mobile/src/features/chat/components/ChatHomeScreen.test.tsx
git commit -m "feat(mobile): swipeable delete row in ChatHomeScreen"
```

---

## Task 4: Wire up optimistic delete in ChatTab

**Files:**
- Modify: `mobile/app/(tabs)/chat.tsx`

- [ ] **Step 1: Update ChatTab to handle delete with optimistic update**

Replace the full content of `mobile/app/(tabs)/chat.tsx`:

```tsx
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import React, { useCallback } from 'react';
import { SafeAreaView, StyleSheet } from 'react-native';
import { fetchAllAgents } from '@/features/agents/services/agentService';
import ChatHomeScreen from '@/features/chat/components/ChatHomeScreen';
import { fetchConversations, deleteConversation } from '@/features/chat/services/chatService';
import { useChatStore } from '@/store/chatStore';
import { useEndpointStore } from '@/store/endpointStore';
import { type Conversation } from '@/types';

export default function ChatTab() {
  const router = useRouter();
  const endpoints = useEndpointStore((s) => s.endpoints);
  const setConversations = useChatStore((s) => s.setConversations);
  const conversations = useChatStore((s) => s.conversations);
  const removeConversation = useChatStore((s) => s.removeConversation);
  const restoreConversation = useChatStore((s) => s.restoreConversation);

  useQuery({
    queryKey: ['conversations', endpoints.map((e) => e.id)],
    queryFn: async () => {
      const agents = await fetchAllAgents(endpoints);
      const all: Conversation[] = [];
      await Promise.all(
        agents.map(async (agent) => {
          const ep = endpoints.find((e) => e.id === agent.endpoint_id);
          if (!ep) return;
          try {
            const convs = await fetchConversations(
              ep.base_url,
              ep.token,
              agent.id,
              ep.id,
              agent.name,
            );
            all.push(...convs);
          } catch {
            /* skip offline endpoints */
          }
        }),
      );
      all.sort((a, b) => b.last_message_at - a.last_message_at);
      setConversations(all);
      return all;
    },
    enabled: endpoints.length > 0,
    refetchInterval: 30_000,
  });

  const handlePress = (conv: Conversation) => {
    router.push(`/chat/${conv.id}?endpoint_id=${conv.endpoint_id}`);
  };

  const handleDelete = useCallback(
    async (id: string) => {
      const index = conversations.findIndex((c) => c.id === id);
      const conv = conversations[index];
      if (!conv) return;

      // Optimistic remove
      removeConversation(id);

      const ep = endpoints.find((e) => e.id === conv.endpoint_id);
      if (!ep) return;

      try {
        await deleteConversation(ep.base_url, ep.token, id);
      } catch {
        // Restore on failure
        restoreConversation(conv, index);
      }
    },
    [conversations, endpoints, removeConversation, restoreConversation],
  );

  return (
    <SafeAreaView style={s.safe}>
      <ChatHomeScreen
        conversations={conversations}
        onPressConversation={handlePress}
        onPressNewChat={() => {}}
        onDeleteConversation={handleDelete}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#040D04' },
});
```

- [ ] **Step 2: Run typecheck**

```bash
cd mobile && pnpm typecheck
```

Expected: no errors.

- [ ] **Step 3: Run all mobile tests**

```bash
cd mobile && pnpm test -- --watchAll=false
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add mobile/app/(tabs)/chat.tsx
git commit -m "feat(mobile): wire optimistic delete in ChatTab"
```

---

## Self-Review

**Spec coverage:**
- [x] Left-swipe shows DELETE button → Task 3 (Swipeable + renderRightActions)
- [x] No confirmation dialog → Task 3 (direct call to onDeleteConversation on press)
- [x] Optimistic update → Task 4 (removeConversation before await)
- [x] Restore on failure → Task 4 (restoreConversation in catch)
- [x] Backend DELETE endpoint → Task 1
- [x] Cascade delete messages → DB schema already has `ON DELETE CASCADE` (no code change needed)
- [x] Only one row open at a time → Task 3 (openSwipeableRef pattern)
- [x] PIP-BOY delete button style → Task 3 (deleteAction/deleteText styles)

**Placeholder scan:** None found.

**Type consistency:**
- `onDeleteConversation: (id: string) => void` — consistent across ChatHomeScreen props (Task 3) and ChatTab usage (Task 4)
- `removeConversation(id: string)` / `restoreConversation(conv: Conversation, index: number)` — defined in Task 2, used in Task 4
- `deleteConversation(base_url, token, conv_id)` — defined in Task 2, imported in Task 4
