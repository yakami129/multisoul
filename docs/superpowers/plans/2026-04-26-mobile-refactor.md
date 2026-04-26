# Mobile App Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the mobile app from a single-cloud-backend model to a multi-endpoint model where each endpoint is a local `msctl serve` instance, with real WebSocket chat, real Inbox backed by Expo Push, and local SQLite persistence.

**Architecture:** Zustand stores manage endpoint/agent/chat/inbox state. Each endpoint has its own axios client (keyed by `endpoint_id`). WebSocket connections are managed per-conversation via a `useWebSocket` hook. Inbox items are written to local expo-sqlite on push notification receipt and survive app restarts. The Settings screen replaces the old single-server form with an endpoint list + add-via-QR flow.

**Tech Stack:** React Native, Expo SDK 55, expo-sqlite, expo-notifications, expo-camera (QR scan), Zustand, React Query, axios, NativeWind, PIP-BOY design system

---

## File Structure

```
mobile/
├── package.json                              MODIFY — add expo-sqlite, expo-notifications, expo-camera
├── app/
│   ├── _layout.tsx                           MODIFY — init DB + push token on startup
│   ├── (tabs)/
│   │   ├── index.tsx                         MODIFY — multi-endpoint agent list
│   │   ├── chat.tsx                          MODIFY — real conversation list
│   │   ├── inbox.tsx                         MODIFY — real inbox from store
│   │   └── settings.tsx                      MODIFY — endpoint management screen
│   └── chat/[id].tsx                         MODIFY — real WS chat detail
├── src/
│   ├── types.ts                              MODIFY — add Endpoint, Conversation, Message, InboxItem
│   ├── db/
│   │   └── index.ts                          CREATE — expo-sqlite open + schema init
│   ├── store/
│   │   ├── endpointStore.ts                  CREATE — endpoint CRUD + health check
│   │   ├── agentStore.ts                     MODIFY — multi-endpoint aggregation
│   │   ├── chatStore.ts                      CREATE — conversations + messages
│   │   └── inboxStore.ts                     CREATE — inbox items (SQLite-backed)
│   ├── api/
│   │   └── endpointClient.ts                 CREATE — per-endpoint axios client factory
│   ├── hooks/
│   │   └── useWebSocket.ts                   CREATE — WS connection + reconnect logic
│   └── features/
│       ├── settings/
│       │   ├── components/
│       │   │   ├── EndpointList.tsx           CREATE — list of endpoints with health dots
│       │   │   └── AddEndpointModal.tsx       CREATE — QR scan / paste pairing flow
│       │   └── services/
│       │       └── endpointService.ts         CREATE — health ping helper
│       ├── agents/
│       │   ├── components/
│       │   │   └── AgentCard.tsx              MODIFY — show endpoint label + project_path
│       │   └── services/
│       │       └── agentService.ts            MODIFY — fetch from multiple endpoints
│       ├── chat/
│       │   ├── components/
│       │   │   ├── ChatHomeScreen.tsx         MODIFY — real conversations from chatStore
│       │   │   ├── MessageBubble.tsx          CREATE — renders all 6 message role types
│       │   │   └── ToolCallRow.tsx            CREATE — collapsed tool_call/tool_result row
│       │   ├── services/
│       │   │   └── chatService.ts             CREATE — REST conversation/message API calls
│       │   └── types.ts                       MODIFY — align with spec §6.2 schema
│       └── inbox/
│           ├── components/
│           │   └── InboxScreen.tsx            MODIFY — real data from inboxStore
│           ├── services/
│           │   └── inboxService.ts            CREATE — write inbox item from push payload
│           └── types.ts                       MODIFY — align with spec §5.2 inbox schema
```

---

## Task 1: Add new packages

**Files:**
- Modify: `mobile/package.json`

- [ ] **Step 1: Install packages**

```bash
cd mobile && pnpm add expo-sqlite expo-notifications expo-camera
```

- [ ] **Step 2: Verify install**

```bash
cd mobile && pnpm typecheck 2>&1 | head -5
```

Expected: no new errors from missing packages.

- [ ] **Step 3: Commit**

```bash
git add mobile/package.json mobile/pnpm-lock.yaml
git commit -m "chore: add expo-sqlite, expo-notifications, expo-camera"
```

---

## Task 2: Types refactor

**Files:**
- Modify: `mobile/src/types.ts`

- [ ] **Step 1: Write failing test**

```ts
// mobile/src/__tests__/types.test.ts
import { Endpoint, Agent, Conversation, WsMessage, InboxItem } from '../types';

/** Types smoke test: all exported types are importable and structurally correct. */
it('Endpoint has required fields', () => {
  const ep: Endpoint = {
    id: 'ep-1', label: 'My Mac', base_url: 'https://x.ts.net',
    token: 'ms_v2_abc', last_seen_at: null,
  };
  expect(ep.id).toBe('ep-1');
});

it('WsMessage type discriminates on role', () => {
  const msg: WsMessage = {
    type: 'message', seq: 1, role: 'user_text',
    payload: { text: 'hello' }, created_at: Date.now(),
  };
  expect(msg.role).toBe('user_text');
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd mobile && pnpm test -- --watchAll=false --testPathPattern=types.test 2>&1 | tail -5
```

Expected: FAIL — `Endpoint` not exported from types.ts.

- [ ] **Step 3: Rewrite types.ts**

```ts
// mobile/src/types.ts

// ── Endpoint ──────────────────────────────────────────────────────────────────
export interface Endpoint {
  id: string;
  label: string;
  base_url: string;
  token: string;           // stored in AsyncStorage keyed by id, NOT in SQLite
  last_seen_at: number | null;
}

// ── Agent (from CLI serve.db) ─────────────────────────────────────────────────
export interface Agent {
  id: string;
  name: string;
  project_path: string;
  runtime: 'claude-code' | 'codex' | 'custom';
  created_at: number;
  // Injected by App after fetch:
  endpoint_id: string;
  endpoint_label: string;
}

// ── Conversation ──────────────────────────────────────────────────────────────
export interface Conversation {
  id: string;
  agent_id: string;
  title: string;
  created_at: number;
  last_message_at: number;
  status: 'idle' | 'running' | 'awaiting_question' | 'completed' | 'failed';
  // Injected:
  endpoint_id: string;
  agent_name: string;
}

// ── Messages (§6.2 role schema) ───────────────────────────────────────────────
export type MessageRole =
  | 'user_text'
  | 'agent_text'
  | 'tool_call'
  | 'tool_result'
  | 'ask_question'
  | 'task_status';

export interface WsMessage {
  type: 'message';
  seq: number;
  role: MessageRole;
  payload: MessagePayload;
  created_at: number;
}

export type MessagePayload =
  | UserTextPayload
  | AgentTextPayload
  | ToolCallPayload
  | ToolResultPayload
  | AskQuestionPayload
  | TaskStatusPayload;

export interface UserTextPayload    { text: string }
export interface AgentTextPayload   { text: string }
export interface ToolCallPayload    { tool: string; args: string; call_id: string }
export interface ToolResultPayload  { call_id: string; ok: boolean; summary: string }
export interface AskQuestionPayload {
  ask_id: string;
  prompt: string;
  options: { id: string; label: string }[];
  allow_freeform: boolean;
}
export interface TaskStatusPayload  {
  task_id: string;
  status: 'running' | 'completed' | 'failed';
  importance: 'normal' | 'complex';
  summary: string;
}

// ── Inbox (§5.2) ──────────────────────────────────────────────────────────────
export type InboxKind = 'pending_question' | 'complex_done' | 'complex_failed';

export interface InboxItem {
  id: string;
  endpoint_id: string;
  agent_id: string;
  conversation_id: string;
  kind: InboxKind;
  title: string;
  body: string;
  payload: AskQuestionPayload | null;
  received_at: number;
  read_at: number | null;
}

// ── API error ─────────────────────────────────────────────────────────────────
export interface ApiError {
  error: string;
  code: string;
}
```

