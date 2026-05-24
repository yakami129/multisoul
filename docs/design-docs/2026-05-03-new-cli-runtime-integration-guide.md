# 接入新 CLI Runtime 开发指南

> 文档类型：设计文档 · 操作指南  
> 创建日期：2026-05-03  
> 适用读者：熟悉 Rust / axum / tokio 的开发者

---

## 1. 概述

MultiSoul CLI（`msctl`）通过 **Runtime 适配层** 驱动 AI agent 子进程。当前内置两个 runtime：

| runtime 标识 | 实现文件 | 驱动的子进程 |
|---|---|---|
| `claude-code`（默认） | `cli/src/serve/runtime/claude.rs` | `claude` 可执行文件（Claude Code SDK） |
| `codex` | `cli/src/serve/runtime/codex.rs` | `codex` 可执行文件（OpenAI Codex CLI） |
| `cursor-cli` | `cli/src/serve/runtime/cursor.rs` | `agent`（Cursor Agent CLI，`CURSOR_AGENT_BIN` 可覆盖） |

本文档说明如何接入第三个（或更多）runtime，复用已有骨架，只需实现差异部分。

---

## 2. 架构速览

```
HTTP POST /api/v1/conversations/:id/messages
        │
        ▼
serve/routes/messages.rs          ← 解析请求，调用 runtime 分发
        │
        ▼
serve/runtime/mod.rs              ← send_to_session()，按 agent.runtime 字段 match
        │
        ├── "codex"       ──▶  codex.rs   :: send_to_session()
        ├── "cursor-cli"  ──▶  cursor.rs  :: send_to_session()
        └── _             ──▶  claude.rs  :: send_to_session()
```

每个 runtime 运行在 **独立的 blocking 线程**（`tokio::task::spawn_blocking`）中，通过 `std::sync::mpsc` 接收来自 HTTP handler 的消息，通过 `tokio::sync::broadcast` 向 WebSocket 客户端推送事件。运行中的子进程必须通过 `SessionHandle` 登记当前 pid；`POST /api/v1/conversations/:id/abort` 会移除该 handle 并终止对应进程组，避免 UI 停止按钮只断开队列却无法中断正在执行的 CLI runtime。

---

## 3. 核心数据结构

### 3.1 AppState（`serve/state.rs`）

```rust
pub struct AppState {
    pub db: Arc<Mutex<Connection>>,      // SQLite（agents / conversations / messages）
    pub token: String,                   // Bearer token
    pub uploads_dir: PathBuf,            // 文件上传目录
    pub bus: ConvBus,                    // conv_id → broadcast::Sender<String>（WS 推送）
    pub sessions: SessionMap,            // conv_id → SessionHandle（消息队列 + 当前 runtime pid）
    pub answer_txs: AnswerMap,           // conv_id → AnswerChannel（交互回答 channel + 当前 pending ask_id）
    pub plugin_manager: Arc<PluginManager>, // plugin agent 进程管理器
}
```

**关键约定：**
- `sessions` map 里若已有该 conv 的 `SessionHandle`，说明 worker 正在运行，直接 `handle.tx.send()` 即可。
- abort 路径：`SessionHandle::abort_current_process` 先置 cooperative `aborted` 标记，再对登记的 pid 调用 `kill_process_group`（Unix：`kill(-pgid, SIGKILL)`），失败时回退 `kill_single_process`。**Windows** 无 POSIX `kill`：单进程终止用 `TerminateProcess`；进程组级联杀仍仅在 Unix 上生效（与 `start_new_process_group` 对称）。该函数与 HTTP `abort` handler 均向 `target = "multisoul::abort"` 打结构化日志（`phase` + `outcome`：`no_registered_pid` / `kill_attempt` / `kill_ok_pid_cleared` / `kill_failed`），便于对照 `msctl logs` 判断是未登记 pid 还是 syscall 失败。
- sender 断裂（worker crash）时重建，这是唯一允许重建 worker 的时机。
- runtime 启动 CLI 子进程时应调用 `start_new_process_group(&mut command)`，并在 turn 开始时 `handle.set_current_pid(child.id())`；abort 才能杀掉父进程及其派生子进程。
- 交互式回答不应只检查 runtime channel 是否存在；`AnswerChannel` 还记录当前 `pending_ask_id`，`send_answer` 只接受 ask id 匹配的 answer。runtime 在向 mobile 暴露 `ask_question` 之前必须先登记 pending ask，避免用户极快作答时被误判为 stale answer。
- `plugin_manager` 在 `msctl serve` 启动时初始化，加载 `plugin_agents` 表中所有已注册的 plugin agent 进程；serve 退出时调用 `shutdown()` 将状态写回 DB。

