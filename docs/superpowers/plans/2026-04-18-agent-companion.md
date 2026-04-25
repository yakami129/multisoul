# Agent 随身开发助手 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a mobile-first AI agent companion — iOS app + relay backend + cc-connect platform plugin — so developers can launch tasks, watch live logs, respond to AskQuestion prompts, and capture ideas from their phone.

**Architecture:** cc-connect (existing Go bridge) gets a new `platform/mobile` plugin that connects outbound via WebSocket to a Bun relay server; the relay server forwards messages to the React Native iOS app via WebSocket and triggers APNs push notifications; the app displays streaming logs, AskQuestion cards, and an ideas module backed by Claude API.

**Tech Stack:** Go 1.22 + gorilla/websocket (cc-connect plugin) · Bun 1.x + TypeScript + ws + better-sqlite3 + @anthropic-ai/sdk + @parse/node-apn (server) · React Native 0.74 + Expo SDK 51 + React Navigation 6 + Zustand (iOS app)

---

## Project Layout

```
/Users/alan/Documents/codes/yakami0129/
├── cc-connect/                        # Existing Go project — add platform/mobile here
│   └── platform/mobile/
│       ├── mobile.go                  # Platform implementation + WebSocket client
│       └── plugin.go                  # build-tag registration
├── apps/
│   ├── server/                        # New: Bun relay server
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts               # Entry point
│   │       ├── config.ts              # Env config
│   │       ├── db/
│   │       │   ├── schema.ts          # SQLite schema (CREATE TABLE statements)
│   │       │   └── queries.ts         # Typed query helpers
│   │       ├── ws/
│   │       │   ├── server.ts          # WebSocket server setup (two listeners)
│   │       │   ├── agent-handler.ts   # Handle cc-connect platform connections
│   │       │   ├── app-handler.ts     # Handle mobile app connections
│   │       │   └── router.ts          # Route messages between agent ↔ app
│   │       ├── push/
│   │       │   └── apns.ts            # APNs push via @parse/node-apn
│   │       └── ai/
│   │           └── evaluate-idea.ts   # Claude API idea evaluation
│   │   └── tests/
│   │       ├── router.test.ts
│   │       └── evaluate-idea.test.ts
│   └── mobile/                        # New: React Native (Expo) iOS app
│       ├── package.json
│       ├── app.json
│       ├── App.tsx
│       └── src/
│           ├── theme.ts               # Colors, fonts, spacing (dark terminal style)
│           ├── navigation/
│           │   └── RootNavigator.tsx  # Bottom tab navigator (Chat|Ideas|Agent)
│           ├── ws/
│           │   └── useSocket.ts       # WebSocket hook: connect, reconnect, seq
│           ├── store/
│           │   ├── chatStore.ts       # Zustand: messages per conversation
│           │   ├── agentStore.ts      # Zustand: agent list + status
│           │   └── ideaStore.ts       # Zustand: ideas + evaluations
│           ├── screens/
│           │   ├── chat/
│           │   │   ├── ChatScreen.tsx
│           │   │   ├── MessageList.tsx
│           │   │   ├── LogBlock.tsx       # Collapsible streaming log bubble
│           │   │   ├── AskQuestionCard.tsx
│           │   │   ├── InputBar.tsx
│           │   │   └── AgentSwitchSheet.tsx
│           │   ├── ideas/
│           │   │   ├── IdeasScreen.tsx
│           │   │   └── IdeaCard.tsx
│           │   └── agents/
│           │       └── AgentsScreen.tsx
│           └── components/
│               └── PillTabBar.tsx     # Custom pill-style tab bar (matches design)
└── packages/
    └── protocol/                      # Shared TypeScript types (symlinked in both apps)
        ├── package.json
        └── src/
            └── index.ts               # All WS message union types
```

---

## WebSocket Protocol (canonical)

```typescript
// packages/protocol/src/index.ts — source of truth

// ── Agent (cc-connect) → Server ──────────────────────────────────────────────
export type AgentUpMsg =
  | { type: 'agent:register'; agentId: string; token: string; name: string; projectPath: string }
  | { type: 'agent:log';    conversationId: string; seq: number; content: string; ts: number }
  | { type: 'agent:ask';    conversationId: string; seq: number; questionId: string; question: string; options: string[] | null }
  | { type: 'agent:done';   conversationId: string; seq: number }
  | { type: 'agent:error';  conversationId: string; seq: number; message: string }
  | { type: 'agent:status'; status: 'idle' | 'running' }
  | { type: 'agent:ping' }

// ── Server → Agent ────────────────────────────────────────────────────────────
export type AgentDownMsg =
  | { type: 'cmd:send';   conversationId: string; content: string }
  | { type: 'cmd:answer'; conversationId: string; questionId: string; answer: string }
  | { type: 'pong' }

// ── App (mobile) → Server ─────────────────────────────────────────────────────
export type AppUpMsg =
  | { type: 'app:register';      deviceToken: string }
  | { type: 'app:send';          agentId: string; content: string }
  | { type: 'app:answer';        agentId: string; questionId: string; answer: string }
  | { type: 'app:switch';        agentId: string }
  | { type: 'app:history';       agentId: string; conversationId: string; since: number }
  | { type: 'app:idea:create';   content: string }
  | { type: 'app:idea:archive';  ideaId: string }
  | { type: 'app:ping' }

// ── Server → App ──────────────────────────────────────────────────────────────
export type AppDownMsg =
  | { type: 'snapshot';    agents: AgentInfo[]; ideas: IdeaInfo[] }
  | { type: 'agent:update'; agent: AgentInfo }
  | { type: 'msg';          agentId: string; conversationId: string; message: ChatMessage }
  | { type: 'history';      agentId: string; conversationId: string; messages: ChatMessage[] }
  | { type: 'idea:created'; idea: IdeaInfo }
  | { type: 'idea:evaluated'; ideaId: string; evaluation: string; priority: 'HIGH' | 'MED' | 'LOW' }
  | { type: 'pong' }

// ── Shared domain types ───────────────────────────────────────────────────────
export interface AgentInfo {
  id: string; name: string; projectPath: string
  status: 'online' | 'offline' | 'running'
  lastActiveAt: number
}

export type ChatMessage =
  | { kind: 'user_text';   id: string; seq: number; content: string; ts: number }
  | { kind: 'agent_log';   id: string; seq: number; content: string; ts: number }
  | { kind: 'ask_question'; id: string; seq: number; questionId: string; question: string; options: string[] | null; ts: number; answered?: string }
  | { kind: 'user_answer'; id: string; seq: number; questionId: string; answer: string; ts: number }

export interface IdeaInfo {
  id: string; content: string; evaluation?: string
  priority?: 'HIGH' | 'MED' | 'LOW'
  status: 'pending' | 'evaluating' | 'done' | 'archived'
  createdAt: number
}
```

---

## Task 1: Shared Protocol Package

**Files:**
- Create: `packages/protocol/package.json`
- Create: `packages/protocol/src/index.ts`
- Create: `packages/protocol/src/index.test.ts`

- [ ] **Step 1: Write the failing type test**

```typescript
// packages/protocol/src/index.test.ts
import { describe, it, expect } from 'bun:test'
import type { AgentUpMsg, ChatMessage } from './index'

describe('protocol types', () => {
  it('AgentUpMsg register discriminant works', () => {
    const msg: AgentUpMsg = {
      type: 'agent:register', agentId: 'a1', token: 'tok', name: 'my-proj', projectPath: '/src'
    }
    expect(msg.type).toBe('agent:register')
  })

  it('ChatMessage log discriminant works', () => {
    const m: ChatMessage = { kind: 'agent_log', id: '1', seq: 1, content: 'hi', ts: 0 }
    expect(m.kind).toBe('agent_log')
  })
})
```

Run: `cd packages/protocol && bun test`
Expected: FAIL — module not found

- [ ] **Step 2: Create package.json**

```json
{
  "name": "@agent-companion/protocol",
  "version": "1.0.0",
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "devDependencies": { "bun-types": "^1.0.0" }
}
```

- [ ] **Step 3: Create the types file (copy from canonical section above)**

File: `packages/protocol/src/index.ts` — paste the full canonical protocol block from the top of this document.

- [ ] **Step 4: Run and verify PASS**

Run: `cd packages/protocol && bun test`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/protocol/
git commit -m "feat: add shared WebSocket protocol types"
```

---

## Task 2: Backend — Project Setup & DB Schema

**Files:**
- Create: `apps/server/package.json`
- Create: `apps/server/tsconfig.json`
- Create: `apps/server/src/config.ts`
- Create: `apps/server/src/db/schema.ts`
- Create: `apps/server/src/db/queries.ts`
- Create: `apps/server/tests/db.test.ts`

- [ ] **Step 1: Write the failing DB test**

```typescript
// apps/server/tests/db.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { openDb, closeDb } from '../src/db/schema'
import { agentQueries, messageQueries, ideaQueries } from '../src/db/queries'
import type { Database } from 'bun:sqlite'

let db: Database
beforeEach(() => { db = openDb(':memory:') })
afterEach(() => { closeDb(db) })

describe('agentQueries', () => {
  it('upserts and retrieves an agent', () => {
    agentQueries.upsert(db, { id: 'a1', name: 'my-proj', projectPath: '/src', status: 'online', lastActiveAt: 1000 })
    const agent = agentQueries.getById(db, 'a1')
    expect(agent?.name).toBe('my-proj')
    expect(agent?.status).toBe('online')
  })

  it('lists all agents', () => {
    agentQueries.upsert(db, { id: 'a1', name: 'p1', projectPath: '/p1', status: 'online', lastActiveAt: 1 })
    agentQueries.upsert(db, { id: 'a2', name: 'p2', projectPath: '/p2', status: 'offline', lastActiveAt: 2 })
    expect(agentQueries.list(db)).toHaveLength(2)
  })
})

describe('messageQueries', () => {
  it('inserts and retrieves messages since seq', () => {
    agentQueries.upsert(db, { id: 'a1', name: 'p', projectPath: '/', status: 'online', lastActiveAt: 0 })
    messageQueries.insert(db, { id: 'm1', agentId: 'a1', conversationId: 'c1', seq: 1, kind: 'agent_log', payload: JSON.stringify({ content: 'hello' }), ts: 1000 })
    messageQueries.insert(db, { id: 'm2', agentId: 'a1', conversationId: 'c1', seq: 2, kind: 'agent_log', payload: JSON.stringify({ content: 'world' }), ts: 1001 })
    const msgs = messageQueries.since(db, 'a1', 'c1', 0)
    expect(msgs).toHaveLength(2)
    expect(msgs[0].seq).toBe(1)
  })
})

describe('ideaQueries', () => {
  it('creates and lists ideas', () => {
    ideaQueries.create(db, { id: 'i1', content: 'build X', status: 'pending', createdAt: 1000 })
    expect(ideaQueries.list(db)).toHaveLength(1)
  })

  it('updates evaluation and sets status to done', () => {
    ideaQueries.create(db, { id: 'i1', content: 'build X', status: 'pending', createdAt: 1000 })
    ideaQueries.setEvaluation(db, 'i1', '很有价值', 'HIGH')
    const idea = ideaQueries.getById(db, 'i1')
    expect(idea?.evaluation).toBe('很有价值')
    expect(idea?.priority).toBe('HIGH')
    expect(idea?.status).toBe('done')
  })
})
```

Run: `cd apps/server && bun test tests/db.test.ts`
Expected: FAIL — module not found

- [ ] **Step 2: Create package.json**

```json
{
  "name": "@agent-companion/server",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "bun run --watch src/index.ts",
    "start": "bun run src/index.ts",
    "test": "bun test"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.39.0",
    "@parse/node-apn": "^6.0.0",
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "@types/ws": "^8.5.0",
    "bun-types": "^1.0.0"
  }
}
```

- [ ] **Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ESNext", "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true, "types": ["bun-types"]
  }
}
```

