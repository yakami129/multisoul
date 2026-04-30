# MultiSoul Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复现有 bug，实现 Runtime Adapter（让 msctl serve 真正驱动 Claude Code 执行任务），并补齐 QR 配对和 Inbox 内联回答功能。

**Architecture:** CLI 端新增 `src/serve/runtime.rs` 模块，收到 `user_text` 后 spawn `claude --output-format stream-json --input-format stream-json --permission-prompt-tool stdio` 子进程，解析 JSON 事件流，通过 broadcast channel 推送 WS 消息给 App。Mobile 端修复 Zustand selector bug、补齐 Chat Tab 数据加载、AddEndpointModal QR 扫描、Inbox pending_question 内联回答。

**Tech Stack:** Rust (tokio, serde_json, std::process), React Native, Expo SDK 55, expo-camera, Zustand, NativeWind, PIP-BOY design system

---

## File Structure

```
cli/src/serve/
├── runtime.rs          CREATE — spawn claude 子进程，解析 stream-json，广播 WS 消息
├── routes/messages.rs  MODIFY — post_message 后触发 runtime::run_agent_turn
└── mod.rs              MODIFY — pub mod runtime

mobile/app/chat/[id].tsx                              MODIFY — 修复 Zustand selector bug
mobile/app/(tabs)/chat.tsx                            MODIFY — 加载 conversations 数据
mobile/src/features/settings/components/
└── AddEndpointModal.tsx                              MODIFY — 加入 QR 扫描 tab
mobile/src/features/inbox/components/
└── InboxScreen.tsx                                   MODIFY — pending_question 内联回答
mobile/app/(tabs)/inbox.tsx                           MODIFY — 传入 sendAnswer 回调
```

---

## Task 1: 修复 chat/[id].tsx Zustand 无限循环 bug

**Files:**
- Modify: `mobile/app/chat/[id].tsx`

- [ ] **Step 1: 在文件顶部加 EMPTY 常量，修复 selector**

将 `mobile/app/chat/[id].tsx` 第 1 行 import 区域后、组件前，加入：

```ts
import { WsMessage } from '@/types';

const EMPTY: WsMessage[] = [];
```

将第 21 行：
```ts
const messages = useChatStore((s) => s.messages[conv_id] ?? []);
```
改为：
```ts
const messagesMap = useChatStore((s) => s.messages);
const messages = messagesMap[conv_id] ?? EMPTY;
```

- [ ] **Step 2: 验证 typecheck 通过**

```bash
cd mobile && pnpm typecheck 2>&1 | tail -5
```

Expected: 无新增错误。

- [ ] **Step 3: Commit**

```bash
git add mobile/app/chat/[id].tsx
git commit -m "fix: stable Zustand selector in chat/[id].tsx to prevent infinite loop"
```

---

## Task 2: Chat Tab 加载真实 conversations 数据

**Files:**
- Modify: `mobile/app/(tabs)/chat.tsx`

**背景：** `chatStore.conversations` 永远是空数组，因为没有任何地方调用 `fetchConversations`。需要在 Chat Tab mount 时，从所有 endpoint 的所有 agent 拉取 conversations，写入 store。

- [ ] **Step 1: 修改 chat.tsx，加入数据加载逻辑**

将 `mobile/app/(tabs)/chat.tsx` 完整替换为：

```tsx
import React, { useEffect } from 'react';
import { SafeAreaView, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useChatStore } from '@/store/chatStore';
import { useEndpointStore } from '@/store/endpointStore';
import ChatHomeScreen from '@/features/chat/components/ChatHomeScreen';
import { fetchConversations } from '@/features/chat/services/chatService';
import { fetchAllAgents } from '@/features/agents/services/agentService';
import { Conversation } from '@/types';

export default function ChatTab() {
  const router = useRouter();
  const endpoints = useEndpointStore((s) => s.endpoints);
  const setConversations = useChatStore((s) => s.setConversations);
  const conversations = useChatStore((s) => s.conversations);

  // 拉取所有 endpoint 下所有 agent 的 conversations
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
              ep.base_url, ep.token, agent.id, ep.id, agent.name
            );
            all.push(...convs);
          } catch { /* skip offline endpoints */ }
        })
      );
      // 按 last_message_at 降序排列
      all.sort((a, b) => b.last_message_at - a.last_message_at);
      setConversations(all);
      return all;
    },
    enabled: endpoints.length > 0,
    refetchInterval: 30_000,
  });

  const handlePress = (conv: Conversation) => {
    router.push(`/chat/${conv.id}?endpoint_id=${conv.endpoint_id}` as any);
  };

  return (
    <SafeAreaView style={s.safe}>
      <ChatHomeScreen
        conversations={conversations}
        onPressConversation={handlePress}
        onPressNewChat={() => {}}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#040D04' },
});
```