### 3.2 SessionMessage

```rust
pub struct SessionMessage {
    pub user_text: String,
    pub file_id: Option<String>,   // 上传文件 ID（可选）
}
```

`SessionHandle` 包含 `tx`、`current_pid` 和 abort 标记。handler 侧不要直接保存裸 `Sender`；否则只能阻止后续消息入队，无法停止已经阻塞在 `process_turn` 的 CLI 子进程。

---

## 4. 接入新 Runtime — 分步指南

### Step 1：创建 runtime 模块文件

在 `cli/src/serve/runtime/` 下新建 `<your_runtime>.rs`：

```rust
//! <YourRuntime> runtime adapter.
//! 驱动 `<your-cli> ...` 子进程。

use crate::serve::state::{AppState, SessionHandle};
use tracing::{debug, error, info, info_span, warn};

pub fn send_to_session(
    state: &AppState,
    conv_id: &str,
    user_text: &str,
    project_path: &str,
    // 根据需要增减参数，例如 mode: &str
) {
    let mut sessions = state.sessions.lock().unwrap();

    // 若 worker 已在运行，直接入队
    if let Some(handle) = sessions.get(conv_id) {
        if handle.tx.send(crate::serve::state::SessionMessage {
            user_text: user_text.to_string(),
            file_id: None,
        }).is_ok() {
            debug!(conv_id = %conv_id, "runtime_message_queued");
            return;
        }
        warn!(conv_id = %conv_id, "runtime_channel_broken_respawning");
    }

    // 首次或重建：创建新 channel + worker
    let (tx, rx) = std::sync::mpsc::channel::<crate::serve::state::SessionMessage>();
    let session_handle = SessionHandle::new(tx.clone());
    sessions.insert(conv_id.to_string(), session_handle.clone());
    drop(sessions); // 释放锁再 spawn

    let _ = tx.send(crate::serve::state::SessionMessage {
        user_text: user_text.to_string(),
        file_id: None,
    });

    let state2 = state.clone();
    let conv_id2 = conv_id.to_string();
    let project_path2 = project_path.to_string();

    tokio::task::spawn_blocking(move || {
        session_worker(state2, conv_id2, project_path2, rx, session_handle);
    });
}
```

> **为什么用 `spawn_blocking`？**  
> 子进程 I/O（`read_line` / `write_all`）是同步阻塞的。在 blocking 线程里跑不会阻塞 Tokio 异步运行时。

---

### Step 2：实现 session_worker

`session_worker` 是 runtime 的核心循环，负责：

1. 从 `rx` 读取用户消息
2. 启动 / 复用子进程
3. 写入 stdin → 读取 stdout → 解析事件
4. 通过 `insert_message` + `broadcast` 将事件推送给 mobile

**模板（参考 codex 风格）：**

```rust
fn session_worker(
    state: AppState,
    conv_id: String,
    project_path: String,
    rx: std::sync::mpsc::Receiver<crate::serve::state::SessionMessage>,
    session_handle: SessionHandle,
) {
    let span = info_span!("session_worker", conv_id = %conv_id, runtime = "<your_runtime>");
    let _enter = span.enter();
    info!("session_worker_started");

    loop {
        // 1. 等待下一条消息
        let msg = match rx.recv() {
            Ok(m) => m,
            Err(_) => {
                info!("session_channel_closed");
                return;
            }
        };

        // 2. 启动子进程（或复用预热进程）
        let (mut child, mut stdin) = match spawn_your_cli(&project_path) {
            Some(p) => p,
            None => {
                error!("agent_spawn_failed");
                mark_conv_failed(&state, &conv_id);
                continue;
            }
        };
        session_handle.set_current_pid(child.id());
        if session_handle.is_aborted() {
            return;
        }

        // 3. 写入 stdin
        use std::io::Write;
        let _ = writeln!(stdin, "{}", msg.user_text);
        drop(stdin); // 大多数 CLI 需要关闭 stdin 才会开始处理

        // 4. 读取 stdout，解析事件
        use std::io::BufRead;
        let stdout = child.stdout.take().unwrap();
        let reader = std::io::BufReader::new(stdout);
        for line in reader.lines() {
            let line = match line { Ok(l) => l, Err(_) => break };
            handle_output_line(&state, &conv_id, &line);
        }

        let _ = child.wait();
        session_handle.clear_current_pid(child.id());
    }
}
```