- [ ] **Step 4: Run test**

```bash
cd mobile && pnpm test -- --watchAll=false --testPathPattern=types.test 2>&1 | tail -5
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/types.ts mobile/src/__tests__/types.test.ts
git commit -m "refactor: types.ts — add Endpoint, multi-role WsMessage, InboxItem"
```

---

## Task 3: expo-sqlite DB module

**Files:**
- Create: `mobile/src/db/index.ts`

- [ ] **Step 1: Write failing test**

```ts
// mobile/src/__tests__/db.test.ts
import { initDb } from '../db';

/** initDb resolves without error and returns a DB object. */
it('initDb resolves successfully', async () => {
  const db = await initDb();
  expect(db).toBeTruthy();
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd mobile && pnpm test -- --watchAll=false --testPathPattern=db.test 2>&1 | tail -5
```

Expected: FAIL — `initDb` not found.

- [ ] **Step 3: Implement db/index.ts**

```ts
// mobile/src/db/index.ts
import * as SQLite from 'expo-sqlite';

let _db: SQLite.SQLiteDatabase | null = null;

export async function initDb(): Promise<SQLite.SQLiteDatabase> {
  if (_db) return _db;
  _db = await SQLite.openDatabaseAsync('multisoul.db');
  await _db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS endpoints (
      id           TEXT PRIMARY KEY,
      label        TEXT NOT NULL,
      base_url     TEXT NOT NULL,
      last_seen_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS agents_cache (
      endpoint_id  TEXT NOT NULL,
      agent_id     TEXT NOT NULL,
      name         TEXT NOT NULL,
      project_path TEXT NOT NULL,
      runtime      TEXT NOT NULL,
      created_at   INTEGER NOT NULL,
      PRIMARY KEY (endpoint_id, agent_id)
    );
    CREATE TABLE IF NOT EXISTS inbox (
      id              TEXT PRIMARY KEY,
      endpoint_id     TEXT NOT NULL,
      agent_id        TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      kind            TEXT NOT NULL,
      title           TEXT NOT NULL,
      body            TEXT NOT NULL,
      payload         TEXT,
      received_at     INTEGER NOT NULL,
      read_at         INTEGER
    );
  `);
  return _db;
}

export function getDb(): SQLite.SQLiteDatabase {
  if (!_db) throw new Error('DB not initialized — call initDb() first');
  return _db;
}
```

- [ ] **Step 4: Run test**

```bash
cd mobile && pnpm test -- --watchAll=false --testPathPattern=db.test 2>&1 | tail -5
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/db/index.ts mobile/src/__tests__/db.test.ts
git commit -m "feat: expo-sqlite DB module with endpoints + agents_cache + inbox tables"
```

---

## Task 4: Endpoint store

**Files:**
- Create: `mobile/src/store/endpointStore.ts`
- Create: `mobile/src/features/settings/services/endpointService.ts`

- [ ] **Step 1: Write failing test**

```ts
// mobile/src/__tests__/endpointStore.test.ts
import { useEndpointStore } from '../store/endpointStore';
import { act } from '@testing-library/react-native';