- [ ] **Step 4: Create config.ts**

```typescript
// apps/server/src/config.ts
export const config = {
  agentWsPort: Number(process.env.AGENT_WS_PORT ?? 8765),
  appWsPort:   Number(process.env.APP_WS_PORT   ?? 8766),
  dbPath:      process.env.DB_PATH ?? './data/companion.db',
  agentTokens: new Set((process.env.AGENT_TOKENS ?? '').split(',').filter(Boolean)),
  apns: {
    keyId:    process.env.APNS_KEY_ID    ?? '',
    teamId:   process.env.APNS_TEAM_ID   ?? '',
    keyPath:  process.env.APNS_KEY_PATH  ?? './certs/AuthKey.p8',
    bundleId: process.env.APNS_BUNDLE_ID ?? 'com.agentcompanion.app',
    production: process.env.NODE_ENV === 'production',
  },
  anthropicKey: process.env.ANTHROPIC_API_KEY ?? '',
}
```

- [ ] **Step 5: Create DB schema**

```typescript
// apps/server/src/db/schema.ts
import { Database } from 'bun:sqlite'

export function openDb(path: string): Database {
  const db = new Database(path, { create: true })
  db.run('PRAGMA journal_mode=WAL')
  db.run('PRAGMA foreign_keys=ON')
  db.run(`CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, project_path TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'offline', last_active_at INTEGER NOT NULL DEFAULT 0
  )`)
  db.run(`CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY, agent_id TEXT NOT NULL REFERENCES agents(id),
    conversation_id TEXT NOT NULL, seq INTEGER NOT NULL,
    kind TEXT NOT NULL, payload TEXT NOT NULL, ts INTEGER NOT NULL
  )`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(agent_id, conversation_id, seq)`)
  db.run(`CREATE TABLE IF NOT EXISTS ideas (
    id TEXT PRIMARY KEY, content TEXT NOT NULL, evaluation TEXT,
    priority TEXT, status TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL
  )`)
  db.run(`CREATE TABLE IF NOT EXISTS device_tokens (
    token TEXT PRIMARY KEY, created_at INTEGER NOT NULL DEFAULT 0
  )`)
  return db
}

export function closeDb(db: Database) { db.close() }
```

- [ ] **Step 6: Create DB queries**

```typescript
// apps/server/src/db/queries.ts
import type { Database } from 'bun:sqlite'
import type { AgentInfo, IdeaInfo } from '@agent-companion/protocol'

type AgentRow = { id: string; name: string; project_path: string; status: string; last_active_at: number }

function toAgent(r: AgentRow): AgentInfo {
  return { id: r.id, name: r.name, projectPath: r.project_path, status: r.status as AgentInfo['status'], lastActiveAt: r.last_active_at }
}

export const agentQueries = {
  upsert(db: Database, a: AgentInfo) {
    db.prepare(`INSERT INTO agents(id,name,project_path,status,last_active_at) VALUES(?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, project_path=excluded.project_path,
      status=excluded.status, last_active_at=excluded.last_active_at`
    ).run(a.id, a.name, a.projectPath, a.status, a.lastActiveAt)
  },
  setStatus(db: Database, id: string, status: AgentInfo['status']) {
    db.prepare(`UPDATE agents SET status=?, last_active_at=? WHERE id=?`).run(status, Date.now(), id)
  },
  getById(db: Database, id: string): AgentInfo | null {
    const r = db.prepare(`SELECT * FROM agents WHERE id=?`).get(id) as AgentRow | null
    return r ? toAgent(r) : null
  },
  list(db: Database): AgentInfo[] {
    return (db.prepare(`SELECT * FROM agents`).all() as AgentRow[]).map(toAgent)
  },
}

export const messageQueries = {
  insert(db: Database, m: { id: string; agentId: string; conversationId: string; seq: number; kind: string; payload: string; ts: number }) {
    db.prepare(`INSERT OR IGNORE INTO messages(id,agent_id,conversation_id,seq,kind,payload,ts) VALUES(?,?,?,?,?,?,?)`)
      .run(m.id, m.agentId, m.conversationId, m.seq, m.kind, m.payload, m.ts)
  },
  since(db: Database, agentId: string, conversationId: string, sinceSeq: number) {
    return db.prepare(`SELECT * FROM messages WHERE agent_id=? AND conversation_id=? AND seq>? ORDER BY seq ASC`)
      .all(agentId, conversationId, sinceSeq) as { id: string; agent_id: string; conversation_id: string; seq: number; kind: string; payload: string; ts: number }[]
  },
  latestConversationId(db: Database, agentId: string): string | null {
    const r = db.prepare(`SELECT conversation_id FROM messages WHERE agent_id=? ORDER BY ts DESC LIMIT 1`).get(agentId) as { conversation_id: string } | null
    return r?.conversation_id ?? null
  },
}

export const ideaQueries = {
  create(db: Database, i: { id: string; content: string; status: string; createdAt: number }) {
    db.prepare(`INSERT INTO ideas(id,content,status,created_at) VALUES(?,?,?,?)`).run(i.id, i.content, i.status, i.createdAt)
  },
  setEvaluation(db: Database, id: string, evaluation: string, priority: string) {
    db.prepare(`UPDATE ideas SET evaluation=?, priority=?, status='done' WHERE id=?`).run(evaluation, priority, id)
  },
  setStatus(db: Database, id: string, status: string) {
    db.prepare(`UPDATE ideas SET status=? WHERE id=?`).run(status, id)
  },
  getById(db: Database, id: string): IdeaInfo | null {
    const r = db.prepare(`SELECT * FROM ideas WHERE id=?`).get(id) as any
    if (!r) return null
    return { id: r.id, content: r.content, evaluation: r.evaluation ?? undefined, priority: r.priority ?? undefined, status: r.status, createdAt: r.created_at }
  },
  list(db: Database): IdeaInfo[] {
    return (db.prepare(`SELECT * FROM ideas WHERE status != 'archived' ORDER BY created_at DESC`).all() as any[])
      .map(r => ({ id: r.id, content: r.content, evaluation: r.evaluation ?? undefined, priority: r.priority ?? undefined, status: r.status, createdAt: r.created_at }))
  },
}

export const deviceTokenQueries = {
  upsert(db: Database, token: string) {
    db.prepare(`INSERT OR REPLACE INTO device_tokens(token,created_at) VALUES(?,?)`).run(token, Date.now())
  },
  list(db: Database): string[] {
    return (db.prepare(`SELECT token FROM device_tokens`).all() as { token: string }[]).map(r => r.token)
  },
}
```

- [ ] **Step 7: Install deps and run tests**

```bash
cd apps/server && bun install && bun test tests/db.test.ts
```

Expected: PASS (4 tests)

- [ ] **Step 8: Commit**

```bash
git add apps/server/
git commit -m "feat: server project setup, SQLite schema and queries"
```

---

## Task 3: Backend — Message Router

**Files:**
- Create: `apps/server/src/ws/router.ts`
- Create: `apps/server/tests/router.test.ts`

The router is the pure logic layer. It receives typed messages and returns actions (send to agent, send to app, push notification). No I/O — easy to test.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/server/tests/router.test.ts
import { describe, it, expect } from 'bun:test'
import { createRouter, type RouterAction } from '../src/ws/router'
import type { AgentUpMsg, AppUpMsg } from '@agent-companion/protocol'

describe('router — agent messages', () => {
  it('agent:log → broadcasts msg to all app connections for that agent', () => {
    const router = createRouter()
    router.registerAgent('ag1', 'tok123')
    router.registerApp('app1')
    router.bindAppToAgent('app1', 'ag1')

    const msg: AgentUpMsg = { type: 'agent:log', conversationId: 'c1', seq: 1, content: 'hello', ts: 1000 }
    const actions = router.handleAgentMsg('ag1', msg)

    const sendActions = actions.filter(a => a.kind === 'send_to_app' && a.appId === 'app1')
    expect(sendActions).toHaveLength(1)
    expect(sendActions[0].kind).toBe('send_to_app')
    if (sendActions[0].kind === 'send_to_app') {
      expect(sendActions[0].payload.type).toBe('msg')
    }
  })

  it('agent:ask → stores question + broadcasts to bound apps', () => {
    const router = createRouter()
    router.registerAgent('ag1', 'tok1')
    router.registerApp('app1')
    router.bindAppToAgent('app1', 'ag1')

    const msg: AgentUpMsg = { type: 'agent:ask', conversationId: 'c1', seq: 2, questionId: 'q1', question: 'Which strategy?', options: ['Redis', 'Memory'] }
    const actions = router.handleAgentMsg('ag1', msg)

    const sendActions = actions.filter(a => a.kind === 'send_to_app')
    expect(sendActions).toHaveLength(1)
    if (sendActions[0].kind === 'send_to_app') {
      expect(sendActions[0].payload.type).toBe('msg')
    }
  })
})

describe('router — app messages', () => {
  it('app:send → forwards cmd:send to the bound agent', () => {
    const router = createRouter()
    router.registerAgent('ag1', 'tok1')
    router.registerApp('app1')
    router.bindAppToAgent('app1', 'ag1')

    const msg: AppUpMsg = { type: 'app:send', agentId: 'ag1', content: 'help me debug' }
    const actions = router.handleAppMsg('app1', msg)

    const fwd = actions.find(a => a.kind === 'send_to_agent')
    expect(fwd).toBeTruthy()
    expect(fwd?.kind).toBe('send_to_agent')
    if (fwd?.kind === 'send_to_agent') {
      expect(fwd.payload.type).toBe('cmd:send')
    }
  })

  it('app:answer → forwards cmd:answer to the bound agent', () => {
    const router = createRouter()
    router.registerAgent('ag1', 'tok1')
    router.registerApp('app1')
    router.bindAppToAgent('app1', 'ag1')

    const msg: AppUpMsg = { type: 'app:answer', agentId: 'ag1', questionId: 'q1', answer: 'Redis' }
    const actions = router.handleAppMsg('app1', msg)

    const fwd = actions.find(a => a.kind === 'send_to_agent')
    expect(fwd?.kind).toBe('send_to_agent')
    if (fwd?.kind === 'send_to_agent') {
      expect(fwd.payload.type).toBe('cmd:answer')
      if (fwd.payload.type === 'cmd:answer') {
        expect(fwd.payload.answer).toBe('Redis')
      }
    }
  })
})
```

Run: `cd apps/server && bun test tests/router.test.ts`
Expected: FAIL — module not found

- [ ] **Step 2: Implement the router**