- [ ] **Step 2: 验证 typecheck 通过**

```bash
cd mobile && pnpm typecheck 2>&1 | tail -5
```

Expected: 无新增错误。

- [ ] **Step 3: Commit**

```bash
git add mobile/app/(tabs)/chat.tsx
git commit -m "feat: load real conversations in Chat Tab from all endpoints"
```

---

## Task 3: Runtime Adapter — CLI 端 runtime.rs 模块（第一部分：结构体和辅助函数）

**Files:**
- Create: `cli/src/serve/runtime.rs`
- Modify: `cli/src/serve/mod.rs`

- [ ] **Step 1: 在 `cli/src/serve/mod.rs` 加 `pub mod runtime;`**

将 `cli/src/serve/mod.rs` 改为：

```rust
pub mod state;
pub mod auth;
pub mod push;
pub mod routes;
pub mod runtime;
```

- [ ] **Step 2: 创建 `cli/src/serve/runtime.rs`，写入结构体和辅助函数**

```rust
//! Runtime adapter: spawns a `claude` subprocess per conversation turn,
//! parses its stream-json stdout, and broadcasts WS messages to connected clients.

use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};
use serde_json::Value;
use uuid::Uuid;
use crate::db::now_ms;
use crate::serve::state::AppState;

#[derive(serde::Serialize)]
struct WsEnvelope {
    #[serde(rename = "type")]
    kind: &'static str,
    seq: i64,
    role: &'static str,
    payload: Value,
    created_at: i64,
}

fn insert_message(
    db: &rusqlite::Connection,
    conv_id: &str,
    role: &str,
    payload: &Value,
) -> rusqlite::Result<i64> {
    let seq: i64 = db.query_row(
        "SELECT COALESCE(MAX(seq),0)+1 FROM messages WHERE conversation_id = ?1",
        [conv_id],
        |r| r.get(0),
    )?;
    let id = Uuid::new_v4().to_string();
    let now = now_ms();
    db.execute(
        "INSERT INTO messages (id, conversation_id, role, payload, created_at, seq)
         VALUES (?1,?2,?3,?4,?5,?6)",
        rusqlite::params![id, conv_id, role, payload.to_string(), now, seq],
    )?;
    db.execute(
        "UPDATE conversations SET last_message_at = ?1 WHERE id = ?2",
        rusqlite::params![now, conv_id],
    )?;
    Ok(seq)
}

fn broadcast(state: &AppState, conv_id: &str, seq: i64, role: &'static str, payload: Value) {
    let env = WsEnvelope { kind: "message", seq, role, payload, created_at: now_ms() };
    if let Ok(json) = serde_json::to_string(&env) {
        let tx = state.get_or_create_sender(conv_id);
        let _ = tx.send(json);
    }
}
```

- [ ] **Step 3: 追加 `run_agent_turn` 函数到 runtime.rs（第一半：spawn + stdin）**

在 `runtime.rs` 末尾追加：