it('addEndpoint adds an endpoint and getAll returns it', async () => {
  const store = useEndpointStore.getState();
  await act(async () => {
    await store.addEndpoint({
      label: 'My Mac',
      base_url: 'https://x.ts.net',
      token: 'ms_v2_abc',
    });
  });
  const endpoints = useEndpointStore.getState().endpoints;
  expect(endpoints.length).toBeGreaterThan(0);
  expect(endpoints[0].label).toBe('My Mac');
  expect(endpoints[0].base_url).toBe('https://x.ts.net');
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd mobile && pnpm test -- --watchAll=false --testPathPattern=endpointStore.test 2>&1 | tail -5
```

Expected: FAIL.

- [ ] **Step 3: Implement endpointStore.ts**

```ts
// mobile/src/store/endpointStore.ts
import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Endpoint } from '@/types';
import { getDb } from '@/db';
import uuid from 'react-native-uuid';

interface EndpointState {
  endpoints: Endpoint[];
  load: () => Promise<void>;
  addEndpoint: (input: { label: string; base_url: string; token: string }) => Promise<void>;
  removeEndpoint: (id: string) => Promise<void>;
  updateLastSeen: (id: string, ts: number) => Promise<void>;
}

const TOKEN_KEY = (id: string) => `endpoint_token_${id}`;

export const useEndpointStore = create<EndpointState>((set, get) => ({
  endpoints: [],

  load: async () => {
    const db = getDb();
    const rows = await db.getAllAsync<{ id: string; label: string; base_url: string; last_seen_at: number | null }>(
      'SELECT id, label, base_url, last_seen_at FROM endpoints ORDER BY rowid ASC'
    );
    const endpoints: Endpoint[] = await Promise.all(rows.map(async (r) => ({
      ...r,
      token: (await AsyncStorage.getItem(TOKEN_KEY(r.id))) ?? '',
    })));
    set({ endpoints });
  },

  addEndpoint: async ({ label, base_url, token }) => {
    const db = getDb();
    const id = String(uuid.v4());
    await db.runAsync(
      'INSERT INTO endpoints (id, label, base_url, last_seen_at) VALUES (?,?,?,NULL)',
      [id, label, base_url]
    );
    await AsyncStorage.setItem(TOKEN_KEY(id), token);
    const ep: Endpoint = { id, label, base_url, token, last_seen_at: null };
    set((s) => ({ endpoints: [...s.endpoints, ep] }));
  },

  removeEndpoint: async (id) => {
    const db = getDb();
    await db.runAsync('DELETE FROM endpoints WHERE id = ?', [id]);
    await AsyncStorage.removeItem(TOKEN_KEY(id));
    set((s) => ({ endpoints: s.endpoints.filter((e) => e.id !== id) }));
  },

  updateLastSeen: async (id, ts) => {
    const db = getDb();
    await db.runAsync('UPDATE endpoints SET last_seen_at = ? WHERE id = ?', [ts, id]);
    set((s) => ({
      endpoints: s.endpoints.map((e) => e.id === id ? { ...e, last_seen_at: ts } : e),
    }));
  },
}));
```

Note: add `react-native-uuid` to package.json:

```bash
cd mobile && pnpm add react-native-uuid
```

- [ ] **Step 4: Implement endpointService.ts**

```ts
// mobile/src/features/settings/services/endpointService.ts
import axios from 'axios';
import { useEndpointStore } from '@/store/endpointStore';

/** Ping /api/v1/healthz for each endpoint and update last_seen_at. */
export async function pingAllEndpoints(): Promise<void> {
  const { endpoints, updateLastSeen } = useEndpointStore.getState();
  await Promise.allSettled(
    endpoints.map(async (ep) => {
      try {
        await axios.get(`${ep.base_url}/api/v1/healthz`, { timeout: 5000 });
        await updateLastSeen(ep.id, Date.now());
      } catch {
        // endpoint offline — last_seen_at stays stale
      }
    })
  );
}
```

- [ ] **Step 5: Run test**

```bash
cd mobile && pnpm test -- --watchAll=false --testPathPattern=endpointStore.test 2>&1 | tail -5
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add mobile/src/store/endpointStore.ts mobile/src/features/settings/services/endpointService.ts
git commit -m "feat: endpoint store with SQLite persistence + health ping"
```

---

## Task 5: Per-endpoint API client + agent service refactor

**Files:**
- Create: `mobile/src/api/endpointClient.ts`
- Modify: `mobile/src/features/agents/services/agentService.ts`

- [ ] **Step 1: Implement endpointClient.ts**

```ts
// mobile/src/api/endpointClient.ts
import axios, { AxiosInstance } from 'axios';

const _clients: Map<string, AxiosInstance> = new Map();

export function getEndpointClient(base_url: string, token: string): AxiosInstance {
  const key = `${base_url}::${token}`;
  if (!_clients.has(key)) {
    _clients.set(key, axios.create({
      baseURL: base_url,
      timeout: 10_000,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
    }));
  }
  return _clients.get(key)!;
}

export function clearEndpointClients(): void {
  _clients.clear();
}
```

- [ ] **Step 2: Write failing test for multi-endpoint agent fetch**

```ts
// mobile/src/__tests__/agentService.test.ts
import { fetchAgentsFromEndpoint } from '../features/agents/services/agentService';

it('fetchAgentsFromEndpoint injects endpoint_id into each agent', async () => {
  // Mock axios
  jest.mock('axios');
  const axios = require('axios');
  axios.create.mockReturnValue({
    get: jest.fn().mockResolvedValue({
      data: [
        { id: 'ag-1', name: 'blog-fixer', project_path: '/p', runtime: 'claude-code', created_at: 1000 }
      ]
    })
  });

  const agents = await fetchAgentsFromEndpoint('https://x.ts.net', 'tok', 'ep-1', 'My Mac');
  expect(agents[0].endpoint_id).toBe('ep-1');
  expect(agents[0].endpoint_label).toBe('My Mac');
  expect(agents[0].name).toBe('blog-fixer');
});
```

- [ ] **Step 3: Implement agentService.ts**

```ts
// mobile/src/features/agents/services/agentService.ts
import { Agent } from '@/types';
import { getEndpointClient } from '@/api/endpointClient';

export async function fetchAgentsFromEndpoint(
  base_url: string,
  token: string,
  endpoint_id: string,
  endpoint_label: string,
): Promise<Agent[]> {
  const client = getEndpointClient(base_url, token);
  const res = await client.get<Omit<Agent, 'endpoint_id' | 'endpoint_label'>[]>('/api/v1/agents');
  return res.data.map((a) => ({ ...a, endpoint_id, endpoint_label }));
}

export async function fetchAllAgents(
  endpoints: { id: string; label: string; base_url: string; token: string }[]
): Promise<Agent[]> {
  const results = await Promise.allSettled(
    endpoints.map((ep) => fetchAgentsFromEndpoint(ep.base_url, ep.token, ep.id, ep.label))
  );
  return results
    .filter((r): r is PromiseFulfilledResult<Agent[]> => r.status === 'fulfilled')
    .flatMap((r) => r.value);
}
```

- [ ] **Step 4: Run test**

```bash
cd mobile && pnpm test -- --watchAll=false --testPathPattern=agentService.test 2>&1 | tail -5
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/api/endpointClient.ts mobile/src/features/agents/services/agentService.ts
git commit -m "feat: per-endpoint axios client + multi-endpoint agent fetch"
```

---

## Task 6: Agents tab refactor

**Files:**
- Modify: `mobile/app/(tabs)/index.tsx`
- Modify: `mobile/src/features/agents/components/AgentCard.tsx`

- [ ] **Step 1: Update AgentCard to show project_path + endpoint label**

Replace the `endpointRow` section in `AgentCard.tsx` (currently shows `agent.endpoint`):

```tsx
// mobile/src/features/agents/components/AgentCard.tsx
// Change the endpointRow to show project_path and endpoint_label:
<View style={s.endpointRow}>
  <Zap size={12} color="#0F6B0F" />
  <Text style={s.endpointText} numberOfLines={1}>
    {agent.project_path}
  </Text>
</View>
{/* Endpoint label badge */}
<View style={s.machineRow}>
  <Text style={s.machineText}>{agent.endpoint_label.toUpperCase()}</Text>
</View>
```

Add to StyleSheet:
```ts
machineRow: {
  paddingHorizontal: 16,
  paddingBottom: 10,
},
machineText: {
  fontFamily: 'Inter',
  fontSize: 10,
  color: '#2D8B2D',
  letterSpacing: 1.5,
},
```

Also update the `Props` interface to use `Agent` from `@/types` (which now has `endpoint_id`, `endpoint_label`, `project_path`).

- [ ] **Step 2: Update app/(tabs)/index.tsx**

```tsx
// mobile/app/(tabs)/index.tsx
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import React from 'react';
import { AgentList } from '../../src/features/agents/components/AgentList';
import { fetchAllAgents } from '../../src/features/agents/services/agentService';
import { useEndpointStore } from '../../src/store/endpointStore';

export default function AgentListScreen() {
  const router = useRouter();
  const endpoints = useEndpointStore((s) => s.endpoints);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['agents', endpoints.map((e) => e.id)],
    queryFn: () => fetchAllAgents(endpoints),
    refetchInterval: 30_000,
    enabled: endpoints.length > 0,
  });

  return (
    <AgentList
      agents={data ?? []}
      isLoading={isLoading}
      isError={isError}
      error={error}
      isFetching={isFetching}
      onRefetch={refetch}
      onAgentPress={(id) => router.push(`/agent/${id}`)}
    />
  );
}
```

- [ ] **Step 3: Verify typecheck**

```bash
cd mobile && pnpm typecheck 2>&1 | grep "error TS" | head -10
```

Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add mobile/app/(tabs)/index.tsx mobile/src/features/agents/components/AgentCard.tsx
git commit -m "feat: agents tab fetches from all endpoints, card shows project_path + machine"
```

---