```typescript
// apps/server/src/ws/router.ts
import type { AgentUpMsg, AgentDownMsg, AppUpMsg, AppDownMsg, ChatMessage } from '@agent-companion/protocol'

export type RouterAction =
  | { kind: 'send_to_app';   appId: string;   payload: AppDownMsg }
  | { kind: 'send_to_agent'; agentId: string; payload: AgentDownMsg }
  | { kind: 'push_notify';   agentId: string; event: 'done' | 'error'; message?: string }

interface AgentState {
  token: string
  currentConversationId: string | null
  pendingQuestion: { questionId: string; conversationId: string } | null
}

export function createRouter() {
  const agents = new Map<string, AgentState>()
  // appId → agentId it is currently watching
  const appBindings = new Map<string, string>()
  // agentId → set of appIds watching it
  const agentWatchers = new Map<string, Set<string>>()

  function getWatchers(agentId: string): string[] {
    return Array.from(agentWatchers.get(agentId) ?? [])
  }

  function broadcastToWatchers(agentId: string, payload: AppDownMsg): RouterAction[] {
    return getWatchers(agentId).map(appId => ({ kind: 'send_to_app' as const, appId, payload }))
  }

  return {
    registerAgent(agentId: string, token: string) {
      agents.set(agentId, { token, currentConversationId: null, pendingQuestion: null })
      if (!agentWatchers.has(agentId)) agentWatchers.set(agentId, new Set())
    },
    removeAgent(agentId: string) { agents.delete(agentId) },

    registerApp(appId: string) {
      if (!appBindings.has(appId)) appBindings.set(appId, '')
    },
    removeApp(appId: string) {
      const agentId = appBindings.get(appId)
      if (agentId) agentWatchers.get(agentId)?.delete(appId)
      appBindings.delete(appId)
    },

    bindAppToAgent(appId: string, agentId: string): RouterAction[] {
      const prev = appBindings.get(appId)
      if (prev) agentWatchers.get(prev)?.delete(appId)
      appBindings.set(appId, agentId)
      if (!agentWatchers.has(agentId)) agentWatchers.set(agentId, new Set())
      agentWatchers.get(agentId)!.add(appId)
      return []
    },

    handleAgentMsg(agentId: string, msg: AgentUpMsg): RouterAction[] {
      const state = agents.get(agentId)
      if (!state) return []

      if (msg.type === 'agent:ping') {
        return [{ kind: 'send_to_agent', agentId, payload: { type: 'pong' } }]
      }
      if (msg.type === 'agent:status') {
        return broadcastToWatchers(agentId, { type: 'agent:update', agent: { id: agentId, name: '', projectPath: '', status: msg.status === 'running' ? 'running' : 'online', lastActiveAt: Date.now() } })
      }
      if (msg.type === 'agent:log') {
        state.currentConversationId = msg.conversationId
        const chatMsg: ChatMessage = { kind: 'agent_log', id: `${agentId}-${msg.seq}`, seq: msg.seq, content: msg.content, ts: msg.ts }
        return broadcastToWatchers(agentId, { type: 'msg', agentId, conversationId: msg.conversationId, message: chatMsg })
      }
      if (msg.type === 'agent:ask') {
        state.currentConversationId = msg.conversationId
        state.pendingQuestion = { questionId: msg.questionId, conversationId: msg.conversationId }
        const chatMsg: ChatMessage = { kind: 'ask_question', id: `${agentId}-${msg.seq}`, seq: msg.seq, questionId: msg.questionId, question: msg.question, options: msg.options, ts: Date.now() }
        return broadcastToWatchers(agentId, { type: 'msg', agentId, conversationId: msg.conversationId, message: chatMsg })
      }
      if (msg.type === 'agent:done') {
        return [...broadcastToWatchers(agentId, { type: 'agent:update', agent: { id: agentId, name: '', projectPath: '', status: 'online', lastActiveAt: Date.now() } }),
          { kind: 'push_notify', agentId, event: 'done' }]
      }
      if (msg.type === 'agent:error') {
        return [...broadcastToWatchers(agentId, { type: 'agent:update', agent: { id: agentId, name: '', projectPath: '', status: 'online', lastActiveAt: Date.now() } }),
          { kind: 'push_notify', agentId, event: 'error', message: msg.message }]
      }
      return []
    },

    handleAppMsg(appId: string, msg: AppUpMsg): RouterAction[] {
      if (msg.type === 'app:ping') {
        return [{ kind: 'send_to_app', appId, payload: { type: 'pong' } }]
      }
      if (msg.type === 'app:switch') {
        this.bindAppToAgent(appId, msg.agentId)
        return []
      }
      if (msg.type === 'app:send') {
        const convId = agents.get(msg.agentId)?.currentConversationId ?? `conv-${Date.now()}`
        return [{ kind: 'send_to_agent', agentId: msg.agentId, payload: { type: 'cmd:send', conversationId: convId, content: msg.content } }]
      }
      if (msg.type === 'app:answer') {
        const state = agents.get(msg.agentId)
        const convId = state?.pendingQuestion?.conversationId ?? state?.currentConversationId ?? ''
        if (state?.pendingQuestion) state.pendingQuestion = null
        return [{ kind: 'send_to_agent', agentId: msg.agentId, payload: { type: 'cmd:answer', conversationId: convId, questionId: msg.questionId, answer: msg.answer } }]
      }
      return []
    },
  }
}
```

- [ ] **Step 3: Run test and verify PASS**

Run: `cd apps/server && bun test tests/router.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/ws/router.ts apps/server/tests/router.test.ts
git commit -m "feat: add stateless message router with full test coverage"
```

---

## Task 4: Backend — WebSocket Server (Agent + App Handlers)

**Files:**
- Create: `apps/server/src/ws/server.ts`
- Create: `apps/server/src/ws/agent-handler.ts`
- Create: `apps/server/src/ws/app-handler.ts`

- [ ] **Step 1: Create agent-handler.ts**

```typescript
// apps/server/src/ws/agent-handler.ts
import type { WebSocket } from 'ws'
import type { AgentUpMsg, AgentDownMsg } from '@agent-companion/protocol'
import type { RouterAction } from './router'

export interface AgentHandlerDeps {
  validateToken(token: string): boolean
  onRegister(agentId: string, name: string, projectPath: string, ws: WebSocket): void
  onDisconnect(agentId: string): void
  onMessage(agentId: string, msg: AgentUpMsg): RouterAction[]
  dispatchActions(actions: RouterAction[], ws: WebSocket): void
}

export function createAgentConnectionHandler(deps: AgentHandlerDeps) {
  return function handleAgentConnection(ws: WebSocket) {
    let agentId: string | null = null

    ws.on('message', (raw) => {
      let msg: AgentUpMsg
      try { msg = JSON.parse(raw.toString()) } catch { return }

      if (msg.type === 'agent:register') {
        if (!deps.validateToken(msg.token)) { ws.close(4001, 'Invalid token'); return }
        agentId = msg.agentId
        deps.onRegister(msg.agentId, msg.name, msg.projectPath, ws)
        return
      }
      if (!agentId) { ws.close(4002, 'Not registered'); return }
      const actions = deps.onMessage(agentId, msg)
      deps.dispatchActions(actions, ws)
    })

    ws.on('close', () => {
      if (agentId) deps.onDisconnect(agentId)
    })

    // Heartbeat: send ping every 30s, close if no pong within 10s
    let alive = true
    ws.on('pong', () => { alive = true })
    const interval = setInterval(() => {
      if (!alive) { ws.terminate(); return }
      alive = false
      ws.ping()
    }, 30_000)
    ws.on('close', () => clearInterval(interval))
  }
}

export function send(ws: WebSocket, msg: AgentDownMsg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg))
}
```

- [ ] **Step 2: Create app-handler.ts**

```typescript
// apps/server/src/ws/app-handler.ts
import type { WebSocket } from 'ws'
import type { AppUpMsg, AppDownMsg, AgentInfo, IdeaInfo } from '@agent-companion/protocol'
import type { RouterAction } from './router'

export interface AppHandlerDeps {
  getSnapshot(): { agents: AgentInfo[]; ideas: IdeaInfo[] }
  onRegister(appId: string, deviceToken: string, ws: WebSocket): void
  onDisconnect(appId: string): void
  onMessage(appId: string, msg: AppUpMsg): RouterAction[]
  dispatchActions(actions: RouterAction[], ws: WebSocket): void
}

let appCounter = 0

export function createAppConnectionHandler(deps: AppHandlerDeps) {
  return function handleAppConnection(ws: WebSocket) {
    const appId = `app-${++appCounter}`
    let registered = false

    ws.on('message', (raw) => {
      let msg: AppUpMsg
      try { msg = JSON.parse(raw.toString()) } catch { return }

      if (msg.type === 'app:register') {
        registered = true
        deps.onRegister(appId, msg.deviceToken, ws)
        const snapshot = deps.getSnapshot()
        send(ws, { type: 'snapshot', agents: snapshot.agents, ideas: snapshot.ideas })
        return
      }
      if (!registered) return
      const actions = deps.onMessage(appId, msg)
      deps.dispatchActions(actions, ws)
    })

    ws.on('close', () => deps.onDisconnect(appId))

    let alive = true
    ws.on('pong', () => { alive = true })
    const interval = setInterval(() => {
      if (!alive) { ws.terminate(); return }
      alive = false
      ws.ping()
    }, 30_000)
    ws.on('close', () => clearInterval(interval))
  }
}

export function send(ws: WebSocket, msg: AppDownMsg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg))
}
```

- [ ] **Step 3: Create server.ts (wires everything)**