```rust
pub fn run_agent_turn(state: AppState, conv_id: String, project_path: String) {
    tokio::spawn(async move {
        {
            let db = state.db.lock().unwrap();
            let _ = db.execute(
                "UPDATE conversations SET status = 'running' WHERE id = ?1",
                [&conv_id],
            );
        }

        let user_text: String = {
            let db = state.db.lock().unwrap();
            let mut stmt = match db.prepare(
                "SELECT payload FROM messages WHERE conversation_id = ?1
                 AND role = 'user_text' ORDER BY seq DESC LIMIT 1"
            ) {
                Ok(s) => s,
                Err(_) => return,
            };
            let payload_str: String = match stmt.query_row([&conv_id], |r| r.get(0)) {
                Ok(s) => s,
                Err(_) => return,
            };
            serde_json::from_str::<Value>(&payload_str)
                .ok()
                .and_then(|v| v["text"].as_str().map(|s| s.to_string()))
                .unwrap_or_default()
        };

        if user_text.is_empty() { return; }

        let mut child = match Command::new("claude")
            .args([
                "--output-format", "stream-json",
                "--input-format", "stream-json",
                "--permission-prompt-tool", "stdio",
                "--dangerously-skip-permissions",
            ])
            .current_dir(&project_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
        {
            Ok(c) => c,
            Err(e) => {
                eprintln!("[runtime] Failed to spawn claude: {}", e);
                let db = state.db.lock().unwrap();
                let _ = db.execute(
                    "UPDATE conversations SET status = 'failed' WHERE id = ?1",
                    [&conv_id],
                );
                return;
            }
        };

        if let Some(mut stdin) = child.stdin.take() {
            let msg = serde_json::json!({
                "type": "user",
                "message": {
                    "role": "user",
                    "content": [{ "type": "text", "text": &user_text }]
                }
            });
            let _ = writeln!(stdin, "{}", msg);
        }
```

- [ ] **Step 4: 追加事件循环到 runtime.rs（第二半：stdout 解析）**

在 `runtime.rs` 末尾继续追加（接上一步的 `spawn` 块）：

```rust
        let stdout = match child.stdout.take() {
            Some(s) => s,
            None => return,
        };
        let reader = BufReader::new(stdout);

        for line in reader.lines() {
            let line = match line { Ok(l) => l, Err(_) => break };
            if line.is_empty() { continue; }
            let raw: Value = match serde_json::from_str(&line) {
                Ok(v) => v,
                Err(_) => continue,
            };
            let event_type = raw["type"].as_str().unwrap_or("");
            match event_type {
                "assistant" => {
                    let content = match raw["message"]["content"].as_array() {
                        Some(c) => c.clone(),
                        None => continue,
                    };
                    for item in &content {
                        match item["type"].as_str().unwrap_or("") {
                            "text" => {
                                let text = item["text"].as_str().unwrap_or("");
                                if text.is_empty() { continue; }
                                let payload = serde_json::json!({ "text": text });
                                let db = state.db.lock().unwrap();
                                if let Ok(seq) = insert_message(&db, &conv_id, "agent_text", &payload) {
                                    drop(db);
                                    broadcast(&state, &conv_id, seq, "agent_text", payload);
                                }
                            }
                            "tool_use" => {
                                let tool = item["name"].as_str().unwrap_or("unknown");
                                let call_id = item["id"].as_str().unwrap_or("").to_string();
                                let args = serde_json::to_string(&item["input"]).unwrap_or_default();
                                let payload = serde_json::json!({
                                    "tool": tool, "args": args, "call_id": call_id
                                });
                                let db = state.db.lock().unwrap();
                                if let Ok(seq) = insert_message(&db, &conv_id, "tool_call", &payload) {
                                    drop(db);
                                    broadcast(&state, &conv_id, seq, "tool_call", payload);
                                }
                            }
                            _ => {}
                        }
                    }
                }
                "user" => {
                    if let Some(content) = raw["message"]["content"].as_array() {
                        for item in content {
                            if item["type"].as_str() == Some("tool_result") {
                                let call_id = item["tool_use_id"].as_str().unwrap_or("").to_string();
                                let is_error = item["is_error"].as_bool().unwrap_or(false);
                                let raw_summary = item["content"].as_str().unwrap_or("").to_string();
                                let summary = raw_summary[..raw_summary.len().min(200)].to_string();
                                let payload = serde_json::json!({
                                    "call_id": call_id, "ok": !is_error, "summary": summary
                                });
                                let db = state.db.lock().unwrap();
                                if let Ok(seq) = insert_message(&db, &conv_id, "tool_result", &payload) {
                                    drop(db);
                                    broadcast(&state, &conv_id, seq, "tool_result", payload);
                                }
                            }
                        }
                    }
                }
                "result" => {
                    let status = if raw["is_error"].as_bool().unwrap_or(false) { "failed" } else { "completed" };
                    {
                        let db = state.db.lock().unwrap();
                        let _ = db.execute(
                            "UPDATE conversations SET status = ?1 WHERE id = ?2",
                            rusqlite::params![status, &conv_id],
                        );
                    }
                    let raw_summary = raw["result"].as_str().unwrap_or("").to_string();
                    let summary = raw_summary[..raw_summary.len().min(200)].to_string();
                    let payload = serde_json::json!({
                        "task_id": &conv_id, "status": status,
                        "importance": "normal", "summary": summary
                    });
                    let db = state.db.lock().unwrap();
                    if let Ok(seq) = insert_message(&db, &conv_id, "task_status", &payload) {
                        drop(db);
                        broadcast(&state, &conv_id, seq, "task_status", payload);
                    }
                    break;
                }
                _ => {}
            }
        }
        let _ = child.wait();
    });
}
```