---

### Step 3：实现事件处理

每条输出行通常是一个 JSON 事件。解析后调用 `insert_message` 存库、`broadcast` 推送 WS：

```rust
fn handle_output_line(state: &AppState, conv_id: &str, line: &str) {
    let v: serde_json::Value = match serde_json::from_str(line) {
        Ok(v) => v,
        Err(_) => return, // 非 JSON 行忽略
    };

    match v["type"].as_str().unwrap_or("") {
        "text" => {
            let text = v["content"].as_str().unwrap_or("");
            let payload = serde_json::json!({ "text": text });
            let db = state.db.lock().unwrap();
            if let Ok(seq) = insert_message(&db, conv_id, "agent_text", &payload) {
                drop(db);
                broadcast(state, conv_id, seq, "agent_text", payload);
            }
        }
        "done" => {
            complete_conversation(state, conv_id, "completed");
        }
        "error" => {
            complete_conversation(state, conv_id, "failed");
        }
        _ => {}
    }
}
```

**mobile 能识别的 message role（`payload.role`）：**

| role | 含义 |
|---|---|
| `agent_text` | 普通文字回复 |
| `tool_call` | 工具调用（含 `tool`, `args`, `call_id`） |
| `tool_result` | 工具执行结果（含 `call_id`, `ok`, `summary`） |
| `ask_question` | 向用户提问（含 `questions` 数组） |
| `task_status` | 任务完成/失败（含 `status`, `summary`） |

**必须映射工具事件：**
如果底层 CLI 输出任何工具生命周期事件（例如 `tool_use`、`tool_call started/completed`、`command_execution`），runtime 不能忽略。必须至少转换为：

```rust
// 工具开始
serde_json::json!({ "tool": "Bash", "args": "pwd", "call_id": "tool-1" })
// role = "tool_call"

// 工具结束
serde_json::json!({ "call_id": "tool-1", "ok": true, "summary": "/repo" })
// role = "tool_result"
```

`call_id` 必须在同一次工具调用的 `tool_call` / `tool_result` 间保持一致；没有原生 ID 时用 `Uuid::new_v4()` 生成并在解析过程中保存。接入新 runtime 时需要为工具事件解析函数添加单元测试，覆盖“开始”和“完成/失败”两类事件。

---

### Step 4：注册到 mod.rs

打开 `cli/src/serve/runtime/mod.rs`，添加模块声明和 match arm。已知能原生接收图片的 runtime 应直接传递 `file_id`；不支持原生图片的 runtime 才使用 `inject_image_prefix`（该函数会将拼接后的路径里的 `\\` 换成 `/`，保证 Windows 上注入串仍与 Unix 一样可读）：

```rust
mod claude;
pub mod codex;
pub mod your_runtime;   // 新增

pub fn send_to_session(...) {
    match runtime {
        "codex" => {
            // Codex 支持 `codex exec ... - --image <path>`，由 codex adapter 消费 file_id。
            codex::send_to_session(state, conv_id, user_text, file_id, project_path, mode);
        }
        "cursor-cli" | "your-runtime" => {
            // file_id 在 dispatch 层转换为路径前缀注入到 prompt（inject_image_prefix）
            let effective_text = match file_id {
                Some(fid) => inject_image_prefix(user_text, fid, &state.uploads_dir),
                None => user_text.to_string(),
            };
            // 按 runtime 分发
            if runtime == "your-runtime" {
                your_runtime::send_to_session(state, conv_id, &effective_text, project_path);
            } else { /* cursor-cli */ }
        }
        _ => claude::send_to_session(state, conv_id, user_text, file_id, project_path),
    }
}
```