```typescript
// apps/server/src/ws/server.ts
import { WebSocketServer, WebSocket } from 'ws'
import type { Database } from 'bun:sqlite'
import { createRouter, type RouterAction } from './router'
import { createAgentConnectionHandler, send as sendAgent } from './agent-handler'
import { createAppConnectionHandler, send as sendApp } from './app-handler'
import { agentQueries, messageQueries, ideaQueries, deviceTokenQueries } from '../db/queries'
import { pushTaskDone, pushTaskError } from '../push/apns'
import type { AgentInfo, AppDownMsg } from '@agent-companion/protocol'
import { config } from '../config'

export function startWebSocketServers(db: Database) {
  const router = createRouter()
  // Map agentId → WebSocket connection
  const agentConns = new Map<string, WebSocket>()
  // Map appId → WebSocket connection
  const appConns = new Map<string, WebSocket>()

  function dispatchActions(actions: RouterAction[], sourceWs: WebSocket) {
    for (const action of actions) {
      if (action.kind === 'send_to_agent') {
        const ws = agentConns.get(action.agentId)
        if (ws) sendAgent(ws, action.payload)
      } else if (action.kind === 'send_to_app') {
        const ws = appConns.get(action.appId)
        if (ws) sendApp(ws, action.payload)
      } else if (action.kind === 'push_notify') {
        const tokens = deviceTokenQueries.list(db)
        const agent = agentQueries.getById(db, action.agentId)
        const title = action.event === 'done'
          ? `✓ ${agent?.name ?? action.agentId} 完成`
          : `✗ ${agent?.name ?? action.agentId} 出错`
        if (action.event === 'done') {
          tokens.forEach(t => pushTaskDone(t, title))
        } else {
          tokens.forEach(t => pushTaskError(t, title, action.message ?? ''))
        }
      }
    }
  }

  // ── Agent WebSocket server ────────────────────────────────────────────────
  const agentWss = new WebSocketServer({ port: config.agentWsPort })
  const agentHandler = createAgentConnectionHandler({
    validateToken: (token) => config.agentTokens.size === 0 || config.agentTokens.has(token),
    onRegister(agentId, name, projectPath, ws) {
      agentConns.set(agentId, ws)
      agentQueries.upsert(db, { id: agentId, name, projectPath, status: 'online', lastActiveAt: Date.now() })
      router.registerAgent(agentId, '')
      // Notify all apps
      const agent = agentQueries.getById(db, agentId)!
      broadcastToApps({ type: 'agent:update', agent })
    },
    onDisconnect(agentId) {
      agentConns.delete(agentId)
      agentQueries.setStatus(db, agentId, 'offline')
      router.removeAgent(agentId)
      const agent = agentQueries.getById(db, agentId)
      if (agent) broadcastToApps({ type: 'agent:update', agent })
    },
    onMessage(agentId, msg) {
      // Persist log/ask messages
      if (msg.type === 'agent:log') {
        messageQueries.insert(db, { id: `${agentId}-${msg.seq}`, agentId, conversationId: msg.conversationId, seq: msg.seq, kind: 'agent_log', payload: JSON.stringify({ content: msg.content }), ts: msg.ts })
      } else if (msg.type === 'agent:ask') {
        messageQueries.insert(db, { id: `${agentId}-${msg.seq}`, agentId, conversationId: msg.conversationId, seq: msg.seq, kind: 'ask_question', payload: JSON.stringify({ questionId: msg.questionId, question: msg.question, options: msg.options }), ts: Date.now() })
      }
      return router.handleAgentMsg(agentId, msg)
    },
    dispatchActions,
  })
  agentWss.on('connection', agentHandler)

  // ── App WebSocket server ──────────────────────────────────────────────────
  const appWss = new WebSocketServer({ port: config.appWsPort })
  const appHandler = createAppConnectionHandler({
    getSnapshot: () => ({ agents: agentQueries.list(db), ideas: ideaQueries.list(db) }),
    onRegister(appId, deviceToken, ws) {
      appConns.set(appId, ws)
      router.registerApp(appId)
      if (deviceToken) deviceTokenQueries.upsert(db, deviceToken)
    },
    onDisconnect(appId) {
      appConns.delete(appId)
      router.removeApp(appId)
    },
    onMessage(appId, msg) {
      if (msg.type === 'app:idea:create') {
        const id = crypto.randomUUID()
        ideaQueries.create(db, { id, content: msg.content, status: 'evaluating', createdAt: Date.now() })
        const ws = appConns.get(appId)
        const idea = { id, content: msg.content, status: 'evaluating' as const, createdAt: Date.now() }
        if (ws) sendApp(ws, { type: 'idea:created', idea })
        // Fire-and-forget evaluation
        import('../ai/evaluate-idea').then(({ evaluateIdea }) =>
          evaluateIdea(msg.content).then(({ evaluation, priority }) => {
            ideaQueries.setEvaluation(db, id, evaluation, priority)
            broadcastToApps({ type: 'idea:evaluated', ideaId: id, evaluation, priority })
          })
        )
        return []
      }
      if (msg.type === 'app:idea:archive') {
        ideaQueries.setStatus(db, msg.ideaId, 'archived')
        return []
      }
      if (msg.type === 'app:history') {
        const rows = messageQueries.since(db, msg.agentId, msg.conversationId, msg.since)
        const messages = rows.map(r => ({ ...JSON.parse(r.payload), kind: r.kind, id: r.id, seq: r.seq, ts: r.ts }) as any)
        const ws = appConns.get(appId)
        if (ws) sendApp(ws, { type: 'history', agentId: msg.agentId, conversationId: msg.conversationId, messages })
        return []
      }
      return router.handleAppMsg(appId, msg)
    },
    dispatchActions,
  })
  appWss.on('connection', appHandler)

  function broadcastToApps(msg: AppDownMsg) {
    for (const ws of appConns.values()) sendApp(ws, msg)
  }

  console.log(`Agent WS listening on :${config.agentWsPort}`)
  console.log(`App    WS listening on :${config.appWsPort}`)
  return { agentWss, appWss }
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/ws/
git commit -m "feat: WebSocket agent and app connection handlers"
```

---

## Task 5: Backend — APNs Push + Idea Evaluation + Entry Point

**Files:**
- Create: `apps/server/src/push/apns.ts`
- Create: `apps/server/src/ai/evaluate-idea.ts`
- Create: `apps/server/src/index.ts`
- Create: `apps/server/tests/evaluate-idea.test.ts`

- [ ] **Step 1: Write failing evaluate-idea test**

```typescript
// apps/server/tests/evaluate-idea.test.ts
import { describe, it, expect, mock } from 'bun:test'

// Mock Anthropic SDK before importing the module
const mockCreate = mock(async () => ({
  content: [{ type: 'text', text: JSON.stringify({ evaluation: '有较高价值', priority: 'HIGH' }) }]
}))
mock.module('@anthropic-ai/sdk', () => ({
  default: class { messages = { create: mockCreate } }
}))

const { evaluateIdea } = await import('../src/ai/evaluate-idea')

describe('evaluateIdea', () => {
  it('returns evaluation and priority from Claude', async () => {
    const result = await evaluateIdea('Build a mobile coding agent companion')
    expect(result.evaluation).toBe('有较高价值')
    expect(result.priority).toBe('HIGH')
  })
})
```

Run: `cd apps/server && bun test tests/evaluate-idea.test.ts`
Expected: FAIL — module not found

- [ ] **Step 2: Create apns.ts**

```typescript
// apps/server/src/push/apns.ts
import apn from '@parse/node-apn'
import { config } from '../config'

let provider: apn.Provider | null = null

function getProvider(): apn.Provider {
  if (!provider) {
    provider = new apn.Provider({
      token: { key: config.apns.keyPath, keyId: config.apns.keyId, teamId: config.apns.teamId },
      production: config.apns.production,
    })
  }
  return provider
}

function sendNotification(deviceToken: string, title: string, body: string) {
  const note = new apn.Notification()
  note.expiry = Math.floor(Date.now() / 1000) + 3600
  note.badge = 1
  note.sound = 'default'
  note.alert = { title, body }
  note.topic = config.apns.bundleId
  getProvider().send(note, deviceToken).catch(err => console.error('APNs error:', err))
}

export function pushTaskDone(deviceToken: string, agentName: string) {
  sendNotification(deviceToken, `${agentName} 完成`, '任务已执行完毕，点击查看日志')
}

export function pushTaskError(deviceToken: string, agentName: string, errorMsg: string) {
  sendNotification(deviceToken, `${agentName} 出错`, errorMsg || '任务执行出错，点击查看详情')
}
```

- [ ] **Step 3: Create evaluate-idea.ts**

```typescript
// apps/server/src/ai/evaluate-idea.ts
import Anthropic from '@anthropic-ai/sdk'
import { config } from '../config'

const client = new Anthropic({ apiKey: config.anthropicKey })

const SYSTEM = `你是一个产品价值评估助手。用户会给你一个产品/功能点子，你需要快速判断其价值。
返回严格的JSON格式：{"evaluation": "一句话价值判断(中文)", "priority": "HIGH|MED|LOW"}
HIGH = 有明确需求、容易实现、价值高；MED = 有一定价值但不紧迫；LOW = 价值存疑或过于复杂。`

export async function evaluateIdea(content: string): Promise<{ evaluation: string; priority: 'HIGH' | 'MED' | 'LOW' }> {
  const resp = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 200,
    system: SYSTEM,
    messages: [{ role: 'user', content }],
  })
  const text = resp.content.find(b => b.type === 'text')?.text ?? '{}'
  try {
    const parsed = JSON.parse(text)
    return { evaluation: String(parsed.evaluation ?? ''), priority: parsed.priority ?? 'MED' }
  } catch {
    return { evaluation: text.slice(0, 100), priority: 'MED' }
  }
}
```

- [ ] **Step 4: Create entry point**

```typescript
// apps/server/src/index.ts
import { openDb } from './db/schema'
import { startWebSocketServers } from './ws/server'
import { config } from './config'
import { mkdirSync } from 'fs'

// Ensure data directory exists
try { mkdirSync('./data', { recursive: true }) } catch {}

const db = openDb(config.dbPath)
startWebSocketServers(db)

console.log('Agent Companion server started')
console.log(`  Agent WS → ws://localhost:${config.agentWsPort}`)
console.log(`  App WS   → ws://localhost:${config.appWsPort}`)
```

- [ ] **Step 5: Run evaluate-idea test**

Run: `cd apps/server && bun test tests/evaluate-idea.test.ts`
Expected: PASS (1 test)

- [ ] **Step 6: Smoke test the server**

```bash
cd apps/server && bun run src/index.ts
```

Expected: Server starts, logs both WS ports, no crash

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/push/ apps/server/src/ai/ apps/server/src/index.ts apps/server/tests/evaluate-idea.test.ts
git commit -m "feat: APNs push, Claude idea evaluation, server entry point"
```

---

## Task 6: cc-connect — platform/mobile Plugin (Go)

**Files:**
- Create: `cc-connect/platform/mobile/mobile.go`
- Create: `cc-connect/platform/mobile/plugin.go`

This implements `core.Platform` and connects **outbound** to the relay server via WebSocket. cc-connect already has gorilla/websocket in go.mod (used by the Wecom platform).

- [ ] **Step 1: Check go.mod for gorilla/websocket**

```bash
grep "gorilla/websocket" cc-connect/go.mod
```

Expected: a line like `github.com/gorilla/websocket v1.5.x`
If absent: `cd cc-connect && go get github.com/gorilla/websocket`

- [ ] **Step 2: Create mobile.go**