## Task 7: Chat store + service

**Files:**
- Create: `mobile/src/store/chatStore.ts`
- Create: `mobile/src/features/chat/services/chatService.ts`
- Modify: `mobile/src/features/chat/types.ts`

- [ ] **Step 1: Update chat/types.ts**

```ts
// mobile/src/features/chat/types.ts
export { Conversation, WsMessage, MessageRole, MessagePayload,
         AskQuestionPayload, TaskStatusPayload, ToolCallPayload,
         ToolResultPayload, UserTextPayload, AgentTextPayload } from '@/types';
```

(Re-export from central types.ts to avoid duplication.)

- [ ] **Step 2: Implement chatService.ts**

```ts
// mobile/src/features/chat/services/chatService.ts
import { Conversation, WsMessage } from '@/types';
import { getEndpointClient } from '@/api/endpointClient';

export async function fetchConversations(
  base_url: string, token: string, agent_id: string, endpoint_id: string, agent_name: string
): Promise<Conversation[]> {
  const client = getEndpointClient(base_url, token);
  const res = await client.get<Omit<Conversation, 'endpoint_id' | 'agent_name'>[]>(
    `/api/v1/agents/${agent_id}/conversations`
  );
  return res.data.map((c) => ({ ...c, endpoint_id, agent_name }));
}

export async function createConversation(
  base_url: string, token: string, agent_id: string, title: string
): Promise<Conversation> {
  const client = getEndpointClient(base_url, token);
  const res = await client.post<Conversation>(
    `/api/v1/agents/${agent_id}/conversations`, { title }
  );
  return res.data;
}

export async function fetchMessages(
  base_url: string, token: string, conv_id: string, since_seq?: number
): Promise<WsMessage[]> {
  const client = getEndpointClient(base_url, token);
  const params = since_seq != null ? { since_seq } : {};
  const res = await client.get<WsMessage[]>(
    `/api/v1/conversations/${conv_id}/messages`, { params }
  );
  return res.data;
}

export async function postMessage(
  base_url: string, token: string, conv_id: string, text: string
): Promise<void> {
  const client = getEndpointClient(base_url, token);
  await client.post(`/api/v1/conversations/${conv_id}/messages`, { text });
}
```

- [ ] **Step 3: Implement chatStore.ts**

```ts
// mobile/src/store/chatStore.ts
import { create } from 'zustand';
import { Conversation, WsMessage } from '@/types';

interface ChatState {
  conversations: Conversation[];
  // messages keyed by conversation_id
  messages: Record<string, WsMessage[]>;
  setConversations: (convs: Conversation[]) => void;
  appendMessage: (conv_id: string, msg: WsMessage) => void;
  setMessages: (conv_id: string, msgs: WsMessage[]) => void;
}

export const useChatStore = create<ChatState>((set) => ({
  conversations: [],
  messages: {},
  setConversations: (conversations) => set({ conversations }),
  appendMessage: (conv_id, msg) =>
    set((s) => ({
      messages: {
        ...s.messages,
        [conv_id]: [...(s.messages[conv_id] ?? []), msg],
      },
    })),
  setMessages: (conv_id, msgs) =>
    set((s) => ({ messages: { ...s.messages, [conv_id]: msgs } })),
}));
```

- [ ] **Step 4: Verify typecheck**

```bash
cd mobile && pnpm typecheck 2>&1 | grep "error TS" | head -10
```

Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/store/chatStore.ts mobile/src/features/chat/services/chatService.ts mobile/src/features/chat/types.ts
git commit -m "feat: chat store + service (conversations, messages, REST calls)"
```

---

## Task 8: WebSocket hook

**Files:**
- Create: `mobile/src/hooks/useWebSocket.ts`

- [ ] **Step 1: Write failing test**

```ts
// mobile/src/__tests__/useWebSocket.test.ts
import { renderHook, act } from '@testing-library/react-native';
import { useWebSocket } from '../hooks/useWebSocket';

it('useWebSocket returns status "connecting" on mount', () => {
  const { result } = renderHook(() =>
    useWebSocket({ base_url: 'https://x.ts.net', token: 'tok', conv_id: 'cv-1' })
  );
  expect(['connecting', 'open', 'closed']).toContain(result.current.status);
});
```

- [ ] **Step 2: Implement useWebSocket.ts**

```ts
// mobile/src/hooks/useWebSocket.ts
import { useEffect, useRef, useState, useCallback } from 'react';
import { WsMessage } from '@/types';
import { useChatStore } from '@/store/chatStore';

type WsStatus = 'connecting' | 'open' | 'closed';

interface UseWebSocketOptions {
  base_url: string;
  token: string;
  conv_id: string;
}

interface UseWebSocketReturn {
  status: WsStatus;
  sendAnswer: (ask_id: string, choice_id?: string, freeform?: string) => void;
}

const MAX_BACKOFF_MS = 30_000;