> **注意：** `claude` runtime 直接传递 `file_id` 以发送 base64 image block；`codex` runtime 直接传递 `file_id` 并在 adapter 内追加 `--image <path>`；不原生支持图片 content block / image flag 的 runtime（如 `cursor-cli` 及新接入的 runtime）才应加入路径前缀注入分支。

---

### Step 5：扩展 DB schema（按需）

若新 runtime 需要持久化额外状态（如会话 ID、线程 ID），在 `cli/src/db.rs` 的 `init_schema` 末尾用 **migration 方式** 添加字段，**不修改** `CREATE TABLE` 语句：

```rust
// 在 init_schema() 末尾追加 migration
let _ = conn.execute_batch(
    "ALTER TABLE conversations ADD COLUMN your_runtime_session_id TEXT;"
);
```

> **规则**：所有 schema 变更走 `ALTER TABLE … ADD COLUMN`，不允许在运行时 `DROP`/`CREATE TABLE`，确保向后兼容现有用户数据。

当前 schema 还包含 `ask_answers` 表，用于记录已经成功交付给 runtime 的 AskUserQuestion answer；HTTP message history 通过它恢复 `ask_question.answered` 状态。新 runtime 若支持交互式提问，应复用这张表作为后端权威 answered state。

---

### Step 6：扩展 agents 表的 runtime 枚举

`agents.runtime` 列当前接受任意字符串，无 CHECK 约束，直接插入即可。  
若需在 mobile 端展示新 runtime，在 `mobile/src/types.ts` 的 `Agent` 类型里更新 `runtime` 字段的字面量联合类型。

---

## 5. Claude Code 实现要点（供参考）

Claude Code 使用 **JSON stream protocol**，每行一个 JSON 事件：

```
{"type":"system","session_id":"..."}
{"type":"assistant","message":{"content":[{"type":"text","text":"..."}]}}
{"type":"control_request","request_id":"...","request":{"tool_name":"AskUserQuestion","input":{...}}}
{"type":"result","is_error":false,"result":"..."}
```

关键差异点：
- **`control_request`**：Claude Code 会先发 `control_request` 请求 tool 权限，runtime 必须回写 `control_response` 才能继续。`AskUserQuestion` 在此阶段拦截并等待 mobile 用户作答。
- **`claude_session_id`**：第一条 `system` 事件携带 `session_id`，存入 DB 后用于会话恢复（`--resume`）。
- **stdin 协议**：用户消息以 JSON lines 写入，格式见 `claude_io.rs`。

---

## 6. Codex 实现要点（供参考）

Codex 使用 `codex exec` / `codex exec resume <thread_id>` 命令；`full-auto` / `auto-edit` 模式会把 sandbox 与 approval 作为 Codex 顶层参数放在 `exec` 前：

- **线程 ID**：第一轮执行后会拿到 `codex_thread_id`，后续 resume 时传入。
- **预热（pre-warm）**：每轮成功后立即在后台 spawn 下一个 `codex exec resume` 进程，抵消 Node.js 启动延迟。
- **图片输入**：带 `file_id` 的 turn 使用 `codex exec ... - --image <uploads_dir/file_id>` 或 `codex exec resume ... - --image <uploads_dir/file_id>`。`--image` 放在 stdin marker `-` 之后，避免 Codex CLI 的可变图片参数吞掉 prompt marker。若当前消息带图且已有无图 pre-warmed 进程，先丢弃预热进程再重新 spawn 带 `--image` 的进程。
- **模式标志**：`mode` 字段映射到 Codex CLI 顶层参数；fresh 与 resume 的 `full-auto` / `auto-edit` 都使用 `codex -s danger-full-access -a never exec ...`，避免交互式审批阻塞；`yolo` 映射到 `--dangerously-bypass-approvals-and-sandbox`（见 `codex::mode_flags()` / `codex::resume_mode_flags()`）。
- **重试**：失败时最多重试 3 次；若遇到 `"thread ... not found"` 错误，清空 `codex_thread_id` 重新开始。
- **单测位置**：`codex.rs` 旁的 `codex_tests.rs`（`#[path = "codex_tests.rs"] mod tests`），用于满足仓库单文件行数上限。

---

## 7. 常见陷阱