```go
// cc-connect/platform/mobile/mobile.go
package mobile

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/anthropics/cc-connect/core"
)

// Platform connects cc-connect outbound to the Agent Companion relay server.
// It registers itself as a platform named "mobile".
type Platform struct {
	serverURL  string // e.g. "ws://relay.example.com:8765"
	agentID    string
	agentName  string
	token      string
	projectPath string

	conn      *websocket.Conn
	mu        sync.Mutex
	handler   core.MessageHandler
	stopCh    chan struct{}
}

// AgentUpMsg types we send to the relay server
type agentRegisterMsg struct {
	Type        string `json:"type"`
	AgentID     string `json:"agentId"`
	Token       string `json:"token"`
	Name        string `json:"name"`
	ProjectPath string `json:"projectPath"`
}

type agentLogMsg struct {
	Type           string `json:"type"`
	ConversationID string `json:"conversationId"`
	Seq            int64  `json:"seq"`
	Content        string `json:"content"`
	Ts             int64  `json:"ts"`
}

type agentStatusMsg struct {
	Type   string `json:"type"`
	Status string `json:"status"`
}

type agentPingMsg struct {
	Type string `json:"type"`
}

// AgentDownMsg types we receive from the relay server
type serverMsg struct {
	Type           string `json:"type"`
	ConversationID string `json:"conversationId,omitempty"`
	Content        string `json:"content,omitempty"`
	QuestionID     string `json:"questionId,omitempty"`
	Answer         string `json:"answer,omitempty"`
}

func New(opts map[string]any) (core.Platform, error) {
	get := func(k string) string {
		if v, ok := opts[k]; ok {
			if s, ok := v.(string); ok { return s }
		}
		return ""
	}
	url := get("server_url")
	if url == "" { url = "ws://localhost:8765" }
	return &Platform{
		serverURL:   url,
		agentID:     get("agent_id"),
		agentName:   get("name"),
		token:       get("token"),
		projectPath: get("project_path"),
		stopCh:      make(chan struct{}),
	}, nil
}

func (p *Platform) Name() string { return "mobile" }

func (p *Platform) Start(handler core.MessageHandler) error {
	p.handler = handler
	go p.connectLoop()
	return nil
}

func (p *Platform) connectLoop() {
	backoff := 2 * time.Second
	for {
		select {
		case <-p.stopCh:
			return
		default:
		}
		conn, _, err := websocket.DefaultDialer.Dial(p.serverURL, nil)
		if err != nil {
			slog.Warn("mobile: connection failed, retrying", "error", err, "backoff", backoff)
			time.Sleep(backoff)
			if backoff < 60*time.Second { backoff *= 2 }
			continue
		}
		backoff = 2 * time.Second
		p.mu.Lock()
		p.conn = conn
		p.mu.Unlock()

		// Register
		p.send(agentRegisterMsg{Type: "agent:register", AgentID: p.agentID, Token: p.token, Name: p.agentName, ProjectPath: p.projectPath})
		slog.Info("mobile: connected to relay server", "url", p.serverURL)

		p.readLoop(conn)
		p.mu.Lock()
		p.conn = nil
		p.mu.Unlock()
	}
}

func (p *Platform) readLoop(conn *websocket.Conn) {
	for {
		_, raw, err := conn.ReadMessage()
		if err != nil {
			slog.Warn("mobile: connection closed", "error", err)
			return
		}
		var msg serverMsg
		if err := json.Unmarshal(raw, &msg); err != nil { continue }

		switch msg.Type {
		case "cmd:send":
			if p.handler != nil {
				ctx := &replyCtx{platform: p, conversationID: msg.ConversationID}
				p.handler(ctx, msg.Content)
			}
		case "cmd:answer":
			// The agent session handles permission responses separately.
			// We emit it as a regular message so cc-connect engine can route it.
			if p.handler != nil {
				ctx := &replyCtx{platform: p, conversationID: msg.ConversationID}
				p.handler(ctx, msg.Answer)
			}
		case "pong":
			// heartbeat response, ignore
		}
	}
}

func (p *Platform) send(v any) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.conn == nil { return }
	data, _ := json.Marshal(v)
	p.conn.WriteMessage(websocket.TextMessage, data)
}

var seqCounter int64
var seqMu sync.Mutex

func nextSeq() int64 {
	seqMu.Lock()
	defer seqMu.Unlock()
	seqCounter++
	return seqCounter
}

// Reply sends agent output (plain text / log line) to the relay server.
func (p *Platform) Reply(ctx context.Context, replyCtx any, content string) error {
	rc, ok := replyCtx.(*replyCtx)
	if !ok { return fmt.Errorf("mobile: unexpected reply context type") }
	p.send(agentLogMsg{
		Type:           "agent:log",
		ConversationID: rc.conversationID,
		Seq:            nextSeq(),
		Content:        content,
		Ts:             time.Now().UnixMilli(),
	})
	return nil
}

// Send is identical to Reply for this platform.
func (p *Platform) Send(ctx context.Context, replyCtx any, content string) error {
	return p.Reply(ctx, replyCtx, content)
}

func (p *Platform) Stop() error {
	close(p.stopCh)
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.conn != nil { p.conn.Close() }
	return nil
}

// replyCtx carries the conversationId so Reply knows which conversation to log to.
type replyCtx struct {
	platform       *Platform
	conversationID string
}
```

- [ ] **Step 3: Create plugin.go (build-tag registration)**

```go
// cc-connect/platform/mobile/plugin.go
//go:build !no_mobile

package mobile

import "github.com/anthropics/cc-connect/core"

func init() {
	core.RegisterPlatform("mobile", func(opts map[string]any) (core.Platform, error) {
		return New(opts)
	})
}
```

- [ ] **Step 4: Create plugin import file**

```go
// cc-connect/cmd/cc-connect/plugin_platform_mobile.go
//go:build !no_mobile

package main

import _ "github.com/anthropics/cc-connect/platform/mobile"
```

- [ ] **Step 5: Build cc-connect and verify no errors**

```bash
cd cc-connect && go build ./...
```

Expected: builds cleanly with no errors

- [ ] **Step 6: Add config example comment to config.example.toml**

Find the `[platform]` section in `config.example.toml` and add:

```toml
# Mobile platform — connects to Agent Companion relay server
# [platform.mobile]
# server_url   = "ws://localhost:8765"
# agent_id     = "my-macbook-project"
# name         = "my-project"
# token        = "your-secret-token"
# project_path = "/Users/you/projects/my-project"
```

- [ ] **Step 7: Commit**

```bash
git add cc-connect/platform/mobile/ cc-connect/cmd/cc-connect/plugin_platform_mobile.go
git commit -m "feat: add cc-connect mobile platform plugin for relay server"
```

---

## Task 7: Mobile App — Expo Project Setup & Theme

**Files:**
- Create: `apps/mobile/` (Expo project)
- Create: `apps/mobile/src/theme.ts`

- [ ] **Step 1: Bootstrap Expo project**

```bash
cd apps && npx create-expo-app mobile --template blank-typescript
cd mobile && npx expo install expo-notifications @react-native-async-storage/async-storage
bun add @react-navigation/native @react-navigation/bottom-tabs react-native-screens react-native-safe-area-context zustand
```

- [ ] **Step 2: Write failing theme test**

```typescript
// apps/mobile/src/theme.test.ts
import { describe, it, expect } from '@jest/globals'
import { colors, spacing, fonts } from './theme'

describe('theme', () => {
  it('has dark background color', () => {
    expect(colors.bg).toBe('#000000')
  })
  it('has card surface color', () => {
    expect(colors.surface).toBe('#1C1C1E')
  })
  it('has monospace font family', () => {
    expect(fonts.mono).toContain('Mono')
  })
})
```

Run: `cd apps/mobile && bun test src/theme.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Create theme.ts (matching Pencil design)**

```typescript
// apps/mobile/src/theme.ts
// Colors extracted directly from the Pencil design:
// bg #000000, surface #1C1C1E, border #2C2C2E, muted #8E8E93, white #FFFFFF

export const colors = {
  bg:        '#000000',
  surface:   '#1C1C1E',
  border:    '#2C2C2E',
  muted:     '#8E8E93',
  white:     '#FFFFFF',
  // Priority labels (from Ideas screen)
  high:      '#FF453A',
  med:       '#FF9F0A',
  low:       '#30D158',
  // Status indicator
  running:   '#30D158',
  online:    '#636366',
  offline:   '#3A3A3C',
}

export const fonts = {
  mono:  'Courier New',   // fallback — replace with JetBrainsMono once loaded
  sans:  'System',
}

export const spacing = {
  xs: 4, sm: 8, md: 14, lg: 16, xl: 20, xxl: 24,
}

export const radius = {
  sm: 8, md: 10, lg: 14, xl: 22, pill: 36,
}

export const text = {
  label:   { fontSize: 12, fontFamily: fonts.mono, color: colors.muted },
  body:    { fontSize: 14, fontFamily: fonts.mono, color: colors.white },
  caption: { fontSize: 12, fontFamily: fonts.mono, color: colors.muted },
  mono:    { fontFamily: fonts.mono },
}
```

- [ ] **Step 4: Run test and verify PASS**

Run: `cd apps/mobile && bun test src/theme.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/
git commit -m "feat: bootstrap Expo mobile app with dark terminal theme"
```

---

## Task 8: Mobile App — WebSocket Hook (useSocket)

**Files:**
- Create: `apps/mobile/src/ws/useSocket.ts`
- Create: `apps/mobile/src/ws/useSocket.test.ts`

The hook manages connection, auto-reconnect, heartbeat, and dispatches typed messages to the store.

- [ ] **Step 1: Write failing test**

```typescript
// apps/mobile/src/ws/useSocket.test.ts
import { describe, it, expect, jest } from '@jest/globals'
import { parseServerMsg } from './useSocket'

describe('parseServerMsg', () => {
  it('parses agent:update message', () => {
    const raw = JSON.stringify({ type: 'agent:update', agent: { id: 'a1', name: 'p', projectPath: '/', status: 'running', lastActiveAt: 0 } })
    const msg = parseServerMsg(raw)
    expect(msg?.type).toBe('agent:update')
  })

  it('returns null for invalid JSON', () => {
    expect(parseServerMsg('not json')).toBeNull()
  })
})
```

Run: `cd apps/mobile && bun test src/ws/useSocket.test.ts`
Expected: FAIL — module not found

- [ ] **Step 2: Create useSocket.ts**

```typescript
// apps/mobile/src/ws/useSocket.ts
import { useEffect, useRef, useCallback } from 'react'
import type { AppUpMsg, AppDownMsg } from '@agent-companion/protocol'

// Pure helper — easy to unit test
export function parseServerMsg(raw: string): AppDownMsg | null {
  try { return JSON.parse(raw) as AppDownMsg } catch { return null }
}

interface UseSocketOptions {
  url: string
  deviceToken: string
  onMessage: (msg: AppDownMsg) => void
}

export function useSocket({ url, deviceToken, onMessage }: UseSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isMounted = useRef(true)
  const onMessageRef = useRef(onMessage)
  onMessageRef.current = onMessage

  const connect = useCallback(() => {
    if (!isMounted.current) return
    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onopen = () => {
      // Register with device token
      const reg: AppUpMsg = { type: 'app:register', deviceToken }
      ws.send(JSON.stringify(reg))
      // Start heartbeat: ping every 25s
      const ping = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'app:ping' } satisfies AppUpMsg))
      }, 25_000)
      ws.addEventListener('close', () => clearInterval(ping))
    }

    ws.onmessage = (e) => {
      const msg = parseServerMsg(e.data)
      if (msg) onMessageRef.current(msg)
    }

    ws.onclose = () => {
      if (!isMounted.current) return
      reconnectTimer.current = setTimeout(connect, 3_000)
    }

    ws.onerror = () => ws.close()
  }, [url, deviceToken])

  useEffect(() => {
    isMounted.current = true
    connect()
    return () => {
      isMounted.current = false
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
      wsRef.current?.close()
    }
  }, [connect])

  const send = useCallback((msg: AppUpMsg) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg))
    }
  }, [])

  return { send }
}
```

- [ ] **Step 3: Run test and verify PASS**

Run: `cd apps/mobile && bun test src/ws/useSocket.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/ws/
git commit -m "feat: WebSocket hook with auto-reconnect and heartbeat"
```

---

## Task 9: Mobile App — Zustand Stores

**Files:**
- Create: `apps/mobile/src/store/agentStore.ts`
- Create: `apps/mobile/src/store/chatStore.ts`
- Create: `apps/mobile/src/store/ideaStore.ts`

- [ ] **Step 1: Create agentStore.ts**

```typescript
// apps/mobile/src/store/agentStore.ts
import { create } from 'zustand'
import type { AgentInfo } from '@agent-companion/protocol'

interface AgentState {
  agents: AgentInfo[]
  activeAgentId: string | null
  setAgents: (agents: AgentInfo[]) => void
  updateAgent: (agent: AgentInfo) => void
  setActiveAgent: (id: string) => void
}

export const useAgentStore = create<AgentState>((set) => ({
  agents: [],
  activeAgentId: null,
  setAgents: (agents) => set({ agents }),
  updateAgent: (agent) =>
    set((s) => ({ agents: s.agents.map(a => a.id === agent.id ? agent : a).concat(s.agents.find(a => a.id === agent.id) ? [] : [agent]) })),
  setActiveAgent: (id) => set({ activeAgentId: id }),
}))
```

- [ ] **Step 2: Create chatStore.ts**

```typescript
// apps/mobile/src/store/chatStore.ts
import { create } from 'zustand'
import type { ChatMessage } from '@agent-companion/protocol'