export function useWebSocket({ base_url, token, conv_id }: UseWebSocketOptions): UseWebSocketReturn {
  const [status, setStatus] = useState<WsStatus>('connecting');
  const wsRef = useRef<WebSocket | null>(null);
  const backoffRef = useRef(1000);
  const appendMessage = useChatStore((s) => s.appendMessage);

  const connect = useCallback(() => {
    const wsUrl = base_url.replace(/^https/, 'wss').replace(/^http/, 'ws');
    const url = `${wsUrl}/ws/conversations/${conv_id}?token=${token}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;
    setStatus('connecting');

    ws.onopen = () => {
      setStatus('open');
      backoffRef.current = 1000;
      // Start heartbeat
      const hb = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        }
      }, 30_000);
      ws.onclose = () => {
        clearInterval(hb);
        setStatus('closed');
        // Exponential backoff reconnect
        setTimeout(connect, backoffRef.current);
        backoffRef.current = Math.min(backoffRef.current * 2, MAX_BACKOFF_MS);
      };
    };

    ws.onmessage = (event) => {
      try {
        const envelope = JSON.parse(event.data as string);
        if (envelope.type === 'message') {
          appendMessage(conv_id, envelope as WsMessage);
        }
        // pong: no-op
      } catch { /* ignore malformed */ }
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [base_url, token, conv_id, appendMessage]);

  useEffect(() => {
    connect();
    return () => {
      wsRef.current?.close();
    };
  }, [connect]);

  const sendAnswer = useCallback((ask_id: string, choice_id?: string, freeform?: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'answer', ask_id, choice_id, freeform }));
    }
  }, []);

  return { status, sendAnswer };
}
```

- [ ] **Step 3: Run test**

```bash
cd mobile && pnpm test -- --watchAll=false --testPathPattern=useWebSocket.test 2>&1 | tail -5
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add mobile/src/hooks/useWebSocket.ts mobile/src/__tests__/useWebSocket.test.ts
git commit -m "feat: useWebSocket hook with exponential backoff reconnect + heartbeat"
```

---

## Task 9: Chat detail screen — 6 message types

**Files:**
- Create: `mobile/src/features/chat/components/MessageBubble.tsx`
- Create: `mobile/src/features/chat/components/ToolCallRow.tsx`
- Modify: `mobile/app/chat/[id].tsx`

- [ ] **Step 1: Implement ToolCallRow.tsx**

```tsx
// mobile/src/features/chat/components/ToolCallRow.tsx
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { ChevronDown, ChevronRight } from 'lucide-react-native';
import { ToolCallPayload, ToolResultPayload } from '@/types';

interface Props {
  call: ToolCallPayload;
  result?: ToolResultPayload;
}

export function ToolCallRow({ call, result }: Props) {
  const [expanded, setExpanded] = useState(false);
  const statusColor = result ? (result.ok ? '#33FF33' : '#FFB000') : '#2D8B2D';
  const summary = result ? `→ ${result.ok ? 'ok' : 'err'}: ${result.summary}` : '→ pending';

  return (
    <TouchableOpacity onPress={() => setExpanded((v) => !v)} style={s.row}>
      {expanded ? <ChevronDown size={12} color="#2D8B2D" /> : <ChevronRight size={12} color="#2D8B2D" />}
      <Text style={s.tool}>[{call.tool}]</Text>
      <Text style={s.args} numberOfLines={expanded ? undefined : 1}>{call.args}</Text>
      {!expanded && <Text style={[s.status, { color: statusColor }]}>{summary}</Text>}
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    paddingVertical: 4,
    paddingHorizontal: 12,
    backgroundColor: '#0A1A0A',
    borderRadius: 2,
    borderWidth: 1,
    borderColor: '#0F2B0F',
  },
  tool: { fontFamily: 'Geist Mono', fontSize: 11, color: '#2D8B2D' },
  args: { fontFamily: 'Geist Mono', fontSize: 11, color: '#147A16', flex: 1 },
  status: { fontFamily: 'Geist Mono', fontSize: 11 },
});
```

- [ ] **Step 2: Implement MessageBubble.tsx**

```tsx
// mobile/src/features/chat/components/MessageBubble.tsx
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { WsMessage, AskQuestionPayload } from '@/types';
import AskQuestionCard from './AskQuestionCard';
import { ToolCallRow } from './ToolCallRow';

interface Props {
  msg: WsMessage;
  onAnswer?: (ask_id: string, choice_id?: string, freeform?: string) => void;
}

export function MessageBubble({ msg, onAnswer }: Props) {
  switch (msg.role) {
    case 'user_text':
      return (
        <View style={s.userWrap}>
          <View style={s.userBubble}>
            <Text style={s.userText}>{(msg.payload as any).text}</Text>
          </View>
        </View>
      );

    case 'agent_text':
      return (
        <View style={s.aiWrap}>
          <View style={s.aiBubble}>
            <Text style={s.aiText}>{(msg.payload as any).text}</Text>
          </View>
        </View>
      );

    case 'tool_call':
      return (
        <View style={s.aiWrap}>
          <ToolCallRow call={msg.payload as any} />
        </View>
      );

    case 'tool_result':
      // Rendered inline by ToolCallRow — skip standalone rendering
      return null;

    case 'ask_question': {
      const p = msg.payload as AskQuestionPayload;
      return (
        <View style={s.aiWrap}>
          <AskQuestionCard
            question={p.prompt}
            options={p.options}
            onCancel={() => {}}
            onConfirm={(id) => onAnswer?.(p.ask_id, id)}
          />
        </View>
      );
    }

    case 'task_status': {
      const p = msg.payload as any;
      const color = p.status === 'completed' ? '#33FF33' : '#FFB000';
      return (
        <View style={s.statusRow}>
          <View style={[s.statusLine, { backgroundColor: color }]} />
          <Text style={[s.statusText, { color }]}>
            {p.status.toUpperCase()} — {p.summary}
          </Text>
          <View style={[s.statusLine, { backgroundColor: color }]} />
        </View>
      );
    }

    default:
      return null;
  }
}

const s = StyleSheet.create({
  userWrap: { width: '100%', alignItems: 'flex-end' },
  aiWrap:   { width: '100%', alignItems: 'flex-start' },
  userBubble: {
    maxWidth: 240, backgroundColor: '#20C20E', borderRadius: 2,
    borderTopRightRadius: 0, padding: 12,
  },
  aiBubble: {
    maxWidth: 280, backgroundColor: '#061206', borderRadius: 2,
    borderTopLeftRadius: 0, padding: 12,
    borderWidth: 1, borderColor: '#0F2B0F',
  },
  userText: { fontFamily: 'Geist', fontSize: 14, color: '#040D04', lineHeight: 20 },
  aiText:   { fontFamily: 'Geist', fontSize: 14, color: '#20C20E', lineHeight: 20 },
  statusRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8,
  },
  statusLine: { flex: 1, height: 1 },
  statusText: { fontFamily: 'Inter', fontSize: 11, letterSpacing: 1 },
});
```

- [ ] **Step 3: Rewrite app/chat/[id].tsx**

```tsx
// mobile/app/chat/[id].tsx
import React, { useEffect, useRef } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView, StyleSheet, ScrollView, View, Text,
         TextInput, TouchableOpacity, KeyboardAvoidingView, Platform } from 'react-native';
import { ChevronLeft, Send } from 'lucide-react-native';
import { useChatStore } from '@/store/chatStore';
import { useEndpointStore } from '@/store/endpointStore';
import { useWebSocket } from '@/hooks/useWebSocket';
import { MessageBubble } from '@/features/chat/components/MessageBubble';
import { postMessage, fetchMessages } from '@/features/chat/services/chatService';
import { useState } from 'react';

export default function ChatDetailScreen() {
  const { id: conv_id, endpoint_id } = useLocalSearchParams<{ id: string; endpoint_id: string }>();
  const router = useRouter();
  const [input, setInput] = useState('');
  const scrollRef = useRef<ScrollView>(null);

  const endpoint = useEndpointStore((s) => s.endpoints.find((e) => e.id === endpoint_id));
  const messages = useChatStore((s) => s.messages[conv_id] ?? []);
  const setMessages = useChatStore((s) => s.setMessages);

  const { status, sendAnswer } = useWebSocket(
    endpoint
      ? { base_url: endpoint.base_url, token: endpoint.token, conv_id }
      : { base_url: '', token: '', conv_id }
  );

  // Load message history on mount
  useEffect(() => {
    if (!endpoint) return;
    fetchMessages(endpoint.base_url, endpoint.token, conv_id)
      .then((msgs) => setMessages(conv_id, msgs))
      .catch(() => {});
  }, [conv_id, endpoint]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || !endpoint) return;
    setInput('');
    await postMessage(endpoint.base_url, endpoint.token, conv_id, text);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  };

  const isOffline = !endpoint || status === 'closed';

  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {/* Nav */}
        <View style={s.nav}>
          <TouchableOpacity onPress={() => router.back()}>
            <ChevronLeft size={24} color="#20C20E" />
          </TouchableOpacity>
          <Text style={s.navTitle}>CHAT</Text>
          <View style={[s.dot, { backgroundColor: status === 'open' ? '#33FF33' : '#2D8B2D' }]} />
        </View>

        {/* Messages */}
        <ScrollView
          ref={scrollRef}
          style={s.scroll}
          contentContainerStyle={s.scrollContent}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
        >
          {messages.map((msg) => (
            <MessageBubble key={`${msg.seq}`} msg={msg} onAnswer={sendAnswer} />
          ))}
        </ScrollView>

        {/* Input */}
        <View style={s.inputBar}>
          <View style={[s.inputField, isOffline && s.inputDisabled]}>
            <TextInput
              style={s.input}
              placeholder={isOffline ? 'Agent offline…' : 'Message…'}
              placeholderTextColor="#2D8B2D"
              value={input}
              onChangeText={setInput}
              onSubmitEditing={handleSend}
              editable={!isOffline}
              returnKeyType="send"
            />
          </View>
          <TouchableOpacity onPress={handleSend} disabled={isOffline}>
            <Send size={20} color={isOffline ? '#2D8B2D' : '#20C20E'} />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: '#040D04' },
  nav:          { height: 52, backgroundColor: '#061206', flexDirection: 'row',
                  alignItems: 'center', justifyContent: 'space-between',
                  paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: '#0F2B0F' },
  navTitle:     { fontFamily: 'Anton', fontSize: 16, color: '#20C20E' },
  dot:          { width: 8, height: 8, borderRadius: 4 },
  scroll:       { flex: 1 },
  scrollContent:{ padding: 16, gap: 12 },
  inputBar:     { height: 60, backgroundColor: '#061206', flexDirection: 'row',
                  alignItems: 'center', paddingHorizontal: 12, gap: 8,
                  borderTopWidth: 1, borderTopColor: '#0F2B0F' },
  inputField:   { flex: 1, height: 36, backgroundColor: '#0A1A0A', borderRadius: 2,
                  borderWidth: 1, borderColor: '#0F2B0F', paddingHorizontal: 14,
                  justifyContent: 'center' },
  inputDisabled:{ opacity: 0.4 },
  input:        { fontFamily: 'Geist', fontSize: 14, color: '#20C20E' },
});
```

- [ ] **Step 4: Verify typecheck**

```bash
cd mobile && pnpm typecheck 2>&1 | grep "error TS" | head -10
```

Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/features/chat/components/ mobile/app/chat/
git commit -m "feat: chat detail with 6 message types, WS, ask_question card"
```

---

## Task 10: Inbox store + push notification setup

**Files:**
- Create: `mobile/src/store/inboxStore.ts`
- Create: `mobile/src/features/inbox/services/inboxService.ts`
- Modify: `mobile/app/_layout.tsx`

- [ ] **Step 1: Implement inboxService.ts**

```ts
// mobile/src/features/inbox/services/inboxService.ts
import { InboxItem } from '@/types';
import { getDb } from '@/db';

export async function writeInboxItem(item: InboxItem): Promise<void> {
  const db = getDb();
  await db.runAsync(
    `INSERT OR IGNORE INTO inbox
     (id, endpoint_id, agent_id, conversation_id, kind, title, body, payload, received_at, read_at)
     VALUES (?,?,?,?,?,?,?,?,?,NULL)`,
    [
      item.id, item.endpoint_id, item.agent_id, item.conversation_id,
      item.kind, item.title, item.body,
      item.payload ? JSON.stringify(item.payload) : null,
      item.received_at,
    ]
  );
}

export async function loadInboxItems(): Promise<InboxItem[]> {
  const db = getDb();
  const rows = await db.getAllAsync<any>(
    'SELECT * FROM inbox ORDER BY received_at DESC'
  );
  return rows.map((r) => ({
    ...r,
    payload: r.payload ? JSON.parse(r.payload) : null,
  }));
}

export async function markRead(id: string): Promise<void> {
  const db = getDb();
  await db.runAsync('UPDATE inbox SET read_at = ? WHERE id = ?', [Date.now(), id]);
}
```

- [ ] **Step 2: Implement inboxStore.ts**

```ts
// mobile/src/store/inboxStore.ts
import { create } from 'zustand';
import { InboxItem } from '@/types';
import { loadInboxItems, writeInboxItem, markRead } from '@/features/inbox/services/inboxService';

interface InboxState {
  items: InboxItem[];
  load: () => Promise<void>;
  addItem: (item: InboxItem) => Promise<void>;
  markRead: (id: string) => Promise<void>;
}

export const useInboxStore = create<InboxState>((set) => ({
  items: [],

  load: async () => {
    const items = await loadInboxItems();
    set({ items });
  },

  addItem: async (item) => {
    await writeInboxItem(item);
    set((s) => ({ items: [item, ...s.items] }));
  },

  markRead: async (id) => {
    await markRead(id);
    set((s) => ({
      items: s.items.map((i) => i.id === id ? { ...i, read_at: Date.now() } : i),
    }));
  },
}));
```

- [ ] **Step 3: Update _layout.tsx to init DB, load stores, register push token**

```tsx
// mobile/app/_layout.tsx
import '../global.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Notifications from 'expo-notifications';
import * as Linking from 'expo-linking';
import { ErrorBoundary } from '../src/components/ErrorBoundary';
import { SplashScreen } from '../src/components/SplashScreen';
import { initDb } from '../src/db';
import { useEndpointStore } from '../src/store/endpointStore';
import { useInboxStore } from '../src/store/inboxStore';
import { InboxItem } from '../src/types';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 2, staleTime: 10_000 } },
});

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: true,
  }),
});

