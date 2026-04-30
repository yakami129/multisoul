# MultiSoul Runtime 长驻进程重构计划

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 runtime adapter 从「每轮新建 claude 进程」改为「每个 conversation 一个长驻 claude 进程」，解决第二轮对话无响应的根本问题。

**Architecture:**
- `AppState` 新增 `sessions: SessionMap`（`Arc<Mutex<HashMap<conv_id, std::sync::mpsc::Sender<String>>>>`）
- 每个 conversation 对应一个 `spawn_blocking` 工作线程，持有 claude 子进程的 stdin/stdout/BufReader
- 工作线程循环：`rx.recv()` 等待消息 → 写 stdin → 读 stdout 直到 `result` 事件 → 循环
- 崩溃恢复：进程退出时用 `--resume <session_id>` 重新 spawn，重发当前消息
- `claude_session_id` 持久化到 DB（conversations 表已有该列）

**Tech Stack:** Rust, tokio, std::sync::mpsc, rusqlite, serde_json

---

### Task 1: 更新 AppState — 添加 sessions 字段

**Files:**
- Modify: `cli/src/serve/state.rs`

- [x] **Step 1: 替换 state.rs**
- [x] **Step 2: `cargo build` 验证**

---

### Task 2: 完全重写 runtime.rs — 长驻进程 session worker

**Files:**
- Modify: `cli/src/serve/runtime.rs`

- [x] **Step 1: 完全替换 runtime.rs**
- [x] **Step 2: `cargo build` 验证**

---

### Task 3: 更新 messages.rs — 改用 send_to_session

**Files:**
- Modify: `cli/src/serve/routes/messages.rs`

- [ ] **Step 1: 将 `runtime::run_agent_turn(...)` 替换为 `runtime::send_to_session(...)`**
- [ ] **Step 2: `cargo build` + `cargo test` 验证**

---

### Task 2: 完全重写 runtime.rs — 长驻进程 session worker

**Files:**
- Modify: `cli/src/serve/runtime.rs`

**设计：**
- `send_to_session(state, conv_id, user_text, project_path)` — 对外接口，替换原来的 `run_agent_turn`
  - 如果 conv_id 在 sessions map 中存在，直接 `tx.send(user_text)`
  - 否则创建 `std::sync::mpsc::channel`，插入 map，spawn_blocking 启动 session_worker，再 send 第一条消息
- `session_worker(state, conv_id, project_path, rx)` — 阻塞线程主循环
  - 从 DB 读取 `claude_session_id`（如有，用 `--resume`）
  - spawn claude 进程，保持 stdin/stdout 打开
  - 读 `system` 事件 → 保存 session_id 到 DB
  - 主循环：`rx.recv()` → 写 stdin → 读 stdout 直到 `result` → 更新 DB/广播
  - 崩溃恢复：进程退出时重新 spawn，重发当前消息（最多 3 次）

- [ ] **Step 1: 完全替换 runtime.rs**
- [ ] **Step 2: `cargo build` 验证**