interface ConversationState {
  // agentId → messages[]
  messages: Record<string, ChatMessage[]>
  activeConversationId: Record<string, string>  // agentId → conversationId
  appendMessage: (agentId: string, conversationId: string, msg: ChatMessage) => void
  setHistory: (agentId: string, conversationId: string, msgs: ChatMessage[]) => void
}

export const useChatStore = create<ConversationState>((set) => ({
  messages: {},
  activeConversationId: {},
  appendMessage: (agentId, conversationId, msg) =>
    set((s) => {
      const existing = s.messages[agentId] ?? []
      // Deduplicate by seq
      if (existing.some(m => m.seq === msg.seq)) return s
      return {
        messages: { ...s.messages, [agentId]: [...existing, msg] },
        activeConversationId: { ...s.activeConversationId, [agentId]: conversationId },
      }
    }),
  setHistory: (agentId, conversationId, msgs) =>
    set((s) => ({
      messages: { ...s.messages, [agentId]: msgs },
      activeConversationId: { ...s.activeConversationId, [agentId]: conversationId },
    })),
}))
```

- [ ] **Step 3: Create ideaStore.ts**

```typescript
// apps/mobile/src/store/ideaStore.ts
import { create } from 'zustand'
import type { IdeaInfo } from '@agent-companion/protocol'

interface IdeaState {
  ideas: IdeaInfo[]
  setIdeas: (ideas: IdeaInfo[]) => void
  addIdea: (idea: IdeaInfo) => void
  updateEvaluation: (ideaId: string, evaluation: string, priority: IdeaInfo['priority']) => void
  archiveIdea: (ideaId: string) => void
}

export const useIdeaStore = create<IdeaState>((set) => ({
  ideas: [],
  setIdeas: (ideas) => set({ ideas }),
  addIdea: (idea) => set((s) => ({ ideas: [idea, ...s.ideas] })),
  updateEvaluation: (ideaId, evaluation, priority) =>
    set((s) => ({ ideas: s.ideas.map(i => i.id === ideaId ? { ...i, evaluation, priority, status: 'done' } : i) })),
  archiveIdea: (ideaId) =>
    set((s) => ({ ideas: s.ideas.filter(i => i.id !== ideaId) })),
}))
```

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/store/
git commit -m "feat: Zustand stores for agents, chat, and ideas"
```

---

## Task 10: Mobile App — Navigation & Root App

**Files:**
- Create: `apps/mobile/src/components/PillTabBar.tsx`
- Create: `apps/mobile/src/navigation/RootNavigator.tsx`
- Modify: `apps/mobile/App.tsx`

- [ ] **Step 1: Create PillTabBar.tsx**

This matches the Pencil design: a pill-shaped container, radius 36, border #2C2C2E, padding 4.

```typescript
// apps/mobile/src/components/PillTabBar.tsx
import React from 'react'
import { View, TouchableOpacity, Text, StyleSheet } from 'react-native'
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs'
import { colors, spacing, radius, fonts } from '../theme'

const LABELS: Record<string, string> = {
  Chat:   '对话',
  Ideas:  '点子',
  Agents: 'Agent',
}

export function PillTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  return (
    <View style={styles.wrapper}>
      <View style={styles.pill}>
        {state.routes.map((route, index) => {
          const focused = state.index === index
          const label = LABELS[route.name] ?? route.name
          return (
            <TouchableOpacity
              key={route.key}
              style={[styles.tab, focused && styles.tabActive]}
              onPress={() => navigation.navigate(route.name)}
              activeOpacity={0.7}
            >
              <Text style={[styles.label, focused && styles.labelActive]}>{label}</Text>
            </TouchableOpacity>
          )
        })}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  wrapper: {
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: 21,
    alignItems: 'center',
  },
  pill: {
    flexDirection: 'row',
    backgroundColor: colors.bg,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 4,
    width: '100%',
    height: 62,
  },
  tab: {
    flex: 1,
    borderRadius: radius.pill - 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabActive: {
    backgroundColor: colors.surface,
  },
  label: {
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.muted,
  },
  labelActive: {
    color: colors.white,
    fontWeight: '600',
  },
})
```

- [ ] **Step 2: Create RootNavigator.tsx**

```typescript
// apps/mobile/src/navigation/RootNavigator.tsx
import React, { useCallback } from 'react'
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { NavigationContainer } from '@react-navigation/native'
import { PillTabBar } from '../components/PillTabBar'
import { ChatScreen } from '../screens/chat/ChatScreen'
import { IdeasScreen } from '../screens/ideas/IdeasScreen'
import { AgentsScreen } from '../screens/agents/AgentsScreen'
import { useSocket } from '../ws/useSocket'
import { useAgentStore } from '../store/agentStore'
import { useChatStore } from '../store/chatStore'
import { useIdeaStore } from '../store/ideaStore'
import type { AppDownMsg } from '@agent-companion/protocol'

const Tab = createBottomTabNavigator()

const SERVER_URL = process.env.EXPO_PUBLIC_SERVER_URL ?? 'ws://localhost:8766'

export function RootNavigator() {
  const { setAgents, updateAgent } = useAgentStore()
  const { appendMessage, setHistory } = useChatStore()
  const { setIdeas, addIdea, updateEvaluation } = useIdeaStore()

  const handleMessage = useCallback((msg: AppDownMsg) => {
    if (msg.type === 'snapshot') { setAgents(msg.agents); setIdeas(msg.ideas) }
    else if (msg.type === 'agent:update') updateAgent(msg.agent)
    else if (msg.type === 'msg') appendMessage(msg.agentId, msg.conversationId, msg.message)
    else if (msg.type === 'history') setHistory(msg.agentId, msg.conversationId, msg.messages)
    else if (msg.type === 'idea:created') addIdea(msg.idea)
    else if (msg.type === 'idea:evaluated') updateEvaluation(msg.ideaId, msg.evaluation, msg.priority)
  }, [setAgents, updateAgent, appendMessage, setHistory, setIdeas, addIdea, updateEvaluation])

  const { send } = useSocket({ url: SERVER_URL, deviceToken: '', onMessage: handleMessage })

  return (
    <NavigationContainer>
      <Tab.Navigator tabBar={(props) => <PillTabBar {...props} />} screenOptions={{ headerShown: false }}>
        <Tab.Screen name="Chat">{() => <ChatScreen send={send} />}</Tab.Screen>
        <Tab.Screen name="Ideas">{() => <IdeasScreen send={send} />}</Tab.Screen>
        <Tab.Screen name="Agents" component={AgentsScreen} />
      </Tab.Navigator>
    </NavigationContainer>
  )
}
```

- [ ] **Step 3: Update App.tsx**

```typescript
// apps/mobile/App.tsx
import React from 'react'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { RootNavigator } from './src/navigation/RootNavigator'

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <RootNavigator />
    </SafeAreaProvider>
  )
}
```

- [ ] **Step 4: Run the app on iOS Simulator**

```bash
cd apps/mobile && npx expo start --ios
```