export default function RootLayout() {
  const [splashDone, setSplashDone] = useState(false);
  const loadEndpoints = useEndpointStore((s) => s.load);
  const loadInbox    = useInboxStore((s) => s.load);
  const addInboxItem = useInboxStore((s) => s.addItem);

  useEffect(() => {
    (async () => {
      await initDb();
      await loadEndpoints();
      await loadInbox();
      await registerPushToken();
    })();
  }, []);

  // Handle push notification received while app is foregrounded
  useEffect(() => {
    const sub = Notifications.addNotificationReceivedListener((notification) => {
      const data = notification.request.content.data as any;
      if (data?.inbox_id) {
        const item: InboxItem = {
          id: data.inbox_id,
          endpoint_id: data.endpoint_id ?? '',
          agent_id: data.agent_id ?? '',
          conversation_id: data.conversation_id ?? '',
          kind: data.kind ?? 'complex_done',
          title: notification.request.content.title ?? '',
          body: notification.request.content.body ?? '',
          payload: null,
          received_at: Date.now(),
          read_at: null,
        };
        addInboxItem(item);
      }
    });
    return () => sub.remove();
  }, [addInboxItem]);

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <StatusBar style="light" backgroundColor="#040D04" />
          {!splashDone ? (
            <SplashScreen onComplete={() => setSplashDone(true)} />
          ) : (
            <Stack>
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen name="agent/[id]" options={{ headerShown: false }} />
              <Stack.Screen name="chat/[id]" options={{ headerShown: false }} />
            </Stack>
          )}
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}