- [ ] **Step 5: 编译验证**

```bash
cd cli && cargo build 2>&1 | grep -E "^error" | head -20
```

Expected: 无 error。

- [ ] **Step 6: Commit**

```bash
git add cli/src/serve/runtime.rs cli/src/serve/mod.rs
git commit -m "feat: runtime adapter — spawn claude subprocess and stream WS events"
```

---

## Task 4: 在 post_message 后触发 Runtime Adapter

**Files:**
- Modify: `cli/src/serve/routes/messages.rs`

- [ ] **Step 1: 在 messages.rs 顶部加 runtime import**

在 `use crate::{db::now_ms, serve::state::AppState};` 这行后面加：

```rust
use crate::serve::runtime;
```

- [ ] **Step 2: 在 post_message 函数末尾触发 runtime**

在 `post_message` 函数的 `drop(db);` 之后、`let envelope = ...` 之前，插入：

```rust
    // Fetch project_path and trigger runtime adapter
    let project_path: Option<String> = {
        let db2 = state.db.lock().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        db2.query_row(
            "SELECT a.project_path FROM agents a
             JOIN conversations c ON c.agent_id = a.id
             WHERE c.id = ?1",
            [&conv_id],
            |r| r.get(0),
        ).ok()
    };
    if let Some(path) = project_path {
        runtime::run_agent_turn(state.clone(), conv_id.clone(), path);
    }
```

- [ ] **Step 3: 编译并运行测试**

```bash
cd cli && cargo build 2>&1 | grep -E "^error" | head -10
cd cli && cargo test 2>&1 | tail -10
```

Expected: 编译无 error，所有测试通过。

- [ ] **Step 4: Commit**

```bash
git add cli/src/serve/routes/messages.rs
git commit -m "feat: trigger runtime adapter after user message is posted"
```

---

## Task 5: AddEndpointModal 支持 QR 扫描

**Files:**
- Modify: `mobile/src/features/settings/components/AddEndpointModal.tsx`

**背景：** `msctl serve` 打印的 QR 码内容格式为 `multisoul://pair?url=<base_url>&token=<token>`。Modal 需要新增一个"扫码"tab，用 `expo-camera` 扫描后自动填入 url 和 token，然后走现有的 healthz 验证流程。

- [ ] **Step 1: 将 AddEndpointModal.tsx 完整替换**