Expected: App launches, black screen with three tabs visible at bottom (对话 | 点子 | Agent)

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/components/ apps/mobile/src/navigation/ apps/mobile/App.tsx
git commit -m "feat: navigation shell with pill tab bar"
```

---

## Task 11: Mobile App — Chat Screen

**Files:**
- Create: `apps/mobile/src/screens/chat/LogBlock.tsx`
- Create: `apps/mobile/src/screens/chat/AskQuestionCard.tsx`
- Create: `apps/mobile/src/screens/chat/MessageList.tsx`
- Create: `apps/mobile/src/screens/chat/InputBar.tsx`
- Create: `apps/mobile/src/screens/chat/AgentSwitchSheet.tsx`
- Create: `apps/mobile/src/screens/chat/ChatScreen.tsx`

Design reference: Pencil `BNkEk` (grok frame) — dark bg, user bubble top-right, AGENT LOG collapsible block, ASK_QUESTION card with radio options, monospace font, input bar + send button.

- [ ] **Step 1: Create LogBlock.tsx**

```typescript
// apps/mobile/src/screens/chat/LogBlock.tsx
import React, { useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { colors, spacing, radius, fonts } from '../../theme'

interface LogBlockProps {
  lines: string[]
}

export function LogBlock({ lines }: LogBlockProps) {
  const [collapsed, setCollapsed] = useState(false)
  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.header} onPress={() => setCollapsed(c => !c)}>
        <Text style={styles.label}>▎ AGENT LOG</Text>
        <Text style={styles.toggle}>{collapsed ? 'expand' : 'fold'}</Text>
      </TouchableOpacity>
      {!collapsed && lines.map((line, i) => (
        <Text key={i} style={styles.line}>{line.startsWith('→') ? line : `→ ${line}`}</Text>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: 4,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  label: { color: colors.muted, fontSize: 11, fontFamily: fonts.mono, fontWeight: '600', letterSpacing: 1 },
  toggle: { color: colors.muted, fontSize: 11, fontFamily: fonts.mono },
  line:   { color: colors.white, fontSize: 12, fontFamily: fonts.mono, lineHeight: 18 },
})
```

- [ ] **Step 2: Create AskQuestionCard.tsx**

```typescript
// apps/mobile/src/screens/chat/AskQuestionCard.tsx
import React, { useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { colors, spacing, radius, fonts } from '../../theme'
import type { ChatMessage } from '@agent-companion/protocol'

type AskMsg = Extract<ChatMessage, { kind: 'ask_question' }>

interface AskQuestionCardProps {
  message: AskMsg
  onAnswer: (questionId: string, answer: string) => void
}

export function AskQuestionCard({ message, onAnswer }: AskQuestionCardProps) {
  const [selected, setSelected] = useState<string | null>(message.answered ?? null)

  function choose(option: string) {
    if (selected) return // already answered
    setSelected(option)
    onAnswer(message.questionId, option)
  }

  const options = message.options ?? []

  return (
    <View style={styles.card}>
      <Text style={styles.label}>⚡ ASK_QUESTION</Text>
      <Text style={styles.question}>{message.question}</Text>
      {options.map((opt) => (
        <TouchableOpacity
          key={opt}
          style={[styles.option, selected === opt && styles.optionSelected]}
          onPress={() => choose(opt)}
          activeOpacity={0.7}
        >
          <View style={[styles.radio, selected === opt && styles.radioSelected]} />
          <Text style={styles.optionText}>{opt}</Text>
        </TouchableOpacity>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  label:    { color: colors.muted, fontSize: 11, fontFamily: fonts.mono, fontWeight: '600', letterSpacing: 1, marginBottom: 4 },
  question: { color: colors.white, fontSize: 15, fontFamily: fonts.sans, fontWeight: '500', marginBottom: 8 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 12,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  optionSelected: { borderColor: colors.white },
  radio: { width: 16, height: 16, borderRadius: 8, borderWidth: 1.5, borderColor: colors.muted },
  radioSelected: { borderColor: colors.white, backgroundColor: colors.white },
  optionText: { color: colors.white, fontSize: 14, fontFamily: fonts.sans },
})
```

- [ ] **Step 3: Create MessageList.tsx**

```typescript
// apps/mobile/src/screens/chat/MessageList.tsx
import React, { useRef, useEffect, useMemo } from 'react'
import { FlatList, View, Text, StyleSheet } from 'react-native'
import type { ChatMessage } from '@agent-companion/protocol'
import { LogBlock } from './LogBlock'
import { AskQuestionCard } from './AskQuestionCard'
import { colors, spacing, radius, fonts } from '../../theme'

interface MessageListProps {
  messages: ChatMessage[]
  onAnswer: (questionId: string, answer: string) => void
}

// Group consecutive agent_log messages into a single LogBlock
function groupMessages(messages: ChatMessage[]): Array<{ type: 'log_group'; lines: string[]; id: string } | ChatMessage> {
  const result: Array<{ type: 'log_group'; lines: string[]; id: string } | ChatMessage> = []
  let logGroup: string[] | null = null
  let groupId = ''

  for (const msg of messages) {
    if (msg.kind === 'agent_log') {
      if (!logGroup) { logGroup = []; groupId = msg.id }
      logGroup.push(msg.content)
    } else {
      if (logGroup) { result.push({ type: 'log_group', lines: logGroup, id: groupId }); logGroup = null }
      result.push(msg)
    }
  }
  if (logGroup) result.push({ type: 'log_group', lines: logGroup, id: groupId })
  return result
}

export function MessageList({ messages, onAnswer }: MessageListProps) {
  const listRef = useRef<FlatList>(null)
  const grouped = useMemo(() => groupMessages(messages), [messages])

  useEffect(() => {
    if (grouped.length > 0) listRef.current?.scrollToEnd({ animated: true })
  }, [grouped.length])

  return (
    <FlatList
      ref={listRef}
      data={grouped}
      keyExtractor={(item) => ('id' in item ? item.id : String(item))}
      contentContainerStyle={styles.content}
      renderItem={({ item }) => {
        if ('type' in item && item.type === 'log_group') {
          return <View style={styles.item}><LogBlock lines={item.lines} /></View>
        }
        const msg = item as ChatMessage
        if (msg.kind === 'user_text') {
          return (
            <View style={styles.userRow}>
              <View style={styles.userBubble}><Text style={styles.userText}>{msg.content}</Text></View>
            </View>
          )
        }
        if (msg.kind === 'ask_question') {
          return <View style={styles.item}><AskQuestionCard message={msg} onAnswer={onAnswer} /></View>
        }
        if (msg.kind === 'user_answer') {
          return (
            <View style={styles.userRow}>
              <View style={styles.userBubble}><Text style={styles.userText}>✓ {msg.answer}</Text></View>
            </View>
          )
        }
        return null
      }}
    />
  )
}

const styles = StyleSheet.create({
  content: { padding: spacing.xl, gap: spacing.md },
  item:    { width: '100%' },
  userRow: { alignItems: 'flex-end' },
  userBubble: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    maxWidth: '80%',
  },
  userText: { color: colors.white, fontSize: 14, fontFamily: fonts.sans },
})
```

- [ ] **Step 4: Create InputBar.tsx**

```typescript
// apps/mobile/src/screens/chat/InputBar.tsx
import React, { useState } from 'react'
import { View, TextInput, TouchableOpacity, Text, StyleSheet } from 'react-native'
import { colors, spacing, radius, fonts } from '../../theme'

interface InputBarProps {
  onSend: (text: string) => void
  onOpenAgentSwitch: () => void
}

export function InputBar({ onSend, onOpenAgentSwitch }: InputBarProps) {
  const [text, setText] = useState('')

  function handleSend() {
    const trimmed = text.trim()
    if (!trimmed) return
    onSend(trimmed)
    setText('')
  }

  return (
    <View style={styles.container}>
      <TouchableOpacity onPress={onOpenAgentSwitch} style={styles.menuBtn}>
        <Text style={styles.menuIcon}>≡</Text>
      </TouchableOpacity>
      <TextInput
        style={styles.input}
        value={text}
        onChangeText={setText}
        placeholder="输入指令..."
        placeholderTextColor={colors.muted}
        onSubmitEditing={handleSend}
        returnKeyType="send"
        multiline={false}
      />
      <TouchableOpacity onPress={handleSend} style={styles.sendBtn}>
        <Text style={styles.sendIcon}>↑</Text>
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.bg,
  },
  menuBtn:  { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  menuIcon: { color: colors.muted, fontSize: 20 },
  input: {
    flex: 1,
    height: 42,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    paddingHorizontal: spacing.md,
    color: colors.white,
    fontFamily: fonts.sans,
    fontSize: 14,
  },
  sendBtn: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: colors.white,
    alignItems: 'center', justifyContent: 'center',
  },
  sendIcon: { color: colors.bg, fontSize: 18, fontWeight: '700' },
})
```

- [ ] **Step 5: Create AgentSwitchSheet.tsx**

```typescript
// apps/mobile/src/screens/chat/AgentSwitchSheet.tsx
import React from 'react'
import { View, Text, TouchableOpacity, Modal, FlatList, StyleSheet } from 'react-native'
import type { AgentInfo } from '@agent-companion/protocol'
import { colors, spacing, radius, fonts } from '../../theme'

interface AgentSwitchSheetProps {
  visible: boolean
  agents: AgentInfo[]
  currentAgentId: string | null
  onSelect: (agentId: string) => void
  onClose: () => void
}

const STATUS_DOT: Record<string, string> = { running: '◉', online: '●', offline: '○' }
const STATUS_COLOR: Record<string, string> = { running: colors.running, online: colors.online, offline: colors.offline }

export function AgentSwitchSheet({ visible, agents, currentAgentId, onSelect, onClose }: AgentSwitchSheetProps) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.bar} />
        <Text style={styles.title}>SWITCH AGENT</Text>
        <FlatList
          data={agents}
          keyExtractor={a => a.id}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[styles.agentRow, item.id === currentAgentId && styles.agentRowActive]}
              onPress={() => { onSelect(item.id); onClose() }}
            >
              <Text style={[styles.dot, { color: STATUS_COLOR[item.status] }]}>{STATUS_DOT[item.status]}</Text>
              <View style={{ flex: 1 }}>
                <View style={styles.agentNameRow}>
                  <Text style={styles.agentName}>{item.name}</Text>
                  {item.id === currentAgentId && <Text style={styles.current}>✓ 当前</Text>}
                  {item.status === 'running' && <Text style={styles.badge}>RUNNING</Text>}
                  {item.status === 'offline' && <Text style={[styles.badge, { color: colors.muted }]}>OFFLINE</Text>}
                </View>
                <Text style={styles.path}>{item.projectPath}</Text>
              </View>
            </TouchableOpacity>
          )}
        />
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop:  { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet:     { backgroundColor: colors.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 32 },
  bar:       { width: 36, height: 4, backgroundColor: colors.border, borderRadius: 2, alignSelf: 'center', marginTop: 12, marginBottom: 16 },
  title:     { color: colors.muted, fontSize: 11, fontFamily: fonts.mono, fontWeight: '600', letterSpacing: 1.5, paddingHorizontal: spacing.xl, marginBottom: 8 },
  agentRow:  { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderRadius: radius.md, marginHorizontal: spacing.lg, marginBottom: spacing.sm },
  agentRowActive: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  dot:       { fontSize: 14, marginTop: 2 },
  agentNameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  agentName: { color: colors.white, fontSize: 14, fontFamily: fonts.sans, fontWeight: '500' },
  current:   { color: colors.muted, fontSize: 12, fontFamily: fonts.mono },
  badge:     { color: colors.running, fontSize: 11, fontFamily: fonts.mono, fontWeight: '600' },
  path:      { color: colors.muted, fontSize: 11, fontFamily: fonts.mono, marginTop: 2 },
})
```

- [ ] **Step 6: Create ChatScreen.tsx**

```typescript
// apps/mobile/src/screens/chat/ChatScreen.tsx
import React, { useState } from 'react'
import { View, Text, StyleSheet, SafeAreaView } from 'react-native'
import { MessageList } from './MessageList'
import { InputBar } from './InputBar'
import { AgentSwitchSheet } from './AgentSwitchSheet'
import { useChatStore } from '../../store/chatStore'
import { useAgentStore } from '../../store/agentStore'
import type { AppUpMsg } from '@agent-companion/protocol'
import { colors, spacing, fonts } from '../../theme'

interface ChatScreenProps { send: (msg: AppUpMsg) => void }

export function ChatScreen({ send }: ChatScreenProps) {
  const [sheetVisible, setSheetVisible] = useState(false)
  const { agents, activeAgentId, setActiveAgent } = useAgentStore()
  const { messages, activeConversationId } = useChatStore()

  const agentMessages = activeAgentId ? (messages[activeAgentId] ?? []) : []

  function handleSend(text: string) {
    if (!activeAgentId) return
    send({ type: 'app:send', agentId: activeAgentId, content: text })
  }

  function handleAnswer(questionId: string, answer: string) {
    if (!activeAgentId) return
    send({ type: 'app:answer', agentId: activeAgentId, questionId, answer })
  }

  function handleSelectAgent(agentId: string) {
    setActiveAgent(agentId)
    send({ type: 'app:switch', agentId })
  }

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>对话</Text>
        {activeAgentId && <Text style={styles.agentHint}>{agents.find(a => a.id === activeAgentId)?.name}</Text>}
      </View>
      <MessageList messages={agentMessages} onAnswer={handleAnswer} />
      <InputBar onSend={handleSend} onOpenAgentSwitch={() => setSheetVisible(true)} />
      <AgentSwitchSheet
        visible={sheetVisible}
        agents={agents}
        currentAgentId={activeAgentId}
        onSelect={handleSelectAgent}
        onClose={() => setSheetVisible(false)}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xl, paddingVertical: spacing.sm },
  headerTitle: { color: colors.white, fontSize: 16, fontFamily: fonts.sans, fontWeight: '600' },
  agentHint:   { color: colors.muted, fontSize: 12, fontFamily: fonts.mono },
})
```

- [ ] **Step 7: Run app and manually verify Chat screen**

```bash
cd apps/mobile && npx expo start --ios
```

Expected: Chat tab shows empty message list + input bar + send button. Tap ≡ to see agent sheet (empty until server runs).

- [ ] **Step 8: Commit**

```bash
git add apps/mobile/src/screens/chat/
git commit -m "feat: chat screen with log blocks, ask question cards, agent switcher"
```

---

## Task 12: Mobile App — Ideas Screen & Agents Screen

**Files:**
- Create: `apps/mobile/src/screens/ideas/IdeaCard.tsx`
- Create: `apps/mobile/src/screens/ideas/IdeasScreen.tsx`
- Create: `apps/mobile/src/screens/agents/AgentsScreen.tsx`

Design reference: Pencil `LYr5D` (gideas) — input + submit, card list with priority badge, PENDING/RUNNING/EVAL status. Pencil `CfGFF` (gagent) — stat bar, card list with path + activity.

- [ ] **Step 1: Create IdeaCard.tsx**

```typescript
// apps/mobile/src/screens/ideas/IdeaCard.tsx
import React from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import type { IdeaInfo } from '@agent-companion/protocol'
import { colors, spacing, radius, fonts } from '../../theme'

interface IdeaCardProps {
  idea: IdeaInfo
  onArchive: (id: string) => void
}

const PRIORITY_COLOR: Record<string, string> = { HIGH: colors.high, MED: colors.med, LOW: colors.low }
const STATUS_LABEL: Record<string, string> = { pending: 'PENDING', evaluating: 'EVAL...', done: '', archived: 'ARCHIVED' }