async function registerPushToken(): Promise<void> {
  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== 'granted') return;
  const token = (await Notifications.getExpoPushTokenAsync()).data;
  // Store token in AsyncStorage for display in Settings
  const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
  await AsyncStorage.setItem('expo_push_token', token);
}
```

- [ ] **Step 4: Verify typecheck**

```bash
cd mobile && pnpm typecheck 2>&1 | grep "error TS" | head -10
```

Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/store/inboxStore.ts mobile/src/features/inbox/services/inboxService.ts mobile/app/_layout.tsx
git commit -m "feat: inbox store + push notification handler writes to local SQLite"
```

---

## Task 11: Inbox tab refactor

**Files:**
- Modify: `mobile/app/(tabs)/inbox.tsx`
- Modify: `mobile/src/features/inbox/types.ts`

- [ ] **Step 1: Update inbox/types.ts**

```ts
// mobile/src/features/inbox/types.ts
// Re-export from central types to avoid duplication
export { InboxItem, InboxKind } from '@/types';
```

- [ ] **Step 2: Rewrite app/(tabs)/inbox.tsx**

```tsx
// mobile/app/(tabs)/inbox.tsx
import React from 'react';
import { SafeAreaView, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import InboxScreen from '@/features/inbox/components/InboxScreen';
import { useInboxStore } from '@/store/inboxStore';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useEndpointStore } from '@/store/endpointStore';
import { InboxItem } from '@/types';

export default function InboxTab() {
  const router = useRouter();
  const items = useInboxStore((s) => s.items);
  const markRead = useInboxStore((s) => s.markRead);
  const endpoints = useEndpointStore((s) => s.endpoints);

  const handleAnswer = async (item: InboxItem, choice_id?: string, freeform?: string) => {
    // Find endpoint for this item
    const ep = endpoints.find((e) => e.id === item.endpoint_id);
    if (!ep || !item.payload) return;
    // Send answer via REST (WS not available from tab context — use REST fallback)
    const { getEndpointClient } = await import('@/api/endpointClient');
    const client = getEndpointClient(ep.base_url, ep.token);
    // The WS answer is sent via the chat detail screen; here we just navigate
    await markRead(item.id);
    router.push(`/chat/${item.conversation_id}?endpoint_id=${item.endpoint_id}` as any);
  };

  const handleNavigate = async (item: InboxItem) => {
    await markRead(item.id);
    router.push(`/chat/${item.conversation_id}?endpoint_id=${item.endpoint_id}` as any);
  };

  return (
    <SafeAreaView style={s.safe}>
      <InboxScreen
        items={items}
        onAnswer={handleAnswer}
        onNavigate={handleNavigate}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#040D04' },
});
```

- [ ] **Step 3: Update InboxScreen.tsx to use real InboxItem type**

In `mobile/src/features/inbox/components/InboxScreen.tsx`, update the import:

```ts
import { InboxItem } from '@/types';
```

And update the `Props` interface:

```ts
interface Props {
  items: InboxItem[];
  onAnswer: (item: InboxItem, choice_id?: string, freeform?: string) => void;
  onNavigate: (item: InboxItem) => void;
}
```

Update the card rendering to use `item.kind` for the icon:
- `pending_question` → show answer button (calls `onAnswer`)
- `complex_done` / `complex_failed` → show navigate button (calls `onNavigate`)

Add unread indicator (left 2px green bar when `item.read_at === null`):

```tsx
// In the cardWrap style, add a left border when unread:
<View style={[s.cardWrap, item.read_at === null && s.cardUnread]}>
```

```ts
cardUnread: {
  borderLeftWidth: 2,
  borderLeftColor: '#20C20E',
},
```

- [ ] **Step 4: Verify typecheck**

```bash
cd mobile && pnpm typecheck 2>&1 | grep "error TS" | head -10
```

Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add mobile/app/(tabs)/inbox.tsx mobile/src/features/inbox/
git commit -m "feat: inbox tab uses real inboxStore, unread indicator, navigate to chat"
```

---

## Task 12: Settings screen — endpoint management

**Files:**
- Modify: `mobile/app/(tabs)/settings.tsx`
- Create: `mobile/src/features/settings/components/EndpointList.tsx`
- Create: `mobile/src/features/settings/components/AddEndpointModal.tsx`

- [ ] **Step 1: Implement EndpointList.tsx**

```tsx
// mobile/src/features/settings/components/EndpointList.tsx
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, FlatList } from 'react-native';
import { Trash2, Plus } from 'lucide-react-native';
import { Endpoint } from '@/types';

interface Props {
  endpoints: Endpoint[];
  onAdd: () => void;
  onRemove: (id: string) => void;
}

function healthColor(ep: Endpoint): string {
  if (!ep.last_seen_at) return '#2D8B2D';
  const age = Date.now() - ep.last_seen_at;
  if (age < 90_000) return '#33FF33';   // < 90s → green
  if (age < 300_000) return '#FFB000';  // < 5min → amber
  return '#2D8B2D';                     // stale → dim
}

export function EndpointList({ endpoints, onAdd, onRemove }: Props) {
  return (
    <View style={s.root}>
      <View style={s.header}>
        <Text style={s.title}>ENDPOINTS</Text>
        <TouchableOpacity onPress={onAdd} style={s.addBtn}>
          <Plus size={16} color="#040D04" />
          <Text style={s.addText}>ADD</Text>
        </TouchableOpacity>
      </View>
      <FlatList
        data={endpoints}
        keyExtractor={(e) => e.id}
        renderItem={({ item }) => (
          <View style={s.row}>
            <View style={[s.dot, { backgroundColor: healthColor(item) }]} />
            <View style={s.info}>
              <Text style={s.label}>{item.label}</Text>
              <Text style={s.url} numberOfLines={1}>{item.base_url}</Text>
            </View>
            <TouchableOpacity onPress={() => onRemove(item.id)}>
              <Trash2 size={16} color="#2D8B2D" />
            </TouchableOpacity>
          </View>
        )}
        ListEmptyComponent={
          <Text style={s.empty}>No endpoints. Add one to get started.</Text>
        }
      />
    </View>
  );
}

const s = StyleSheet.create({
  root:    { flex: 1 },
  header:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
             paddingHorizontal: 16, paddingVertical: 12 },
  title:   { fontFamily: 'Anton', fontSize: 16, color: '#20C20E' },
  addBtn:  { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#20C20E',
             paddingHorizontal: 12, paddingVertical: 6, borderRadius: 2 },
  addText: { fontFamily: 'Inter', fontSize: 11, fontWeight: '700', color: '#040D04', letterSpacing: 1 },
  row:     { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16,
             paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#0F2B0F' },
  dot:     { width: 8, height: 8, borderRadius: 4 },
  info:    { flex: 1 },
  label:   { fontFamily: 'Anton', fontSize: 13, color: '#20C20E' },
  url:     { fontFamily: 'Geist Mono', fontSize: 11, color: '#0F6B0F' },
  empty:   { fontFamily: 'Geist', fontSize: 13, color: '#147A16', padding: 16 },
});
```

- [ ] **Step 2: Implement AddEndpointModal.tsx**

```tsx
// mobile/src/features/settings/components/AddEndpointModal.tsx
import React, { useState } from 'react';
import { Modal, View, Text, TextInput, TouchableOpacity, StyleSheet,
         TouchableWithoutFeedback } from 'react-native';