```tsx
import React, { useState } from 'react';
import {
  Modal, View, Text, TextInput, TouchableOpacity,
  ActivityIndicator, StyleSheet,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { getEndpointClient } from '@/api/endpointClient';

type Tab = 'manual' | 'qr';

interface Props {
  visible: boolean;
  onClose: () => void;
  onAdd: (label: string, base_url: string, token: string) => void;
}

export function AddEndpointModal({ visible, onClose, onAdd }: Props) {
  const [tab, setTab] = useState<Tab>('manual');
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [status, setStatus] = useState<'idle' | 'checking' | 'err'>('idle');
  const [scanned, setScanned] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();

  const reset = () => {
    setLabel(''); setUrl(''); setToken('');
    setStatus('idle'); setScanned(false); setTab('manual');
  };

  const handleAdd = async (overrideUrl?: string, overrideToken?: string) => {
    const finalUrl = (overrideUrl ?? url).trim();
    const finalToken = (overrideToken ?? token).trim();
    if (!label.trim() || !finalUrl || !finalToken) return;
    setStatus('checking');
    try {
      const client = getEndpointClient(finalUrl, finalToken);
      await client.get('/api/v1/healthz');
      onAdd(label.trim(), finalUrl, finalToken);
      reset();
      onClose();
    } catch {
      setStatus('err');
    }
  };

  // Parse multisoul://pair?url=...&token=...
  const handleBarCodeScanned = ({ data }: { data: string }) => {
    if (scanned) return;
    setScanned(true);
    try {
      const parsed = new URL(data);
      if (parsed.protocol !== 'multisoul:') { setStatus('err'); return; }
      const scannedUrl = parsed.searchParams.get('url') ?? '';
      const scannedToken = parsed.searchParams.get('token') ?? '';
      setUrl(scannedUrl);
      setToken(scannedToken);
      setTab('manual'); // switch to manual tab to show filled fields + label input
    } catch {
      setStatus('err');
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.overlay}>
        <View style={s.card}>
          <Text style={s.heading}>ADD ENDPOINT</Text>

          {/* Tab switcher */}
          <View style={s.tabs}>
            <TouchableOpacity
              style={[s.tab, tab === 'manual' && s.tabActive]}
              onPress={() => setTab('manual')}
            >
              <Text style={[s.tabText, tab === 'manual' && s.tabTextActive]}>MANUAL</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.tab, tab === 'qr' && s.tabActive]}
              onPress={() => {
                setScanned(false);
                setStatus('idle');
                if (!permission?.granted) requestPermission();
                setTab('qr');
              }}
            >
              <Text style={[s.tabText, tab === 'qr' && s.tabTextActive]}>SCAN QR</Text>
            </TouchableOpacity>
          </View>

          {tab === 'manual' ? (
            <>
              <Text style={s.fieldLabel}>LABEL</Text>
              <TextInput
                style={s.input} value={label} onChangeText={setLabel}
                placeholder="Home Server" placeholderTextColor="#2D8B2D"
                autoCapitalize="none"
              />
              <Text style={s.fieldLabel}>URL</Text>
              <TextInput
                style={s.input} value={url}
                onChangeText={(v) => { setUrl(v); setStatus('idle'); }}
                placeholder="http://192.168.1.x:8765" placeholderTextColor="#2D8B2D"
                autoCapitalize="none" keyboardType="url"
              />
              <Text style={s.fieldLabel}>TOKEN</Text>
              <TextInput
                style={s.input} value={token}
                onChangeText={(v) => { setToken(v); setStatus('idle'); }}
                placeholder="ms_v2_..." placeholderTextColor="#2D8B2D"
                autoCapitalize="none" secureTextEntry
              />
              {status === 'err' && (
                <Text style={s.errText}>CANNOT REACH ENDPOINT — CHECK URL AND TOKEN</Text>
              )}
              <View style={s.actions}>
                <TouchableOpacity style={s.btnSecondary} onPress={() => { reset(); onClose(); }}>
                  <Text style={s.btnSecondaryText}>CANCEL</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={s.btnPrimary} onPress={() => handleAdd()}
                  disabled={status === 'checking'}
                >
                  {status === 'checking'
                    ? <ActivityIndicator size="small" color="#040D04" />
                    : <Text style={s.btnPrimaryText}>CONNECT</Text>}
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <View style={s.cameraWrap}>
              {permission?.granted ? (
                <CameraView
                  style={s.camera}
                  barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                  onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
                />
              ) : (
                <TouchableOpacity style={s.permBtn} onPress={requestPermission}>
                  <Text style={s.permText}>TAP TO ALLOW CAMERA</Text>
                </TouchableOpacity>
              )}
              {status === 'err' && (
                <Text style={s.errText}>INVALID QR CODE</Text>
              )}
              <TouchableOpacity style={s.btnSecondary} onPress={() => { reset(); onClose(); }}>
                <Text style={s.btnSecondaryText}>CANCEL</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay:          { flex: 1, backgroundColor: 'rgba(4,13,4,0.92)',
                      alignItems: 'center', justifyContent: 'center', padding: 24 },
  card:             { width: '100%', backgroundColor: '#061206',
                      borderWidth: 1, borderColor: '#0F2B0F', borderRadius: 2,
                      padding: 20, gap: 8 },
  heading:          { fontFamily: 'Anton', fontSize: 16, color: '#20C20E',
                      letterSpacing: 2, marginBottom: 4 },
  tabs:             { flexDirection: 'row', gap: 4, marginBottom: 4 },
  tab:              { flex: 1, height: 32, alignItems: 'center', justifyContent: 'center',
                      borderWidth: 1, borderColor: '#0F2B0F', borderRadius: 2 },
  tabActive:        { borderColor: '#20C20E', backgroundColor: '#0A1A0A' },
  tabText:          { fontFamily: 'Inter', fontSize: 11, color: '#2D8B2D', letterSpacing: 1 },
  tabTextActive:    { color: '#20C20E' },
  fieldLabel:       { fontFamily: 'Inter', fontSize: 11, color: '#2D8B2D', letterSpacing: 1 },
  input:            { height: 40, backgroundColor: '#0A1A0A', borderWidth: 1,
                      borderColor: '#0F2B0F', borderRadius: 2, paddingHorizontal: 12,
                      fontFamily: 'Geist', fontSize: 14, color: '#20C20E' },
  errText:          { fontFamily: 'Inter', fontSize: 11, color: '#FF4444', letterSpacing: 0.5 },
  actions:          { flexDirection: 'row', gap: 8, marginTop: 4 },
  btnPrimary:       { flex: 1, height: 40, backgroundColor: '#20C20E',
                      alignItems: 'center', justifyContent: 'center', borderRadius: 2 },
  btnPrimaryText:   { fontFamily: 'Anton', fontSize: 13, color: '#040D04', letterSpacing: 1 },
  btnSecondary:     { flex: 1, height: 40, borderWidth: 1, borderColor: '#0F2B0F',
                      alignItems: 'center', justifyContent: 'center', borderRadius: 2 },
  btnSecondaryText: { fontFamily: 'Anton', fontSize: 13, color: '#2D8B2D', letterSpacing: 1 },
  cameraWrap:       { gap: 8 },
  camera:           { width: '100%', height: 220, borderRadius: 2 },
  permBtn:          { height: 220, backgroundColor: '#0A1A0A', borderWidth: 1,
                      borderColor: '#0F2B0F', borderRadius: 2,
                      alignItems: 'center', justifyContent: 'center' },
  permText:         { fontFamily: 'Inter', fontSize: 12, color: '#2D8B2D', letterSpacing: 1 },
});
```