export function IdeaCard({ idea, onArchive }: IdeaCardProps) {
  const priorityColor = idea.priority ? PRIORITY_COLOR[idea.priority] : colors.muted

  return (
    <View style={styles.card}>
      <View style={styles.topRow}>
        <Text style={styles.content} numberOfLines={2}>{idea.content}</Text>
        {idea.priority && <Text style={[styles.priority, { color: priorityColor }]}>{idea.priority}</Text>}
      </View>
      {idea.evaluation && <Text style={styles.evaluation}>{idea.evaluation}</Text>}
      <View style={styles.bottomRow}>
        <Text style={styles.meta}>
          {new Date(idea.createdAt).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
          {idea.status !== 'done' && `  ${STATUS_LABEL[idea.status]}`}
        </Text>
        <TouchableOpacity onPress={() => onArchive(idea.id)}>
          <Text style={styles.archive}>归档</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  card:      { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, gap: 6 },
  topRow:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.sm },
  content:   { flex: 1, color: colors.white, fontSize: 14, fontFamily: fonts.sans, fontWeight: '500' },
  priority:  { fontSize: 12, fontFamily: fonts.mono, fontWeight: '700' },
  evaluation:{ color: colors.muted, fontSize: 12, fontFamily: fonts.mono },
  bottomRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 },
  meta:      { color: colors.muted, fontSize: 11, fontFamily: fonts.mono },
  archive:   { color: colors.muted, fontSize: 12, fontFamily: fonts.mono },
})
```

- [ ] **Step 2: Create IdeasScreen.tsx**

```typescript
// apps/mobile/src/screens/ideas/IdeasScreen.tsx
import React, { useState } from 'react'
import { View, TextInput, TouchableOpacity, Text, FlatList, StyleSheet, SafeAreaView } from 'react-native'
import { IdeaCard } from './IdeaCard'
import { useIdeaStore } from '../../store/ideaStore'
import type { AppUpMsg } from '@agent-companion/protocol'
import { colors, spacing, radius, fonts } from '../../theme'

interface IdeasScreenProps { send: (msg: AppUpMsg) => void }

export function IdeasScreen({ send }: IdeasScreenProps) {
  const [text, setText] = useState('')
  const { ideas, archiveIdea } = useIdeaStore()

  function handleSubmit() {
    const trimmed = text.trim()
    if (!trimmed) return
    send({ type: 'app:idea:create', content: trimmed })
    setText('')
  }

  function handleArchive(id: string) {
    archiveIdea(id)
    send({ type: 'app:idea:archive', ideaId: id })
  }

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>点子</Text>
      </View>
      <View style={styles.inputWrap}>
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={setText}
          placeholder=">_ 快速捕捉你的想法..."
          placeholderTextColor={colors.muted}
          multiline
        />
        <TouchableOpacity onPress={handleSubmit} style={styles.submitBtn}>
          <Text style={styles.submitIcon}>↗</Text>
        </TouchableOpacity>
      </View>
      <FlatList
        data={ideas}
        keyExtractor={i => i.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => <IdeaCard idea={item} onArchive={handleArchive} />}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root:       { flex: 1, backgroundColor: colors.bg },
  header:     { paddingHorizontal: spacing.xl, paddingVertical: spacing.sm },
  title:      { color: colors.white, fontSize: 16, fontFamily: fonts.sans, fontWeight: '600' },
  inputWrap:  { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  input:      { flex: 1, minHeight: 44, backgroundColor: colors.bg, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.white, fontFamily: fonts.mono, fontSize: 14 },
  submitBtn:  { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  submitIcon: { color: colors.bg, fontSize: 18, fontWeight: '700' },
  list:       { padding: spacing.lg, gap: spacing.sm },
})
```

- [ ] **Step 3: Create AgentsScreen.tsx**

```typescript
// apps/mobile/src/screens/agents/AgentsScreen.tsx
import React from 'react'
import { View, Text, FlatList, TouchableOpacity, StyleSheet, SafeAreaView } from 'react-native'
import { useAgentStore } from '../../store/agentStore'
import { colors, spacing, radius, fonts } from '../../theme'
import type { AgentInfo } from '@agent-companion/protocol'

const STATUS_DOT: Record<string, string> = { running: '◉', online: '●', offline: '○' }
const STATUS_COLOR: Record<string, string> = { running: colors.running, online: colors.online, offline: colors.offline }
const STATUS_LABEL: Record<string, string> = { running: 'RUNNING', online: 'ONLINE', offline: 'OFFLINE' }

export function AgentsScreen() {
  const { agents } = useAgentStore()

  const running = agents.filter(a => a.status === 'running').length
  const online  = agents.filter(a => a.status === 'online').length
  const offline = agents.filter(a => a.status === 'offline').length

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>Agent</Text>
      </View>
      <View style={styles.stats}>
        <Text style={styles.stat}>◉ {running} RUNNING</Text>
        <Text style={styles.stat}>● {online} ONLINE</Text>
        <Text style={styles.stat}>○ {offline} OFFLINE</Text>
      </View>
      <FlatList
        data={agents}
        keyExtractor={a => a.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => <AgentCard agent={item} />}
      />
    </SafeAreaView>
  )
}

function AgentCard({ agent }: { agent: AgentInfo }) {
  const dotColor = STATUS_COLOR[agent.status]
  const label    = STATUS_LABEL[agent.status]
  const elapsed  = Math.round((Date.now() - agent.lastActiveAt) / 60_000)

  return (
    <View style={[styles.card, agent.status === 'offline' && styles.cardOffline]}>
      <View style={styles.nameRow}>
        <Text style={[styles.dot, { color: dotColor }]}>{STATUS_DOT[agent.status]}</Text>
        <Text style={[styles.name, agent.status === 'offline' && styles.nameOffline]}>{agent.name}</Text>
        <Text style={[styles.status, { color: dotColor }]}>{label}</Text>
      </View>
      <Text style={styles.path}>{agent.projectPath}</Text>
      {agent.status !== 'offline' && <Text style={styles.meta}>idle {elapsed}m</Text>}
      {agent.status === 'offline' && <Text style={styles.meta}>{elapsed}m ago</Text>}
    </View>
  )
}

const styles = StyleSheet.create({
  root:        { flex: 1, backgroundColor: colors.bg },
  header:      { paddingHorizontal: spacing.xl, paddingVertical: spacing.sm },
  title:       { color: colors.white, fontSize: 16, fontFamily: fonts.sans, fontWeight: '600' },
  stats:       { flexDirection: 'row', gap: spacing.lg, paddingHorizontal: spacing.xl, paddingVertical: spacing.xs },
  stat:        { color: colors.muted, fontSize: 12, fontFamily: fonts.mono, fontWeight: '600' },
  list:        { padding: spacing.lg, gap: spacing.sm },
  card:        { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, gap: 4 },
  cardOffline: { borderColor: colors.bg },
  nameRow:     { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dot:         { fontSize: 12 },
  name:        { color: colors.white, fontSize: 14, fontFamily: fonts.sans, fontWeight: '600', flex: 1 },
  nameOffline: { color: colors.muted },
  status:      { fontSize: 11, fontFamily: fonts.mono, fontWeight: '600' },
  path:        { color: colors.muted, fontSize: 11, fontFamily: fonts.mono },
  meta:        { color: colors.muted, fontSize: 11, fontFamily: fonts.mono },
})
```

- [ ] **Step 4: Verify all 3 screens render on simulator**

```bash
cd apps/mobile && npx expo start --ios
```

Tap each tab. All 3 screens should render without errors.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/screens/
git commit -m "feat: ideas and agents screens"
```

---

## Task 13: End-to-End Integration Test

**Goal:** Verify the full message flow: cc-connect → backend → mobile app.

- [ ] **Step 1: Start the backend server**

```bash
AGENT_TOKENS=test-token cd apps/server && bun run src/index.ts
```

Expected: "Agent WS listening on :8765" and "App WS listening on :8766"

- [ ] **Step 2: Connect a mock agent (simulate cc-connect)**

```typescript
// apps/server/tests/integration/mock-agent.ts
// Run with: bun run tests/integration/mock-agent.ts
import { WebSocket } from 'ws'

const ws = new WebSocket('ws://localhost:8765')
ws.on('open', () => {
  ws.send(JSON.stringify({ type: 'agent:register', agentId: 'test-agent', token: 'test-token', name: 'test-project', projectPath: '/tmp/test' }))
  setTimeout(() => {
    ws.send(JSON.stringify({ type: 'agent:status', status: 'running' }))
    ws.send(JSON.stringify({ type: 'agent:log', conversationId: 'c1', seq: 1, content: 'Analyzing api/performance.ts', ts: Date.now() }))
    ws.send(JSON.stringify({ type: 'agent:log', conversationId: 'c1', seq: 2, content: 'Found N+1 query in /api/users', ts: Date.now() }))
    ws.send(JSON.stringify({ type: 'agent:ask', conversationId: 'c1', seq: 3, questionId: 'q1', question: '应用以下哪种缓存策略？', options: ['Redis 分布式缓存', '内存存储（更快）', '暂不优化，继续分析'] }))
  }, 500)
})
ws.on('message', (data) => console.log('Agent received:', data.toString()))
```

Run in a second terminal: `bun run apps/server/tests/integration/mock-agent.ts`

- [ ] **Step 3: Start mobile app pointing to local server**

```bash
EXPO_PUBLIC_SERVER_URL=ws://localhost:8766 cd apps/mobile && npx expo start --ios
```

Expected:
- Chat tab shows agent "test-project" online in AgentSwitchSheet
- After Step 2 runs, log lines appear as a LogBlock
- AskQuestion card appears with 3 radio options

- [ ] **Step 4: Answer the question from mobile**

Tap one option in the AskQuestion card.

Expected: Terminal running `mock-agent.ts` shows `{"type":"cmd:answer","conversationId":"c1","questionId":"q1","answer":"..."}` received.

- [ ] **Step 5: Commit integration test helper**

```bash
git add apps/server/tests/integration/
git commit -m "test: end-to-end integration mock agent script"
```

---

## Spec Coverage Review

| SPEC Requirement | Task |
|---|---|
| 手机 IM 对话（多轮实时对话） | Tasks 10, 11 (ChatScreen + MessageList) |
| 实时流式日志 | Task 11 (LogBlock, appendMessage dedup by seq) |
| AskQuestion 卡片 | Task 11 (AskQuestionCard) |
| 手机推送通知（完成/出错） | Task 5 (apns.ts + router push_notify) |
| Agent 管理（在线/离线/运行） | Tasks 5, 12 (AgentsScreen) |
| 点子模块 + AI 价值判断 | Tasks 5, 12 (IdeasScreen + evaluateIdea) |
| cc-connect 接入（WebSocket 长连接） | Task 6 (platform/mobile) |
| 断线自动重连（手机侧） | Task 8 (useSocket reconnect) |
| 断线自动重连（cc-connect 侧） | Task 6 (connectLoop with backoff) |
| 日志节流渲染（≥50ms 合并） | Task 11 (groupMessages batches logs, FlatList handles render) |
| 消息 seq 补偿 | Tasks 3 router + Task 9 chatStore dedup by seq |
| 心跳检测 | Tasks 4 (server-side ping/pong), Task 8 (client-side 25s ping) |
| 多 Agent 切换 | Tasks 11 (AgentSwitchSheet), router.bindAppToAgent |

---