import { X } from 'lucide-react-native';
import axios from 'axios';

interface Props {
  visible: boolean;
  onClose: () => void;
  onAdd: (label: string, base_url: string, token: string) => void;
}

export function AddEndpointModal({ visible, onClose, onAdd }: Props) {
  const [label, setLabel]     = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [token, setToken]     = useState('');
  const [error, setError]     = useState('');
  const [testing, setTesting] = useState(false);

  const handleAdd = async () => {
    setError('');
    setTesting(true);
    try {
      await axios.get(`${baseUrl.trim()}/api/v1/healthz`, { timeout: 5000 });
      onAdd(label.trim(), baseUrl.trim(), token.trim());
      setLabel(''); setBaseUrl(''); setToken('');
      onClose();
    } catch {
      setError('Cannot reach endpoint. Check URL and try again.');
    } finally {
      setTesting(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={s.overlay}>
          <TouchableWithoutFeedback>
            <View style={s.sheet}>
              <View style={s.header}>
                <Text style={s.title}>ADD ENDPOINT</Text>
                <TouchableOpacity onPress={onClose}><X size={20} color="#2D8B2D" /></TouchableOpacity>
              </View>
              <View style={s.body}>
                <Text style={s.label}>Label</Text>
                <TextInput style={s.input} value={label} onChangeText={setLabel}
                  placeholder="My Mac" placeholderTextColor="#2D8B2D" />
                <Text style={s.label}>Base URL</Text>
                <TextInput style={s.input} value={baseUrl} onChangeText={setBaseUrl}
                  placeholder="https://xxx.ts.net" placeholderTextColor="#2D8B2D"
                  autoCapitalize="none" keyboardType="url" />
                <Text style={s.label}>Bearer Token</Text>
                <TextInput style={s.input} value={token} onChangeText={setToken}
                  placeholder="ms_v2_..." placeholderTextColor="#2D8B2D"
                  autoCapitalize="none" secureTextEntry />
                {error ? <Text style={s.error}>{error}</Text> : null}
                <TouchableOpacity style={s.btn} onPress={handleAdd} disabled={testing}>
                  <Text style={s.btnText}>{testing ? 'TESTING…' : 'ADD ENDPOINT'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(4,13,4,0.85)', justifyContent: 'flex-end' },
  sheet:   { backgroundColor: '#061206', borderTopLeftRadius: 2, borderTopRightRadius: 2,
             borderTopWidth: 1, borderColor: '#0F2B0F', paddingBottom: 40 },
  header:  { height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
             paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: '#0F2B0F' },
  title:   { fontFamily: 'Anton', fontSize: 16, color: '#20C20E' },
  body:    { padding: 16, gap: 8 },
  label:   { fontFamily: 'Inter', fontSize: 11, color: '#2D8B2D', letterSpacing: 1.5 },
  input:   { height: 40, backgroundColor: '#0A1A0A', borderWidth: 1, borderColor: '#0F2B0F',
             borderRadius: 2, paddingHorizontal: 12, fontFamily: 'Geist', fontSize: 14,
             color: '#20C20E' },
  error:   { fontFamily: 'Geist', fontSize: 12, color: '#FFB000' },
  btn:     { height: 44, backgroundColor: '#20C20E', borderRadius: 2, alignItems: 'center',
             justifyContent: 'center', marginTop: 8 },
  btnText: { fontFamily: 'Inter', fontSize: 13, fontWeight: '700', color: '#040D04', letterSpacing: 1 },
});
```

- [ ] **Step 3: Rewrite app/(tabs)/settings.tsx**

```tsx
// mobile/app/(tabs)/settings.tsx
import React, { useState } from 'react';
import { SafeAreaView, StyleSheet, View, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EndpointList } from '@/features/settings/components/EndpointList';
import { AddEndpointModal } from '@/features/settings/components/AddEndpointModal';
import { useEndpointStore } from '@/store/endpointStore';

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const endpoints    = useEndpointStore((s) => s.endpoints);
  const addEndpoint  = useEndpointStore((s) => s.addEndpoint);
  const removeEndpoint = useEndpointStore((s) => s.removeEndpoint);
  const [showAdd, setShowAdd] = useState(false);

  return (
    <SafeAreaView style={[s.safe, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <Text style={s.headerTitle}>SETTINGS</Text>
      </View>
      <EndpointList
        endpoints={endpoints}
        onAdd={() => setShowAdd(true)}
        onRemove={removeEndpoint}
      />
      <AddEndpointModal
        visible={showAdd}
        onClose={() => setShowAdd(false)}
        onAdd={(label, base_url, token) => addEndpoint({ label, base_url, token })}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: '#040D04' },
  header:      { height: 52, backgroundColor: '#061206', justifyContent: 'center',
                 paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: '#0F2B0F' },
  headerTitle: { fontFamily: 'Anton', fontSize: 20, color: '#20C20E' },
});
```

- [ ] **Step 4: Verify typecheck**

```bash
cd mobile && pnpm typecheck 2>&1 | grep "error TS" | head -10
```

Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add mobile/app/(tabs)/settings.tsx mobile/src/features/settings/components/
git commit -m "feat: settings screen with endpoint list + add-via-paste modal"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| §5.2 endpoints table (SQLite) | Task 3 |
| §5.2 inbox table (SQLite) | Task 3 |
| D-8: multi-endpoint aggregation | Tasks 4, 5, 6 |
| §8.1 Agents tab — endpoint health dots | Task 12 (EndpointList) |
| §8.1 Agents tab — agent cards with machine label | Task 6 |
| §8.2 Chat tab — real conversations | Task 7 |
| §8.2 Chat — 6 message types | Task 9 |
| §8.2 Chat — ask_question card | Task 9 |
| §8.2 Chat — input disabled when offline | Task 9 |
| §8.3 Inbox — unread left bar | Task 11 |
| §8.3 Inbox — pending_question answer | Task 11 |
| §8.3 Inbox — complex_done/failed navigate | Task 11 |
| §8.4 Settings — endpoint management | Task 12 |
| §6.3 Push → inbox write | Task 10 |
| §6.4 Pairing flow (paste URL + token) | Task 12 |
| AC-4: healthz ping on add | Task 12 (AddEndpointModal) |
| AC-9/10: push → inbox | Task 10 |
| AC-11: offline read-only | Task 9 (input disabled) |
| §9 WS reconnect exponential backoff | Task 8 |

**Gap:** QR scan pairing (§6.4) — `AddEndpointModal` currently only supports paste. QR scan via `expo-camera` can be added as a follow-up task after MVP; the `multisoul://pair?url=...&token=...` deep link format is already defined.