- [ ] **Step 2: 验证 typecheck 通过**

```bash
cd mobile && pnpm typecheck 2>&1 | tail -5
```

Expected: 无新增错误。

- [ ] **Step 3: Commit**

```bash
git add mobile/src/features/settings/components/AddEndpointModal.tsx
git commit -m "feat: AddEndpointModal — add QR scan tab for multisoul://pair pairing"
```

---

## Task 6: Inbox pending_question 内联回答

**Files:**
- Modify: `mobile/src/features/inbox/components/InboxScreen.tsx`
- Modify: `mobile/app/(tabs)/inbox.tsx`

**背景：** 当 inbox item 的 `kind === 'pending_question'` 且 `payload` 不为 null 时，展开显示 `AskQuestionCard`，用户可以直接在 Inbox 界面回答，无需跳转到 Chat。回答通过 REST `POST /api/v1/conversations/{id}/messages` 发送（type: answer）。

- [ ] **Step 1: 修改 inbox.tsx，传入 sendAnswer 回调**

将 `mobile/app/(tabs)/inbox.tsx` 完整替换为：

```tsx
import React from 'react';
import { SafeAreaView, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useInboxStore } from '@/store/inboxStore';
import { useEndpointStore } from '@/store/endpointStore';
import InboxScreen from '@/features/inbox/components/InboxScreen';
import { InboxItem } from '@/types';
import { getEndpointClient } from '@/api/endpointClient';

export default function InboxTab() {
  const items = useInboxStore((s) => s.items);
  const markRead = useInboxStore((s) => s.markRead);
  const endpoints = useEndpointStore((s) => s.endpoints);
  const router = useRouter();

  const handleOpen = (item: InboxItem) => {
    markRead(item.id);
    if (item.conversation_id) {
      router.push(`/chat/${item.conversation_id}?endpoint_id=${item.endpoint_id}` as any);
    }
  };

  const handleAnswer = async (
    item: InboxItem,
    ask_id: string,
    choice_id?: string,
    freeform?: string
  ) => {
    const ep = endpoints.find((e) => e.id === item.endpoint_id);
    if (!ep) return;
    const client = getEndpointClient(ep.base_url, ep.token);
    try {
      await client.post(`/api/v1/conversations/${item.conversation_id}/messages`, {
        type: 'answer', ask_id, choice_id, freeform,
      });
      markRead(item.id);
    } catch { /* ignore */ }
  };

  return (
    <SafeAreaView style={s.safe}>
      <InboxScreen items={items} onOpen={handleOpen} onAnswer={handleAnswer} />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#040D04' },
});
```