| 陷阱 | 原因 | 解决方法 |
|---|---|---|
| 有工具执行但 mobile 不显示 | runtime 只处理最终文本/结果，忽略了 CLI 的工具事件 | 先用真实 CLI 跑 `--output-format stream-json` 观察 stdout schema，再把工具 started/completed 映射成 `tool_call` / `tool_result` |
| 死锁：先锁 `db` 再锁 `sessions` | 两把锁顺序不一致 | 统一按 `sessions → db` 顺序；或 `drop()` 后再取下一把锁 |
| Worker crash 但 sessions map 未清理 | sender 变悬空 | 检测到 `tx.send()` 失败时重建 worker（参考两个 runtime 的模板） |
| 停止按钮只让 UI 变 idle，但 CLI 仍在跑 | abort 只删除 sender，未 kill 当前子进程 | `sessions` 保存 `SessionHandle`，runtime 登记 pid，spawn 时创建独立 process group，abort 时 kill 进程组 |
| `spawn_blocking` 里调用 `.await` | blocking 线程不能 await | 所有 DB 和 I/O 操作使用同步 API |
| stdin 未关闭导致子进程挂起 | 很多 CLI 等 EOF 才开始处理 | 写完后 `drop(stdin)` 或显式 close |
| broadcast channel 已无接收者 | WS 断开后 send 返回 0 | 正常情况，用 `unwrap_or(0)` 忽略 |

---

## 8. 验证清单

> **2026-05-03 更新**：`cursor.rs` 中 `match "system"` arm 改为 guard pattern（`"system" if … =>`），消除 Clippy `collapsible_match` 警告，逻辑不变。
>
> **2026-05-04**：`cursor.rs` 与 `cli/src/db.rs` 后续变更已与本文档及 `docs/design-docs/index.json` 中的 doc-code-hash 跟踪项同步。
>
> **2026-05-10**：`AppState` 新增 `plugin_manager: Arc<PluginManager>` 字段，用于管理 plugin agent 进程生命周期。`cli/src/db.rs` 新增 `plugin_agents` 表 migration（id/name/version/executable/status/restart_count/installed_at/updated_at），`agents` 表零改动。
>
> **2026-05-13**：`sessions` 从裸 `mpsc::Sender<SessionMessage>` 升级为 `SessionHandle`，用于同时保存消息队列、当前 runtime 子进程 pid 和 abort 标记。Claude / Codex / Cursor runtime 启动子进程时创建独立 process group，abort endpoint 会通过 `SessionHandle` 终止正在执行的进程组。相关回归测试拆分到相邻 `*_tests.rs` 文件，避免 runtime 主文件超过单文件行数上限。
>
> **2026-05-23**：`SessionHandle::abort_current_process` 与 `POST .../abort` 增加 `multisoul::abort` 结构化 tracing（无数据结构变更）；用于区分「仅 cooperative abort、未登记 pid」与「已发 SIGKILL / kill 失败」。
>
> **2026-05-23**：Activity DB-backed 方案引入 `ask_answers` 作为 AskUserQuestion answered state，并让 `AnswerMap` 持有 `pending_ask_id`。Claude runtime 在写入/广播 `ask_question` 前登记 pending ask；`GET /api/v1/conversations/:id/messages` 对 ask_question 返回 backend answered 字段，避免 mobile 本地状态丢失后重复回答。
>
> **2026-05-23**：Cursor runtime 为满足单文件行数上限，将 session 持久化、message insert、broadcast、complete/failed turn 状态更新 helper 拆到相邻 `cursor_db.rs`；`cursor.rs` 仍保留 runtime worker、process turn 和 CLI 参数构造。
>
> **2026-05-24**：`cli/src/db.rs` 新增 `activity_reads` 表（conversation_id → read_at），供 Activity Done 已读状态持久化；与 runtime 接入无关，本文 §Step 5 纪律不变。

完成实现后，按 `CLAUDE.md §5` 跑：

```bash
cd cli && cargo check          # 编译检查
cd cli && cargo test           # 单元测试

# 集成验证（本地）
cargo run -- serve &
# 在 DB 里插一条 runtime="your-runtime" 的 agent
# 发一条会触发工具调用的消息（如要求运行 pwd）
# 确认 WS 顺序至少包含 user_text → tool_call → tool_result → agent_text → task_status
```

移动端适配（如有）：

```bash
cd mobile && pnpm typecheck
cd mobile && pnpm test -- --watchAll=false
```