- [ ] **Step 2: 修改 InboxScreen.tsx，支持 pending_question 内联回答**

将 `mobile/src/features/inbox/components/InboxScreen.tsx` 完整替换为：

```tsx
import React, { useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { CircleCheck, Info } from 'lucide-react-native';
import { InboxItem, AskQuestionPayload } from '@/types';
import AskQuestionCard from '@/features/chat/components/AskQuestionCard';

interface Props {
  items: InboxItem[];
  onOpen: (item: InboxItem) => void;
  onAnswer: (item: InboxItem, ask_id: string, choice_id?: string, freeform?: string) => void;
}

export default function InboxScreen({ items, onOpen, onAnswer }: Props) {
  const unreadCount = items.filter((i) => !i.read_at).length;
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <View style={s.root}>
      <View style={s.header}>
        <View>
          <Text style={s.headerTitle}>INBOX</Text>
          <Text style={[s.headerSub, { color: unreadCount > 0 ? '#FFB000' : '#2D8B2D' }]}>
            {unreadCount > 0 ? `${unreadCount} UNREAD` : 'ALL CAUGHT UP'}
          </Text>
        </View>
      </View>

      {items.length === 0 ? (
        <View style={s.emptyBody}>
          <View style={s.emptyIconWrap}>
            <CircleCheck size={36} color="#33FF33" />
          </View>
          <Text style={s.emptyTitle}>ALL CAUGHT UP!</Text>
          <Text style={s.emptyDesc}>No messages from your agents.</Text>
          <View style={s.infoBox}>
            <View style={s.infoRow}>
              <Info size={14} color="#2D8B2D" />
              <Text style={s.infoText}>
                You will be notified when an agent needs your input.
              </Text>
            </View>
          </View>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={s.list}
          renderItem={({ item }) => {
            const unread = item.read_at === null;
            const isPendingQuestion = item.kind === 'pending_question' && item.payload !== null;
            const isExpanded = expandedId === item.id;

            return (
              <View style={s.rowWrap}>
                <TouchableOpacity
                  style={s.row}
                  onPress={() => {
                    if (isPendingQuestion) {
                      setExpandedId(isExpanded ? null : item.id);
                    } else {
                      onOpen(item);
                    }
                  }}
                >
                  <View style={[s.unreadBar, { backgroundColor: unread ? '#20C20E' : 'transparent' }]} />
                  <View style={s.content}>
                    <Text style={s.title}>{item.title}</Text>
                    <Text style={s.body} numberOfLines={isExpanded ? undefined : 2}>{item.body}</Text>
                    <Text style={s.time}>{new Date(item.received_at).toLocaleString()}</Text>
                    {isPendingQuestion && (
                      <Text style={s.tapHint}>{isExpanded ? 'TAP TO COLLAPSE' : 'TAP TO ANSWER'}</Text>
                    )}
                  </View>
                </TouchableOpacity>

                {isPendingQuestion && isExpanded && item.payload && (
                  <View style={s.askWrap}>
                    <AskQuestionCard
                      question={(item.payload as AskQuestionPayload).prompt}
                      options={(item.payload as AskQuestionPayload).options}
                      onCancel={() => setExpandedId(null)}
                      onConfirm={(choice_id) => {
                        onAnswer(item, (item.payload as AskQuestionPayload).ask_id, choice_id);
                        setExpandedId(null);
                      }}
                    />
                  </View>
                )}
              </View>
            );
          }}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root:          { flex: 1, backgroundColor: '#040D04' },
  header:        { height: 52, backgroundColor: '#061206', flexDirection: 'row',
                   alignItems: 'center', paddingHorizontal: 16,
                   borderBottomWidth: 1, borderBottomColor: '#0F2B0F' },
  headerTitle:   { fontFamily: 'Anton', fontSize: 20, color: '#20C20E' },
  headerSub:     { fontFamily: 'Inter', fontSize: 11, letterSpacing: 1.5 },
  list:          { padding: 16, gap: 8 },
  rowWrap:       { gap: 0 },
  row:           { flexDirection: 'row', backgroundColor: '#061206',
                   borderWidth: 1, borderColor: '#0F2B0F', borderRadius: 2 },
  unreadBar:     { width: 2 },
  content:       { flex: 1, padding: 12, gap: 4 },
  title:         { fontFamily: 'Anton', fontSize: 13, color: '#20C20E', letterSpacing: 1 },
  body:          { fontFamily: 'Geist', fontSize: 13, color: '#147A16', lineHeight: 18 },
  time:          { fontFamily: 'Inter', fontSize: 11, color: '#0F6B0F' },
  tapHint:       { fontFamily: 'Inter', fontSize: 10, color: '#20C20E', letterSpacing: 1 },
  askWrap:       { backgroundColor: '#061206', borderWidth: 1, borderTopWidth: 0,
                   borderColor: '#0F2B0F', borderBottomLeftRadius: 2, borderBottomRightRadius: 2,
                   padding: 12 },
  emptyBody:     { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  emptyIconWrap: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#061206',
                   borderWidth: 1, borderColor: '#0F2B0F',
                   alignItems: 'center', justifyContent: 'center' },
  emptyTitle:    { fontFamily: 'Anton', fontSize: 24, color: '#20C20E' },
  emptyDesc:     { fontFamily: 'Geist', fontSize: 14, color: '#147A16',
                   textAlign: 'center', maxWidth: 260 },
  infoBox:       { backgroundColor: '#061206', borderRadius: 2, borderWidth: 1,
                   borderColor: '#0F2B0F', padding: 16, width: '100%' },
  infoRow:       { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  infoText:      { fontFamily: 'Inter', fontSize: 12, color: '#2D8B2D', flex: 1, lineHeight: 18 },
});
```

- [ ] **Step 3: 验证 typecheck 通过**

```bash
cd mobile && pnpm typecheck 2>&1 | tail -5
```

Expected: 无新增错误。

- [ ] **Step 4: Commit**

```bash
git add mobile/src/features/inbox/components/InboxScreen.tsx mobile/app/(tabs)/inbox.tsx
git commit -m "feat: Inbox pending_question inline answer without navigating to Chat"
```

---

## 自检

**Spec 覆盖：**
- ✅ Task 1: chat/[id].tsx Zustand 无限循环 bug
- ✅ Task 2: Chat Tab 加载真实 conversations
- ✅ Task 3+4: Runtime Adapter（spawn claude，解析 stream-json，广播 WS）
- ✅ Task 5: QR 扫码配对（multisoul://pair?url=...&token=...）
- ✅ Task 6: Inbox pending_question 内联回答

**执行顺序依赖：**
- Task 3 必须在 Task 4 之前（runtime.rs 先创建，messages.rs 才能 import）
- 其余 Task 相互独立，可并行
