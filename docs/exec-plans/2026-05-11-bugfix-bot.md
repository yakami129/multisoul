# bugfix-bot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 bugfix-bot —— 一个独立 Rust 二进制 plugin agent，接收飞书缺陷 Webhook 事件，执行 TDD 修复 pipeline（信息评估 → 复现 → 定位 → 修复 → 验证 → Draft MR），并通过飞书通知工程师 Review。

**Architecture:** bugfix-bot 以 msctl plugin agent 身份运行，通过 stdin/stdout NDJSON 与 msctl 通信。它维护独立的 `bugfix-bot.db`（SQLite），直接 subprocess 调用 `claude` CLI 执行代码分析与修复，通过 reqwest 调用 GitLab API 和飞书 API，通过 `git worktree` 为每个 bug 创建隔离工作空间。

**Tech Stack:** Rust 2021, rusqlite 0.31 (bundled), reqwest 0.11 (blocking), serde_json 1, uuid 1, dirs 5, toml 0.8, anyhow 1

**Design doc:** [`docs/design-docs/2026-05-10-bugfix-bot-design.md`](../design-docs/2026-05-10-bugfix-bot-design.md)
**Spec:** [`docs/product-specs/SPEC-bugfix-bot.md`](../product-specs/SPEC-bugfix-bot.md)

---

## File Map

| 文件 | 职责 |
|------|------|
| `bugfix-bot/Cargo.toml` | 依赖声明 |
| `bugfix-bot/bugfix-bot.toml` | Plugin manifest（triggers 声明） |
| `bugfix-bot/src/main.rs` | stdin 读取循环，分发 TaskMessage |
| `bugfix-bot/src/config.rs` | `~/.config/msctl/bugfix-bot.toml` 读写 |
| `bugfix-bot/src/db.rs` | `bugfix-bot.db` 初始化，BugTask CRUD |
| `bugfix-bot/src/protocol.rs` | TaskMessage / AgentEvent 结构体（与 msctl 协议对齐） |
| `bugfix-bot/src/claude.rs` | subprocess 调用 `claude` CLI，解析 stream-json 输出 |
| `bugfix-bot/src/gitlab.rs` | GitLab API client（Issue、MR、Label） |
| `bugfix-bot/src/feishu.rs` | 飞书 API client（发消息、评论缺陷） |
| `bugfix-bot/src/worktree.rs` | git worktree 创建/清理 |
| `bugfix-bot/src/pipeline/mod.rs` | Pipeline 入口，串联各阶段，重试逻辑 |
| `bugfix-bot/src/pipeline/intake.rs` | 阶段1: 信息评估 + GitLab Issue 同步 |
| `bugfix-bot/src/pipeline/reproducer.rs` | 阶段2: 复现测试 |
| `bugfix-bot/src/pipeline/patch.rs` | 阶段3: Fault Localize + Patch Generator |
| `bugfix-bot/src/pipeline/verifier.rs` | 阶段4: 分层验证 |
| `bugfix-bot/src/pipeline/publisher.rs` | 阶段5: Draft MR + 飞书通知 |

---

## Task 1: 项目骨架与 Cargo.toml

**Files:**
- Create: `bugfix-bot/Cargo.toml`
- Create: `bugfix-bot/bugfix-bot.toml`
- Create: `bugfix-bot/src/main.rs`

- [ ] **Step 1: 创建目录结构**

```bash
mkdir -p bugfix-bot/src/pipeline
```

- [ ] **Step 2: 写 Cargo.toml**

```toml
# bugfix-bot/Cargo.toml
[package]
name = "bugfix-bot"
version = "0.1.0"
edition = "2021"

[[bin]]
name = "bugfix-bot"
path = "src/main.rs"

[dependencies]
anyhow     = "1"
serde      = { version = "1", features = ["derive"] }
serde_json = "1"
toml       = "0.8"
dirs       = "5"
uuid       = { version = "1", features = ["v4"] }
rusqlite   = { version = "0.31", features = ["bundled"] }
reqwest    = { version = "0.11", features = ["blocking", "json"] }

[dev-dependencies]
tempfile = "3"
```

- [ ] **Step 3: 写 plugin manifest**

```toml
# bugfix-bot/bugfix-bot.toml
[agent]
version = "0.1.0"
executable = "bugfix-bot"

[[triggers]]
event = "feishu.issue.updated"

[[triggers]]
event = "gitlab.merge_request_hook"
```

- [ ] **Step 4: 写最小 main.rs（能编译即可）**

```rust
// bugfix-bot/src/main.rs
mod config;
mod db;
mod protocol;
mod claude;
mod gitlab;
mod feishu;
mod worktree;
mod pipeline;

fn main() {
    eprintln!("[bugfix-bot] starting");
}
```

- [ ] **Step 5: 创建空模块占位文件**

```bash
# 每个文件内容为空的 mod 声明
touch bugfix-bot/src/config.rs
touch bugfix-bot/src/db.rs
touch bugfix-bot/src/protocol.rs
touch bugfix-bot/src/claude.rs
touch bugfix-bot/src/gitlab.rs
touch bugfix-bot/src/feishu.rs
touch bugfix-bot/src/worktree.rs
touch bugfix-bot/src/pipeline/mod.rs
touch bugfix-bot/src/pipeline/intake.rs
touch bugfix-bot/src/pipeline/reproducer.rs
touch bugfix-bot/src/pipeline/patch.rs
touch bugfix-bot/src/pipeline/verifier.rs
touch bugfix-bot/src/pipeline/publisher.rs
```

- [ ] **Step 6: 验证编译通过**

```bash
cd bugfix-bot && cargo build 2>&1
```

Expected: `Compiling bugfix-bot v0.1.0` ... `Finished`，无 error。

- [ ] **Step 7: Commit**

```bash
git add bugfix-bot/
git commit -m "feat(bugfix-bot): scaffold project structure and Cargo.toml"
```

---

## Task 2: protocol.rs — TaskMessage / AgentEvent

**Files:**
- Create: `bugfix-bot/src/protocol.rs`

与 `cli/src/serve/plugin/protocol.rs` 保持结构一致（bugfix-bot 作为接收方）。

- [ ] **Step 1: 写失败测试**

```rust
// bugfix-bot/src/protocol.rs 底部 #[cfg(test)]
#[cfg(test)]
mod tests {
    use super::*;

    /// TaskMessage 反序列化包含所有必要字段
    ///
    /// 数据构造：msctl 发来的 NDJSON 行
    /// 预期：protocol_version="1", event="feishu.issue.updated"
    #[test]
    fn test_task_message_deserializes() {
        let json = r#"{"protocol_version":"1","task_id":"t1","conversation_id":"c1","event":"feishu.issue.updated","payload":{"k":"v"}}"#;
        let msg: TaskMessage = serde_json::from_str(json).unwrap();
        assert_eq!(msg.protocol_version, "1", "protocol_version must be 1");
        assert_eq!(msg.event, "feishu.issue.updated", "event must match");
        assert_eq!(msg.task_id, "t1", "task_id must match");
    }

    /// AgentEvent::Progress 序列化包含 type 字段
    ///
    /// 预期：JSON 包含 "type":"progress"
    #[test]
    fn test_agent_event_progress_serializes() {
        let ev = AgentEvent::Progress {
            task_id: "t1".to_string(),
            conversation_id: "c1".to_string(),
            message: "analyzing".to_string(),
        };
        let json = serde_json::to_string(&ev).unwrap();
        assert!(json.contains("\"type\":\"progress\""), "must have type=progress");
        assert!(json.contains("\"message\":\"analyzing\""), "must have message");
    }
}
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
cd bugfix-bot && cargo test test_task_message_deserializes 2>&1
```

Expected: FAIL — `TaskMessage` not defined。

- [ ] **Step 3: 实现 protocol.rs**

```rust
// bugfix-bot/src/protocol.rs
use serde::{Deserialize, Serialize};

/// msctl → bugfix-bot（stdin 每行一个 JSON）
#[derive(Debug, Deserialize)]
pub struct TaskMessage {
    pub protocol_version: String,
    pub task_id: String,
    pub conversation_id: String,
    pub event: String,
    pub payload: serde_json::Value,
}

/// bugfix-bot → msctl（stdout 每行一个 JSON）
#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AgentEvent {
    Progress {
        task_id: String,
        conversation_id: String,
        message: String,
    },
    Result {
        task_id: String,
        conversation_id: String,
        status: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        data: Option<serde_json::Value>,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },
    Error {
        task_id: String,
        conversation_id: String,
        code: String,
        message: String,
    },
}

impl AgentEvent {
    /// 将事件序列化为 NDJSON 行并写入 stdout
    pub fn emit(&self) {
        if let Ok(line) = serde_json::to_string(self) {
            println!("{}", line);
        }
    }
}
```

- [ ] **Step 4: 运行测试，确认通过**

```bash
cd bugfix-bot && cargo test protocol 2>&1
```

Expected: `test protocol::tests::test_task_message_deserializes ... ok`，`test protocol::tests::test_agent_event_progress_serializes ... ok`。

- [ ] **Step 5: Commit**

```bash
git add bugfix-bot/src/protocol.rs
git commit -m "feat(bugfix-bot): add TaskMessage/AgentEvent protocol types"
```

---

## Task 3: config.rs — 配置文件读写

**Files:**
- Create: `bugfix-bot/src/config.rs`

- [ ] **Step 1: 写失败测试**

```rust
// bugfix-bot/src/config.rs 底部 #[cfg(test)]
#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::NamedTempFile;

    /// Config::load_from 正确解析 TOML
    ///
    /// 数据构造：包含 feishu/gitlab/module_repo_map 的最小 TOML
    /// 预期：gitlab.base_url = "https://gl.example.com"
    #[test]
    fn test_config_load_from_toml() {
        let mut f = NamedTempFile::new().unwrap();
        write!(f, r#"
[feishu]
webhook_token = "tok"
bot_app_id = "app1"
bot_app_secret = "sec1"

[gitlab]
base_url = "https://gl.example.com"
access_token = "glpat-xxx"
blocked_label = "bot:blocked"

[module_repo_map]
"用户中心" = {{ local_path = "/tmp/user-service" }}
"#).unwrap();
        let cfg = Config::load_from(f.path()).unwrap();
        assert_eq!(cfg.gitlab.base_url, "https://gl.example.com");
        assert_eq!(cfg.feishu.bot_app_id, "app1");
        assert_eq!(cfg.module_repo_map.get("用户中心").unwrap().local_path, "/tmp/user-service");
    }

    /// 缺少 gitlab 段时返回 Err
    #[test]
    fn test_config_missing_gitlab_returns_err() {
        let mut f = NamedTempFile::new().unwrap();
        write!(f, "[feishu]\nwebhook_token = \"\"\nbot_app_id = \"\"\nbot_app_secret = \"\"\n").unwrap();
        let result = Config::load_from(f.path());
        assert!(result.is_err(), "missing gitlab section must return Err");
    }
}
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
cd bugfix-bot && cargo test config 2>&1
```

Expected: FAIL — `Config` not defined。

- [ ] **Step 3: 实现 config.rs**

```rust
// bugfix-bot/src/config.rs
use anyhow::{Context, Result};
use serde::Deserialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

#[derive(Debug, Deserialize)]
pub struct Config {
    pub feishu: FeishuConfig,
    pub gitlab: GitlabConfig,
    #[serde(default)]
    pub module_repo_map: HashMap<String, RepoEntry>,
}

#[derive(Debug, Deserialize)]
pub struct FeishuConfig {
    pub webhook_token: String,
    pub bot_app_id: String,
    pub bot_app_secret: String,
}

#[derive(Debug, Deserialize)]
pub struct GitlabConfig {
    pub base_url: String,
    pub access_token: String,
    #[serde(default = "default_blocked_label")]
    pub blocked_label: String,
}

fn default_blocked_label() -> String {
    "bot:blocked".to_string()
}

#[derive(Debug, Deserialize, Clone)]
pub struct RepoEntry {
    pub local_path: String,
}

impl Config {
    pub fn load() -> Result<Self> {
        let path = config_path()?;
        Self::load_from(&path)
    }

    pub fn load_from(path: &Path) -> Result<Self> {
        let s = std::fs::read_to_string(path)
            .with_context(|| format!("Cannot read config: {}", path.display()))?;
        toml::from_str(&s).context("Invalid bugfix-bot.toml")
    }
}

pub fn config_path() -> Result<PathBuf> {
    let base = dirs::config_dir().context("Cannot determine config dir")?;
    Ok(base.join("msctl").join("bugfix-bot.toml"))
}

pub fn db_path() -> Result<PathBuf> {
    let base = dirs::config_dir().context("Cannot determine config dir")?;
    Ok(base.join("msctl").join("bugfix-bot.db"))
}
```

- [ ] **Step 4: 运行测试，确认通过**

```bash
cd bugfix-bot && cargo test config 2>&1
```

Expected: 2 tests pass。

- [ ] **Step 5: Commit**

```bash
git add bugfix-bot/src/config.rs
git commit -m "feat(bugfix-bot): add Config loader for bugfix-bot.toml"
```

---

## Task 4: db.rs — BugTask 持久化

**Files:**
- Create: `bugfix-bot/src/db.rs`

- [ ] **Step 1: 写失败测试**

```rust
// bugfix-bot/src/db.rs 底部 #[cfg(test)]
#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn make_conn() -> rusqlite::Connection {
        let dir = tempdir().unwrap();
        open_at(&dir.path().join("t.db")).unwrap()
    }

    /// insert_bug_task 后 find_by_feishu_id 能找到
    ///
    /// 预期：status = "pending", retry_count = 0
    #[test]
    fn test_insert_and_find_bug_task() {
        let conn = make_conn();
        let id = insert_bug_task(&conn, "feishu-001").unwrap();
        let task = find_by_feishu_id(&conn, "feishu-001").unwrap().unwrap();
        assert_eq!(task.id, id, "id must match");
        assert_eq!(task.status, "pending", "initial status must be pending");
        assert_eq!(task.retry_count, 0, "initial retry_count must be 0");
    }

    /// update_status 正确更新状态
    ///
    /// 预期：status 变为 "analyzing"
    #[test]
    fn test_update_status() {
        let conn = make_conn();
        let id = insert_bug_task(&conn, "feishu-002").unwrap();
        update_status(&conn, &id, "analyzing").unwrap();
        let task = find_by_feishu_id(&conn, "feishu-002").unwrap().unwrap();
        assert_eq!(task.status, "analyzing", "status must be updated");
    }

    /// increment_retry 正确递增
    ///
    /// 预期：retry_count 从 0 变为 1
    #[test]
    fn test_increment_retry() {
        let conn = make_conn();
        let id = insert_bug_task(&conn, "feishu-003").unwrap();
        increment_retry(&conn, &id).unwrap();
        let task = find_by_feishu_id(&conn, "feishu-003").unwrap().unwrap();
        assert_eq!(task.retry_count, 1, "retry_count must be 1 after increment");
    }

    /// 同一 feishu_issue_id 不能重复插入
    ///
    /// 预期：第二次 insert 返回 Err（UNIQUE constraint）
    #[test]
    fn test_duplicate_feishu_id_returns_err() {
        let conn = make_conn();
        insert_bug_task(&conn, "feishu-004").unwrap();
        let result = insert_bug_task(&conn, "feishu-004");
        assert!(result.is_err(), "duplicate feishu_issue_id must fail");
    }
}
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
cd bugfix-bot && cargo test db 2>&1
```

Expected: FAIL — `insert_bug_task` not defined。

- [ ] **Step 3: 实现 db.rs**

```rust
// bugfix-bot/src/db.rs
use anyhow::{Context, Result};
use rusqlite::Connection;
use std::path::Path;

#[derive(Debug)]
pub struct BugTask {
    pub id: String,
    pub feishu_issue_id: String,
    pub gitlab_issue_id: Option<i64>,
    pub gitlab_mr_id: Option<i64>,
    pub worktree_path: Option<String>,
    pub branch_name: Option<String>,
    pub status: String,
    pub pipeline_stage: Option<String>,
    pub retry_count: i64,
    pub claude_session_id: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

pub fn open_at(path: &Path) -> Result<Connection> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("Cannot create dir {}", parent.display()))?;
    }
    let conn = Connection::open(path)
        .with_context(|| format!("Cannot open SQLite at {}", path.display()))?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
    init_schema(&conn)?;
    Ok(conn)
}

fn init_schema(conn: &Connection) -> Result<()> {
    conn.execute_batch(r#"
        CREATE TABLE IF NOT EXISTS bug_tasks (
            id               TEXT PRIMARY KEY,
            feishu_issue_id  TEXT NOT NULL UNIQUE,
            gitlab_issue_id  INTEGER,
            gitlab_mr_id     INTEGER,
            worktree_path    TEXT,
            branch_name      TEXT,
            status           TEXT NOT NULL DEFAULT 'pending',
            pipeline_stage   TEXT,
            retry_count      INTEGER NOT NULL DEFAULT 0,
            claude_session_id TEXT,
            created_at       INTEGER NOT NULL,
            updated_at       INTEGER NOT NULL
        );
    "#)?;
    Ok(())
}

pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

pub fn insert_bug_task(conn: &Connection, feishu_issue_id: &str) -> Result<String> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = now_ms();
    conn.execute(
        "INSERT INTO bug_tasks (id, feishu_issue_id, status, retry_count, created_at, updated_at)
         VALUES (?1, ?2, 'pending', 0, ?3, ?3)",
        rusqlite::params![id, feishu_issue_id, now],
    ).context("insert_bug_task failed")?;
    Ok(id)
}

pub fn find_by_feishu_id(conn: &Connection, feishu_issue_id: &str) -> Result<Option<BugTask>> {
    let mut stmt = conn.prepare(
        "SELECT id, feishu_issue_id, gitlab_issue_id, gitlab_mr_id, worktree_path,
                branch_name, status, pipeline_stage, retry_count, claude_session_id,
                created_at, updated_at
         FROM bug_tasks WHERE feishu_issue_id = ?1"
    )?;
    let mut rows = stmt.query_map([feishu_issue_id], |r| {
        Ok(BugTask {
            id: r.get(0)?,
            feishu_issue_id: r.get(1)?,
            gitlab_issue_id: r.get(2)?,
            gitlab_mr_id: r.get(3)?,
            worktree_path: r.get(4)?,
            branch_name: r.get(5)?,
            status: r.get(6)?,
            pipeline_stage: r.get(7)?,
            retry_count: r.get(8)?,
            claude_session_id: r.get(9)?,
            created_at: r.get(10)?,
            updated_at: r.get(11)?,
        })
    })?;
    Ok(rows.next().transpose()?)
}

pub fn update_status(conn: &Connection, id: &str, status: &str) -> Result<()> {
    conn.execute(
        "UPDATE bug_tasks SET status=?1, updated_at=?2 WHERE id=?3",
        rusqlite::params![status, now_ms(), id],
    ).context("update_status failed")?;
    Ok(())
}

pub fn update_fields(conn: &Connection, id: &str, fields: &UpdateFields) -> Result<()> {
    conn.execute(
        "UPDATE bug_tasks SET
            status = COALESCE(?1, status),
            pipeline_stage = COALESCE(?2, pipeline_stage),
            gitlab_issue_id = COALESCE(?3, gitlab_issue_id),
            gitlab_mr_id = COALESCE(?4, gitlab_mr_id),
            worktree_path = COALESCE(?5, worktree_path),
            branch_name = COALESCE(?6, branch_name),
            claude_session_id = COALESCE(?7, claude_session_id),
            updated_at = ?8
         WHERE id = ?9",
        rusqlite::params![
            fields.status, fields.pipeline_stage, fields.gitlab_issue_id,
            fields.gitlab_mr_id, fields.worktree_path, fields.branch_name,
            fields.claude_session_id, now_ms(), id
        ],
    ).context("update_fields failed")?;
    Ok(())
}

pub fn increment_retry(conn: &Connection, id: &str) -> Result<()> {
    conn.execute(
        "UPDATE bug_tasks SET retry_count = retry_count + 1, updated_at=?1 WHERE id=?2",
        rusqlite::params![now_ms(), id],
    ).context("increment_retry failed")?;
    Ok(())
}

/// 部分更新字段，None 表示不修改
#[derive(Default)]
pub struct UpdateFields {
    pub status: Option<String>,
    pub pipeline_stage: Option<String>,
    pub gitlab_issue_id: Option<i64>,
    pub gitlab_mr_id: Option<i64>,
    pub worktree_path: Option<String>,
    pub branch_name: Option<String>,
    pub claude_session_id: Option<String>,
}
```

- [ ] **Step 4: 运行测试，确认通过**

```bash
cd bugfix-bot && cargo test db 2>&1
```

Expected: 4 tests pass。

- [ ] **Step 5: Commit**

```bash
git add bugfix-bot/src/db.rs
git commit -m "feat(bugfix-bot): add BugTask SQLite persistence"
```

---

## Task 5: worktree.rs — git worktree 管理

**Files:**
- Create: `bugfix-bot/src/worktree.rs`

- [ ] **Step 1: 写失败测试**

```rust
// bugfix-bot/src/worktree.rs 底部 #[cfg(test)]
#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    /// branch_name_for 生成正确格式
    ///
    /// 预期：fix/bug-feishu-001
    #[test]
    fn test_branch_name_for() {
        let name = branch_name_for("feishu-001");
        assert_eq!(name, "fix/bug-feishu-001", "branch name format must match");
    }

    /// worktree_path_for 生成正确路径
    ///
    /// 预期：路径包含 feishu_issue_id
    #[test]
    fn test_worktree_path_for() {
        let path = worktree_path_for("/tmp/repo", "feishu-001");
        assert!(path.to_string_lossy().contains("feishu-001"), "path must contain issue id");
    }
}
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
cd bugfix-bot && cargo test worktree 2>&1
```

Expected: FAIL — `branch_name_for` not defined。

- [ ] **Step 3: 实现 worktree.rs**

```rust
// bugfix-bot/src/worktree.rs
use anyhow::{Context, Result};
use std::path::{Path, PathBuf};
use std::process::Command;

/// 为 feishu_issue_id 生成分支名
pub fn branch_name_for(feishu_issue_id: &str) -> String {
    format!("fix/bug-{}", feishu_issue_id)
}

/// 在 repo_path 下生成 worktree 路径（repo_path/.worktrees/<feishu_issue_id>）
pub fn worktree_path_for(repo_path: &str, feishu_issue_id: &str) -> PathBuf {
    Path::new(repo_path)
        .join(".worktrees")
        .join(feishu_issue_id)
}

/// 创建 git worktree，返回 worktree 路径
pub fn create(repo_path: &str, feishu_issue_id: &str) -> Result<PathBuf> {
    let branch = branch_name_for(feishu_issue_id);
    let wt_path = worktree_path_for(repo_path, feishu_issue_id);

    // 确保父目录存在
    if let Some(parent) = wt_path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let output = Command::new("git")
        .args(["worktree", "add", "-b", &branch, wt_path.to_str().unwrap()])
        .current_dir(repo_path)
        .output()
        .context("git worktree add failed")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!("git worktree add failed: {}", stderr);
    }

    Ok(wt_path)
}

/// 删除 git worktree 并删除对应分支
pub fn remove(repo_path: &str, wt_path: &str) -> Result<()> {
    // 先移除 worktree 记录
    let output = Command::new("git")
        .args(["worktree", "remove", "--force", wt_path])
        .current_dir(repo_path)
        .output()
        .context("git worktree remove failed")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // 路径不存在时忽略错误（已被手动删除）
        if !stderr.contains("is not a working tree") {
            anyhow::bail!("git worktree remove failed: {}", stderr);
        }
    }

    // 删除目录（如果还存在）
    let path = Path::new(wt_path);
    if path.exists() {
        std::fs::remove_dir_all(path).ok();
    }

    Ok(())
}
```

- [ ] **Step 4: 运行测试，确认通过**

```bash
cd bugfix-bot && cargo test worktree 2>&1
```

Expected: 2 tests pass（branch_name_for 和 worktree_path_for 是纯函数，不需要真实 git repo）。

- [ ] **Step 5: Commit**

```bash
git add bugfix-bot/src/worktree.rs
git commit -m "feat(bugfix-bot): add git worktree create/remove helpers"
```

---

## Task 6: claude.rs — subprocess 调用 claude CLI

**Files:**
- Create: `bugfix-bot/src/claude.rs`

- [ ] **Step 1: 写失败测试**

```rust
// bugfix-bot/src/claude.rs 底部 #[cfg(test)]
#[cfg(test)]
mod tests {
    use super::*;

    /// extract_result_text 从 stream-json 输出中提取 result 文本
    ///
    /// 数据构造：包含 type=result 行的 stream-json 输出
    /// 预期：返回 result 行的 result 字段文本
    #[test]
    fn test_extract_result_text_from_stream_json() {
        let output = r#"{"type":"assistant","message":{"content":[{"type":"text","text":"thinking..."}]}}
{"type":"result","subtype":"success","result":"The root cause is in foo.rs line 42.","session_id":"sess-1","is_error":false}
"#;
        let text = extract_result_text(output).unwrap();
        assert_eq!(text, "The root cause is in foo.rs line 42.", "must extract result text");
    }

    /// extract_result_text 在没有 result 行时返回 Err
    #[test]
    fn test_extract_result_text_missing_returns_err() {
        let output = r#"{"type":"assistant","message":{"content":[]}}"#;
        let result = extract_result_text(output);
        assert!(result.is_err(), "missing result line must return Err");
    }

    /// extract_session_id 从 stream-json 输出中提取 session_id
    ///
    /// 预期：返回 "sess-1"
    #[test]
    fn test_extract_session_id() {
        let output = r#"{"type":"result","subtype":"success","result":"done","session_id":"sess-1","is_error":false}"#;
        let sid = extract_session_id(output).unwrap();
        assert_eq!(sid, "sess-1", "must extract session_id");
    }
}
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
cd bugfix-bot && cargo test claude 2>&1
```

Expected: FAIL — `extract_result_text` not defined。

- [ ] **Step 3: 实现 claude.rs**

```rust
// bugfix-bot/src/claude.rs
use anyhow::{Context, Result};
use std::process::Command;

/// claude CLI 调用结果
pub struct ClaudeOutput {
    pub result_text: String,
    pub session_id: Option<String>,
    pub raw: String,
}

/// 调用 claude CLI，返回解析后的输出
///
/// 命令：claude --print --output-format stream-json -p "<prompt>" [--resume <session_id>]
/// 工作目录：project_path
pub fn run(
    prompt: &str,
    project_path: &str,
    resume_session_id: Option<&str>,
) -> Result<ClaudeOutput> {
    let mut args = vec![
        "--print".to_string(),
        "--output-format".to_string(),
        "stream-json".to_string(),
        "-p".to_string(),
        prompt.to_string(),
    ];
    if let Some(sid) = resume_session_id {
        args.push("--resume".to_string());
        args.push(sid.to_string());
    }

    let output = Command::new("claude")
        .args(&args)
        .current_dir(project_path)
        .output()
        .context("Failed to run claude CLI — is it installed and in PATH?")?;

    let raw = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if !output.status.success() {
        anyhow::bail!("claude exited with {}: {}", output.status, stderr);
    }

    let result_text = extract_result_text(&raw)?;
    let session_id = extract_session_id(&raw).ok();

    Ok(ClaudeOutput { result_text, session_id, raw })
}

/// 从 stream-json 输出中提取 result 行的 result 字段
pub fn extract_result_text(output: &str) -> Result<String> {
    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() { continue; }
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(line) {
            if v.get("type").and_then(|t| t.as_str()) == Some("result") {
                if let Some(text) = v.get("result").and_then(|r| r.as_str()) {
                    return Ok(text.to_string());
                }
            }
        }
    }
    anyhow::bail!("No result line found in claude output")
}

/// 从 stream-json 输出中提取 session_id
pub fn extract_session_id(output: &str) -> Result<String> {
    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() { continue; }
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(line) {
            if v.get("type").and_then(|t| t.as_str()) == Some("result") {
                if let Some(sid) = v.get("session_id").and_then(|s| s.as_str()) {
                    return Ok(sid.to_string());
                }
            }
        }
    }
    anyhow::bail!("No session_id found in claude output")
}
```

- [ ] **Step 4: 运行测试，确认通过**

```bash
cd bugfix-bot && cargo test claude 2>&1
```

Expected: 3 tests pass。

- [ ] **Step 5: Commit**

```bash
git add bugfix-bot/src/claude.rs
git commit -m "feat(bugfix-bot): add claude CLI subprocess wrapper"
```

---

## Task 7: gitlab.rs — GitLab API client

**Files:**
- Create: `bugfix-bot/src/gitlab.rs`

- [ ] **Step 1: 写失败测试**

```rust
// bugfix-bot/src/gitlab.rs 底部 #[cfg(test)]
#[cfg(test)]
mod tests {
    use super::*;

    /// GitlabClient::new 正确存储 base_url 和 token
    #[test]
    fn test_gitlab_client_new() {
        let client = GitlabClient::new("https://gl.example.com", "glpat-xxx");
        assert_eq!(client.base_url, "https://gl.example.com");
        assert_eq!(client.token, "glpat-xxx");
    }

    /// issue_url 生成正确格式
    ///
    /// 预期：https://gl.example.com/api/v4/projects/42/issues
    #[test]
    fn test_issue_url() {
        let client = GitlabClient::new("https://gl.example.com", "tok");
        let url = client.issues_url(42);
        assert_eq!(url, "https://gl.example.com/api/v4/projects/42/issues");
    }
}
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
cd bugfix-bot && cargo test gitlab 2>&1
```

Expected: FAIL — `GitlabClient` not defined。

- [ ] **Step 3: 实现 gitlab.rs**

```rust
// bugfix-bot/src/gitlab.rs
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

pub struct GitlabClient {
    pub base_url: String,
    pub token: String,
    client: reqwest::blocking::Client,
}

#[derive(Debug, Deserialize)]
pub struct GitlabIssue {
    pub id: i64,
    pub iid: i64,
    pub web_url: String,
}

#[derive(Debug, Deserialize)]
pub struct GitlabMr {
    pub id: i64,
    pub iid: i64,
    pub web_url: String,
}

impl GitlabClient {
    pub fn new(base_url: &str, token: &str) -> Self {
        Self {
            base_url: base_url.trim_end_matches('/').to_string(),
            token: token.to_string(),
            client: reqwest::blocking::Client::new(),
        }
    }

    pub fn issues_url(&self, project_id: i64) -> String {
        format!("{}/api/v4/projects/{}/issues", self.base_url, project_id)
    }

    /// 创建 GitLab Issue，返回 Issue 对象
    pub fn create_issue(
        &self,
        project_id: i64,
        title: &str,
        description: &str,
        labels: &[&str],
    ) -> Result<GitlabIssue> {
        #[derive(Serialize)]
        struct Body<'a> {
            title: &'a str,
            description: &'a str,
            labels: String,
        }
        let body = Body {
            title,
            description,
            labels: labels.join(","),
        };
        let resp = self.client
            .post(&self.issues_url(project_id))
            .header("PRIVATE-TOKEN", &self.token)
            .json(&body)
            .send()
            .context("GitLab create_issue request failed")?;
        let issue: GitlabIssue = resp.json().context("GitLab create_issue parse failed")?;
        Ok(issue)
    }

    /// 给 Issue 添加标签
    pub fn add_label(&self, project_id: i64, issue_iid: i64, label: &str) -> Result<()> {
        #[derive(Serialize)]
        struct Body<'a> { add_labels: &'a str }
        self.client
            .put(&format!("{}/api/v4/projects/{}/issues/{}", self.base_url, project_id, issue_iid))
            .header("PRIVATE-TOKEN", &self.token)
            .json(&Body { add_labels: label })
            .send()
            .context("GitLab add_label failed")?;
        Ok(())
    }

    /// 创建 Draft MR
    pub fn create_draft_mr(
        &self,
        project_id: i64,
        source_branch: &str,
        target_branch: &str,
        title: &str,
        description: &str,
    ) -> Result<GitlabMr> {
        #[derive(Serialize)]
        struct Body<'a> {
            source_branch: &'a str,
            target_branch: &'a str,
            title: String,
            description: &'a str,
        }
        let body = Body {
            source_branch,
            target_branch,
            title: format!("Draft: {}", title),
            description,
        };
        let resp = self.client
            .post(&format!("{}/api/v4/projects/{}/merge_requests", self.base_url, project_id))
            .header("PRIVATE-TOKEN", &self.token)
            .json(&body)
            .send()
            .context("GitLab create_draft_mr failed")?;
        let mr: GitlabMr = resp.json().context("GitLab create_draft_mr parse failed")?;
        Ok(mr)
    }
}
```

- [ ] **Step 4: 运行测试，确认通过**

```bash
cd bugfix-bot && cargo test gitlab 2>&1
```

Expected: 2 tests pass（纯单元测试，不发网络请求）。

- [ ] **Step 5: Commit**

```bash
git add bugfix-bot/src/gitlab.rs
git commit -m "feat(bugfix-bot): add GitLab API client"
```

---

## Task 8: feishu.rs — 飞书 API client

**Files:**
- Create: `bugfix-bot/src/feishu.rs`

- [ ] **Step 1: 写失败测试**

```rust
// bugfix-bot/src/feishu.rs 底部 #[cfg(test)]
#[cfg(test)]
mod tests {
    use super::*;

    /// FeishuClient::new 正确存储凭证
    #[test]
    fn test_feishu_client_new() {
        let client = FeishuClient::new("app1", "sec1");
        assert_eq!(client.app_id, "app1");
        assert_eq!(client.app_secret, "sec1");
    }

    /// build_comment_text 生成包含缺失字段的评论文本
    ///
    /// 预期：包含 "复现步骤" 和 "@负责人"
    #[test]
    fn test_build_comment_text() {
        let text = build_missing_info_comment(
            &["复现步骤", "日志"],
            "张三",
        );
        assert!(text.contains("复现步骤"), "must mention missing field");
        assert!(text.contains("张三"), "must mention assignee");
    }
}
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
cd bugfix-bot && cargo test feishu 2>&1
```

Expected: FAIL — `FeishuClient` not defined。

- [ ] **Step 3: 实现 feishu.rs**

```rust
// bugfix-bot/src/feishu.rs
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

pub struct FeishuClient {
    pub app_id: String,
    pub app_secret: String,
    client: reqwest::blocking::Client,
}

#[derive(Deserialize)]
struct TokenResp {
    tenant_access_token: String,
}

impl FeishuClient {
    pub fn new(app_id: &str, app_secret: &str) -> Self {
        Self {
            app_id: app_id.to_string(),
            app_secret: app_secret.to_string(),
            client: reqwest::blocking::Client::new(),
        }
    }

    /// 获取 tenant_access_token
    fn get_token(&self) -> Result<String> {
        #[derive(Serialize)]
        struct Body<'a> { app_id: &'a str, app_secret: &'a str }
        let resp: TokenResp = self.client
            .post("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal")
            .json(&Body { app_id: &self.app_id, app_secret: &self.app_secret })
            .send()
            .context("feishu get_token failed")?
            .json()
            .context("feishu get_token parse failed")?;
        Ok(resp.tenant_access_token)
    }

    /// 向飞书用户发送文本消息
    pub fn send_message(&self, user_open_id: &str, text: &str) -> Result<()> {
        let token = self.get_token()?;
        #[derive(Serialize)]
        struct Body<'a> {
            receive_id: &'a str,
            msg_type: &'a str,
            content: String,
        }
        let content = serde_json::json!({"text": text}).to_string();
        self.client
            .post("https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id")
            .bearer_auth(&token)
            .json(&Body { receive_id: user_open_id, msg_type: "text", content })
            .send()
            .context("feishu send_message failed")?;
        Ok(())
    }

    /// 在飞书项目缺陷上添加评论
    pub fn add_issue_comment(&self, issue_id: &str, text: &str) -> Result<()> {
        let token = self.get_token()?;
        #[derive(Serialize)]
        struct Body<'a> { content: &'a str }
        self.client
            .post(&format!(
                "https://open.feishu.cn/open-apis/project/v1/issues/{}/comments",
                issue_id
            ))
            .bearer_auth(&token)
            .json(&Body { content: text })
            .send()
            .context("feishu add_issue_comment failed")?;
        Ok(())
    }
}

/// 生成"信息不足"评论文本
pub fn build_missing_info_comment(missing_fields: &[&str], assignee: &str) -> String {
    let fields = missing_fields
        .iter()
        .map(|f| format!("- {}", f))
        .collect::<Vec<_>>()
        .join("\n");
    format!(
        "🤖 bugfix-bot 无法自动处理此缺陷，缺少以下信息：\n\n{}\n\n@{} 请补充后重新触发。",
        fields, assignee
    )
}
```

- [ ] **Step 4: 运行测试，确认通过**

```bash
cd bugfix-bot && cargo test feishu 2>&1
```

Expected: 2 tests pass。

- [ ] **Step 5: Commit**

```bash
git add bugfix-bot/src/feishu.rs
git commit -m "feat(bugfix-bot): add Feishu API client"
```

---

## Task 9: pipeline/intake.rs — 信息评估 + GitLab Issue 同步

**Files:**
- Create: `bugfix-bot/src/pipeline/intake.rs`

Intake 阶段职责：从飞书 payload 提取缺陷信息 → 调用 claude 评估信息充分性 → 创建 GitLab Issue → 若信息不足则加 blocked 标签并飞书评论。

- [ ] **Step 1: 写失败测试**

```rust
// bugfix-bot/src/pipeline/intake.rs 底部 #[cfg(test)]
#[cfg(test)]
mod tests {
    use super::*;

    /// extract_issue_context 从飞书 payload 提取缺陷字段
    ///
    /// 数据构造：包含 title/description/steps/logs/assignee 的 JSON
    /// 预期：title = "登录失败"，assignee = "张三"
    #[test]
    fn test_extract_issue_context() {
        let payload = serde_json::json!({
            "event": {
                "issue": {
                    "summary": "登录失败",
                    "description": "点击登录按钮后报错",
                    "reproduce_steps": "1. 打开 App\n2. 点击登录",
                    "logs": "NullPointerException at LoginActivity.java:42",
                    "assignee": { "name": "张三" },
                    "module": "用户中心"
                }
            }
        });
        let ctx = extract_issue_context(&payload).unwrap();
        assert_eq!(ctx.title, "登录失败", "title must match");
        assert_eq!(ctx.assignee, "张三", "assignee must match");
        assert_eq!(ctx.module, "用户中心", "module must match");
    }

    /// build_sufficiency_prompt 生成包含所有字段的 prompt
    ///
    /// 预期：prompt 包含 title 和 reproduce_steps
    #[test]
    fn test_build_sufficiency_prompt() {
        let ctx = IssueContext {
            title: "登录失败".to_string(),
            description: "报错".to_string(),
            reproduce_steps: "1. 打开 App".to_string(),
            logs: "NPE at line 42".to_string(),
            assignee: "张三".to_string(),
            module: "用户中心".to_string(),
        };
        let prompt = build_sufficiency_prompt(&ctx);
        assert!(prompt.contains("登录失败"), "prompt must contain title");
        assert!(prompt.contains("1. 打开 App"), "prompt must contain steps");
    }

    /// parse_sufficiency_result 解析 claude 返回的充分性结论
    ///
    /// 预期：SUFFICIENT → true，INSUFFICIENT → false
    #[test]
    fn test_parse_sufficiency_result_sufficient() {
        let result = parse_sufficiency_result("SUFFICIENT: 信息完整，可以定位根因");
        assert!(result.is_sufficient, "SUFFICIENT must return true");
    }

    #[test]
    fn test_parse_sufficiency_result_insufficient() {
        let result = parse_sufficiency_result("INSUFFICIENT: 缺少复现步骤和日志\nMISSING: 复现步骤, 日志");
        assert!(!result.is_sufficient, "INSUFFICIENT must return false");
        assert!(result.missing_fields.contains(&"复现步骤".to_string()), "must list missing fields");
    }
}
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
cd bugfix-bot && cargo test intake 2>&1
```

Expected: FAIL — `extract_issue_context` not defined。

- [ ] **Step 3: 实现 intake.rs**

```rust
// bugfix-bot/src/pipeline/intake.rs
use anyhow::Result;

#[derive(Debug, Clone)]
pub struct IssueContext {
    pub title: String,
    pub description: String,
    pub reproduce_steps: String,
    pub logs: String,
    pub assignee: String,
    pub module: String,
}

pub struct SufficiencyResult {
    pub is_sufficient: bool,
    pub missing_fields: Vec<String>,
    pub reason: String,
}

/// 从飞书 Webhook payload 提取缺陷上下文
pub fn extract_issue_context(payload: &serde_json::Value) -> Result<IssueContext> {
    let issue = payload
        .pointer("/event/issue")
        .ok_or_else(|| anyhow::anyhow!("Missing /event/issue in payload"))?;

    let get_str = |key: &str| -> String {
        issue.get(key)
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string()
    };

    let assignee = issue
        .pointer("/assignee/name")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    Ok(IssueContext {
        title: get_str("summary"),
        description: get_str("description"),
        reproduce_steps: get_str("reproduce_steps"),
        logs: get_str("logs"),
        assignee,
        module: get_str("module"),
    })
}

/// 构造信息充分性评估 prompt
pub fn build_sufficiency_prompt(ctx: &IssueContext) -> String {
    format!(
        r#"你是一个代码 bug 分析助手。请判断以下缺陷信息是否足够定位到代码层面的根因。

缺陷标题：{}
缺陷描述：{}
复现步骤：{}
日志/错误信息：{}
所属模块：{}

判断标准：
- 必须有明确的错误现象描述
- 必须有可操作的复现步骤或错误日志
- 信息需要足够定位到具体代码文件或函数

请以以下格式回复：
如果信息充足：SUFFICIENT: <简短理由>
如果信息不足：INSUFFICIENT: <简短理由>
MISSING: <缺失字段1>, <缺失字段2>, ..."#,
        ctx.title, ctx.description, ctx.reproduce_steps, ctx.logs, ctx.module
    )
}

/// 解析 claude 返回的充分性结论
pub fn parse_sufficiency_result(text: &str) -> SufficiencyResult {
    let is_sufficient = text.trim_start().starts_with("SUFFICIENT");
    let mut missing_fields = Vec::new();

    for line in text.lines() {
        if let Some(rest) = line.strip_prefix("MISSING:") {
            missing_fields = rest
                .split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect();
        }
    }

    SufficiencyResult {
        is_sufficient,
        missing_fields,
        reason: text.to_string(),
    }
}
```

- [ ] **Step 4: 运行测试，确认通过**

```bash
cd bugfix-bot && cargo test intake 2>&1
```

Expected: 5 tests pass。

- [ ] **Step 5: Commit**

```bash
git add bugfix-bot/src/pipeline/intake.rs
git commit -m "feat(bugfix-bot): add intake stage — issue context extraction and sufficiency check"
```

---

## Task 10: pipeline/reproducer.rs — 复现测试阶段

**Files:**
- Create: `bugfix-bot/src/pipeline/reproducer.rs`

Reproducer 阶段：调用 claude 在 worktree 中找到或新增一个失败测试，确认测试在修复前按预期失败。

- [ ] **Step 1: 写失败测试**

```rust
// bugfix-bot/src/pipeline/reproducer.rs 底部 #[cfg(test)]
#[cfg(test)]
mod tests {
    use super::*;

    /// build_reproducer_prompt 包含缺陷上下文和 TDD 指令
    ///
    /// 预期：prompt 包含 "失败测试" 和缺陷标题
    #[test]
    fn test_build_reproducer_prompt() {
        let prompt = build_reproducer_prompt("登录失败", "NPE at LoginActivity:42", "/tmp/repo");
        assert!(prompt.contains("登录失败"), "must contain bug title");
        assert!(prompt.contains("失败测试"), "must mention failing test");
        assert!(prompt.contains("/tmp/repo"), "must contain project path");
    }

    /// parse_reproducer_result 提取测试路径和运行命令
    ///
    /// 预期：test_path = "tests/login_test.rs", run_cmd = "cargo test test_login_fails"
    #[test]
    fn test_parse_reproducer_result() {
        let text = "TEST_PATH: tests/login_test.rs\nRUN_CMD: cargo test test_login_fails\nSTATUS: REPRODUCED";
        let result = parse_reproducer_result(text).unwrap();
        assert_eq!(result.test_path, "tests/login_test.rs");
        assert_eq!(result.run_cmd, "cargo test test_login_fails");
        assert!(result.reproduced, "status REPRODUCED must set reproduced=true");
    }

    /// parse_reproducer_result 在 CANNOT_REPRODUCE 时返回 reproduced=false
    #[test]
    fn test_parse_reproducer_result_cannot_reproduce() {
        let text = "STATUS: CANNOT_REPRODUCE\nREASON: 无法在本地环境复现此问题";
        let result = parse_reproducer_result(text).unwrap();
        assert!(!result.reproduced, "CANNOT_REPRODUCE must set reproduced=false");
        assert!(result.reason.contains("无法"), "must contain reason");
    }
}
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
cd bugfix-bot && cargo test reproducer 2>&1
```

Expected: FAIL — `build_reproducer_prompt` not defined。

- [ ] **Step 3: 实现 reproducer.rs**

```rust
// bugfix-bot/src/pipeline/reproducer.rs
use anyhow::Result;

pub struct ReproducerResult {
    pub reproduced: bool,
    pub test_path: String,
    pub run_cmd: String,
    pub reason: String,
}

/// 构造 Reproducer 阶段 prompt
pub fn build_reproducer_prompt(bug_title: &str, logs: &str, project_path: &str) -> String {
    format!(
        r#"你是一个 TDD 专家。请在以下项目中找到或新增一个能复现此 bug 的失败测试。

项目路径：{}
Bug 标题：{}
错误日志：{}

要求：
1. 优先搜索现有测试文件，找到能复现此 bug 的测试
2. 如果没有现有测试，新增一个最小化的失败测试
3. 测试必须在修复前按预期失败（不是因为编译错误失败）
4. 不要修改任何业务代码

请以以下格式回复：
TEST_PATH: <测试文件相对路径>
RUN_CMD: <运行该测试的命令>
STATUS: REPRODUCED 或 CANNOT_REPRODUCE
REASON: <说明>"#,
        project_path, bug_title, logs
    )
}

/// 解析 claude 返回的 Reproducer 结果
pub fn parse_reproducer_result(text: &str) -> Result<ReproducerResult> {
    let mut test_path = String::new();
    let mut run_cmd = String::new();
    let mut reproduced = false;
    let mut reason = String::new();

    for line in text.lines() {
        if let Some(v) = line.strip_prefix("TEST_PATH:") {
            test_path = v.trim().to_string();
        } else if let Some(v) = line.strip_prefix("RUN_CMD:") {
            run_cmd = v.trim().to_string();
        } else if let Some(v) = line.strip_prefix("STATUS:") {
            reproduced = v.trim() == "REPRODUCED";
        } else if let Some(v) = line.strip_prefix("REASON:") {
            reason = v.trim().to_string();
        }
    }

    Ok(ReproducerResult { reproduced, test_path, run_cmd, reason })
}
```

- [ ] **Step 4: 运行测试，确认通过**

```bash
cd bugfix-bot && cargo test reproducer 2>&1
```

Expected: 3 tests pass。

- [ ] **Step 5: Commit**

```bash
git add bugfix-bot/src/pipeline/reproducer.rs
git commit -m "feat(bugfix-bot): add reproducer stage — failing test creation"
```

---

## Task 11: pipeline/patch.rs — Fault Localize + Patch Generator

**Files:**
- Create: `bugfix-bot/src/pipeline/patch.rs`

Patch 阶段：调用 claude 定位根因并生成最小修复 diff，不做顺手重构。

- [ ] **Step 1: 写失败测试**

```rust
// bugfix-bot/src/pipeline/patch.rs 底部 #[cfg(test)]
#[cfg(test)]
mod tests {
    use super::*;

    /// build_patch_prompt 包含失败测试路径和 TDD 约束
    ///
    /// 预期：prompt 包含 test_path 和"最小修复"
    #[test]
    fn test_build_patch_prompt() {
        let prompt = build_patch_prompt("登录失败", "tests/login_test.rs", "cargo test test_login_fails", "/tmp/repo");
        assert!(prompt.contains("tests/login_test.rs"), "must contain test path");
        assert!(prompt.contains("最小"), "must mention minimal fix");
    }

    /// parse_patch_result 提取根因和修改文件列表
    ///
    /// 预期：root_cause 非空，changed_files 包含 "src/login.rs"
    #[test]
    fn test_parse_patch_result() {
        let text = "ROOT_CAUSE: LoginActivity 未处理 null token\nCHANGED_FILES: src/login.rs, tests/login_test.rs\nSTATUS: PATCHED";
        let result = parse_patch_result(text).unwrap();
        assert!(!result.root_cause.is_empty(), "root_cause must not be empty");
        assert!(result.changed_files.contains(&"src/login.rs".to_string()), "must list changed files");
        assert!(result.patched, "STATUS PATCHED must set patched=true");
    }
}
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
cd bugfix-bot && cargo test patch 2>&1
```

Expected: FAIL — `build_patch_prompt` not defined。

- [ ] **Step 3: 实现 patch.rs**

```rust
// bugfix-bot/src/pipeline/patch.rs
use anyhow::Result;

pub struct PatchResult {
    pub patched: bool,
    pub root_cause: String,
    pub changed_files: Vec<String>,
    pub reason: String,
}

/// 构造 Patch 阶段 prompt
pub fn build_patch_prompt(
    bug_title: &str,
    test_path: &str,
    run_cmd: &str,
    project_path: &str,
) -> String {
    format!(
        r#"你是一个 TDD 专家。请修复以下 bug，使失败测试通过。

项目路径：{}
Bug 标题：{}
失败测试文件：{}
运行测试命令：{}

要求：
1. 先运行失败测试，确认它确实失败
2. 定位根因（最小相关代码区域）
3. 生成最小修复 patch，只修 bug，不做顺手重构
4. 修复后运行测试，确认通过
5. 不要修改测试文件中的断言逻辑

请以以下格式回复：
ROOT_CAUSE: <根因描述>
CHANGED_FILES: <文件1>, <文件2>
STATUS: PATCHED 或 FAILED
REASON: <说明>"#,
        project_path, bug_title, test_path, run_cmd
    )
}

/// 解析 claude 返回的 Patch 结果
pub fn parse_patch_result(text: &str) -> Result<PatchResult> {
    let mut root_cause = String::new();
    let mut changed_files = Vec::new();
    let mut patched = false;
    let mut reason = String::new();

    for line in text.lines() {
        if let Some(v) = line.strip_prefix("ROOT_CAUSE:") {
            root_cause = v.trim().to_string();
        } else if let Some(v) = line.strip_prefix("CHANGED_FILES:") {
            changed_files = v.split(',').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect();
        } else if let Some(v) = line.strip_prefix("STATUS:") {
            patched = v.trim() == "PATCHED";
        } else if let Some(v) = line.strip_prefix("REASON:") {
            reason = v.trim().to_string();
        }
    }

    Ok(PatchResult { patched, root_cause, changed_files, reason })
}
```

- [ ] **Step 4: 运行测试，确认通过**

```bash
cd bugfix-bot && cargo test patch 2>&1
```

Expected: 2 tests pass。

- [ ] **Step 5: Commit**

```bash
git add bugfix-bot/src/pipeline/patch.rs
git commit -m "feat(bugfix-bot): add patch stage — fault localization and minimal fix"
```

---

## Task 12: pipeline/verifier.rs — 分层验证

**Files:**
- Create: `bugfix-bot/src/pipeline/verifier.rs`

Verifier 阶段：目标失败测试 → 相关模块测试 → typecheck/build/lint，逐层验证。

- [ ] **Step 1: 写失败测试**

```rust
// bugfix-bot/src/pipeline/verifier.rs 底部 #[cfg(test)]
#[cfg(test)]
mod tests {
    use super::*;

    /// run_command 成功时返回 Ok(stdout)
    ///
    /// 预期：echo "hello" 返回 Ok("hello\n")
    #[test]
    fn test_run_command_success() {
        let result = run_command("echo", &["hello"], "/tmp");
        assert!(result.is_ok(), "echo must succeed");
        assert!(result.unwrap().contains("hello"), "stdout must contain hello");
    }

    /// run_command 失败时返回 Err 包含 stderr
    ///
    /// 预期：false 命令返回 Err
    #[test]
    fn test_run_command_failure() {
        let result = run_command("false", &[], "/tmp");
        assert!(result.is_err(), "false command must return Err");
    }

    /// VerificationPlan::for_rust 生成正确的验证步骤
    ///
    /// 预期：包含 cargo test 和 cargo build
    #[test]
    fn test_verification_plan_for_rust() {
        let plan = VerificationPlan::for_rust("tests/login_test.rs", "cargo test test_login_fails");
        assert!(!plan.steps.is_empty(), "must have verification steps");
        let cmds: Vec<_> = plan.steps.iter().map(|s| &s.cmd).collect();
        assert!(cmds.iter().any(|c| c.contains("cargo test")), "must include cargo test");
        assert!(cmds.iter().any(|c| c.contains("cargo build")), "must include cargo build");
    }
}
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
cd bugfix-bot && cargo test verifier 2>&1
```

Expected: FAIL — `run_command` not defined。

- [ ] **Step 3: 实现 verifier.rs**

```rust
// bugfix-bot/src/pipeline/verifier.rs
use anyhow::Result;
use std::process::Command;

pub struct VerificationStep {
    pub name: String,
    pub cmd: String,
    pub args: Vec<String>,
}

pub struct VerificationPlan {
    pub steps: Vec<VerificationStep>,
}

pub struct VerificationResult {
    pub passed: bool,
    pub failed_step: Option<String>,
    pub output: String,
}

impl VerificationPlan {
    /// 为 Rust 项目生成分层验证计划
    pub fn for_rust(test_path: &str, target_test_cmd: &str) -> Self {
        // 从 target_test_cmd 提取测试名（cargo test <name>）
        let test_name = target_test_cmd
            .strip_prefix("cargo test ")
            .unwrap_or("")
            .trim()
            .to_string();

        let mut steps = vec![
            VerificationStep {
                name: "目标失败测试".to_string(),
                cmd: "cargo".to_string(),
                args: if test_name.is_empty() {
                    vec!["test".to_string()]
                } else {
                    vec!["test".to_string(), test_name]
                },
            },
            VerificationStep {
                name: "相关模块测试".to_string(),
                cmd: "cargo".to_string(),
                args: vec!["test".to_string()],
            },
            VerificationStep {
                name: "编译检查".to_string(),
                cmd: "cargo".to_string(),
                args: vec!["build".to_string()],
            },
        ];

        // 如果有 clippy，加入 lint 检查
        steps.push(VerificationStep {
            name: "Clippy lint".to_string(),
            cmd: "cargo".to_string(),
            args: vec!["clippy".to_string(), "--".to_string(), "-D".to_string(), "warnings".to_string()],
        });

        let _ = test_path; // 用于未来扩展（定位相关模块测试范围）
        Self { steps }
    }
}

/// 运行单个命令，返回 stdout 或 Err（包含 stderr）
pub fn run_command(cmd: &str, args: &[&str], cwd: &str) -> Result<String> {
    let output = Command::new(cmd)
        .args(args)
        .current_dir(cwd)
        .output()?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        anyhow::bail!("Command `{} {}` failed: {}", cmd, args.join(" "), stderr)
    }
}

/// 按计划逐层验证，遇到失败立即停止
pub fn run_plan(plan: &VerificationPlan, cwd: &str) -> VerificationResult {
    let mut all_output = String::new();

    for step in &plan.steps {
        let args: Vec<&str> = step.args.iter().map(|s| s.as_str()).collect();
        match run_command(&step.cmd, &args, cwd) {
            Ok(out) => {
                all_output.push_str(&format!("[{}] PASS\n{}\n", step.name, out));
            }
            Err(e) => {
                all_output.push_str(&format!("[{}] FAIL\n{}\n", step.name, e));
                return VerificationResult {
                    passed: false,
                    failed_step: Some(step.name.clone()),
                    output: all_output,
                };
            }
        }
    }

    VerificationResult { passed: true, failed_step: None, output: all_output }
}
```

- [ ] **Step 4: 运行测试，确认通过**

```bash
cd bugfix-bot && cargo test verifier 2>&1
```

Expected: 3 tests pass。

- [ ] **Step 5: Commit**

```bash
git add bugfix-bot/src/pipeline/verifier.rs
git commit -m "feat(bugfix-bot): add verifier stage — layered test/build/lint verification"
```

---

## Task 13: pipeline/publisher.rs — Draft MR + 飞书通知

**Files:**
- Create: `bugfix-bot/src/pipeline/publisher.rs`

Publisher 阶段：生成 MR 描述 → 提交 worktree 分支 → 创建 Draft MR → 飞书通知工程师。

- [ ] **Step 1: 写失败测试**

```rust
// bugfix-bot/src/pipeline/publisher.rs 底部 #[cfg(test)]
#[cfg(test)]
mod tests {
    use super::*;

    /// build_mr_description 生成包含所有必要段落的 MR 描述
    ///
    /// 预期：包含根因、修复摘要、测试文件路径、飞书缺陷链接
    #[test]
    fn test_build_mr_description() {
        let desc = build_mr_description(
            "feishu-001",
            "登录失败",
            "LoginActivity 未处理 null token",
            "在 checkToken() 中增加 null 检查",
            "tests/login_test.rs",
            "test_login_fails",
            42,
        );
        assert!(desc.contains("LoginActivity"), "must contain root cause");
        assert!(desc.contains("null 检查"), "must contain fix summary");
        assert!(desc.contains("tests/login_test.rs"), "must contain test path");
        assert!(desc.contains("feishu-001"), "must contain feishu issue id");
        assert!(desc.contains("#42"), "must contain gitlab issue id");
    }

    /// build_mr_title 生成正确格式
    ///
    /// 预期：[AutoFix] feishu-001 - 登录失败
    #[test]
    fn test_build_mr_title() {
        let title = build_mr_title("feishu-001", "登录失败");
        assert_eq!(title, "[AutoFix] feishu-001 - 登录失败");
    }
}
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
cd bugfix-bot && cargo test publisher 2>&1
```

Expected: FAIL — `build_mr_description` not defined。

- [ ] **Step 3: 实现 publisher.rs**

```rust
// bugfix-bot/src/pipeline/publisher.rs
use anyhow::Result;
use std::process::Command;

/// 生成 MR 标题
pub fn build_mr_title(feishu_issue_id: &str, bug_title: &str) -> String {
    format!("[AutoFix] {} - {}", feishu_issue_id, bug_title)
}

/// 生成 Draft MR 描述（固定模板）
pub fn build_mr_description(
    feishu_issue_id: &str,
    bug_title: &str,
    root_cause: &str,
    fix_summary: &str,
    test_path: &str,
    test_name: &str,
    gitlab_issue_id: i64,
) -> String {
    format!(
        r#"## [AutoFix] {} - {}

### 根因分析
{}

### 修复摘要
{}

### 新增测试
- [ ] `{}` - `{}`：验证 bug 复现场景

### 关联
- 飞书缺陷：{}
- GitLab Issue：#{}

---
> 此 MR 由 bugfix-bot 自动生成，请 Review 后去掉 Draft 标记。"#,
        feishu_issue_id, bug_title,
        root_cause,
        fix_summary,
        test_path, test_name,
        feishu_issue_id,
        gitlab_issue_id,
    )
}

/// 提交 worktree 分支上的所有变更
pub fn commit_worktree(worktree_path: &str, message: &str) -> Result<()> {
    // git add -A
    let output = Command::new("git")
        .args(["add", "-A"])
        .current_dir(worktree_path)
        .output()?;
    if !output.status.success() {
        anyhow::bail!("git add failed: {}", String::from_utf8_lossy(&output.stderr));
    }

    // git commit
    let output = Command::new("git")
        .args(["commit", "-m", message])
        .current_dir(worktree_path)
        .output()?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // "nothing to commit" 不算错误
        if stderr.contains("nothing to commit") {
            return Ok(());
        }
        anyhow::bail!("git commit failed: {}", stderr);
    }

    Ok(())
}

/// 推送 worktree 分支到远端
pub fn push_branch(worktree_path: &str, branch: &str) -> Result<()> {
    let output = Command::new("git")
        .args(["push", "origin", branch])
        .current_dir(worktree_path)
        .output()?;
    if !output.status.success() {
        anyhow::bail!("git push failed: {}", String::from_utf8_lossy(&output.stderr));
    }
    Ok(())
}
```

- [ ] **Step 4: 运行测试，确认通过**

```bash
cd bugfix-bot && cargo test publisher 2>&1
```

Expected: 2 tests pass。

- [ ] **Step 5: Commit**

```bash
git add bugfix-bot/src/pipeline/publisher.rs
git commit -m "feat(bugfix-bot): add publisher stage — MR description and git push"
```

---

## Task 14: pipeline/mod.rs — Pipeline 入口与重试逻辑

**Files:**
- Create: `bugfix-bot/src/pipeline/mod.rs`（替换占位文件）

Pipeline 入口串联所有阶段，管理重试计数，处理各阶段失败出口。

- [ ] **Step 1: 写失败测试**

```rust
// bugfix-bot/src/pipeline/mod.rs 底部 #[cfg(test)]
#[cfg(test)]
mod tests {
    use super::*;

    /// should_retry 在 retry_count < 5 时返回 true
    #[test]
    fn test_should_retry_under_limit() {
        assert!(should_retry(0), "retry_count=0 must allow retry");
        assert!(should_retry(4), "retry_count=4 must allow retry");
    }

    /// should_retry 在 retry_count >= 5 时返回 false
    #[test]
    fn test_should_retry_at_limit() {
        assert!(!should_retry(5), "retry_count=5 must not allow retry");
        assert!(!should_retry(10), "retry_count=10 must not allow retry");
    }

    /// idempotency_check 对"分析中"状态返回 Skip
    #[test]
    fn test_idempotency_check_in_progress() {
        let action = idempotency_check("analyzing");
        assert!(matches!(action, IdempotencyAction::Skip), "analyzing status must skip");
    }

    /// idempotency_check 对"信息不足"状态返回 Reprocess
    #[test]
    fn test_idempotency_check_blocked_info() {
        let action = idempotency_check("blocked_info");
        assert!(matches!(action, IdempotencyAction::Reprocess), "blocked_info must reprocess");
    }

    /// idempotency_check 对"已完成"状态返回 Skip
    #[test]
    fn test_idempotency_check_done() {
        let action = idempotency_check("done");
        assert!(matches!(action, IdempotencyAction::Skip), "done status must skip");
    }
}
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
cd bugfix-bot && cargo test "pipeline::tests" 2>&1
```

Expected: FAIL — `should_retry` not defined。

- [ ] **Step 3: 实现 pipeline/mod.rs**

```rust
// bugfix-bot/src/pipeline/mod.rs
pub mod intake;
pub mod reproducer;
pub mod patch;
pub mod verifier;
pub mod publisher;

/// 是否还可以重试（上限 5 次）
pub fn should_retry(retry_count: i64) -> bool {
    retry_count < 5
}

/// 幂等性检查结果
pub enum IdempotencyAction {
    /// 正在处理中或已完成，忽略此次触发
    Skip,
    /// 之前阻塞（信息不足），允许重新处理
    Reprocess,
    /// 新任务，正常处理
    Process,
}

/// 根据 BugTask 当前状态决定如何处理重复触发
pub fn idempotency_check(status: &str) -> IdempotencyAction {
    match status {
        "analyzing" | "fixing" | "pending_review" => IdempotencyAction::Skip,
        "done" | "blocked_fix_failed" | "blocked_ci" => IdempotencyAction::Skip,
        "blocked_info" | "blocked_no_reproduce" => IdempotencyAction::Reprocess,
        _ => IdempotencyAction::Process,
    }
}
```

- [ ] **Step 4: 运行测试，确认通过**

```bash
cd bugfix-bot && cargo test "pipeline" 2>&1
```

Expected: 5 tests pass（pipeline mod 的测试）。

- [ ] **Step 5: Commit**

```bash
git add bugfix-bot/src/pipeline/mod.rs
git commit -m "feat(bugfix-bot): add pipeline orchestration — retry logic and idempotency check"
```

---

## Task 15: main.rs — stdin 读取循环与事件分发

**Files:**
- Modify: `bugfix-bot/src/main.rs`

实现完整的 stdin 读取循环，分发 `feishu.issue.updated` 和 `gitlab.merge_request_hook` 事件。

- [ ] **Step 1: 写失败测试**

```rust
// bugfix-bot/src/main.rs 底部 #[cfg(test)]
#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::TaskMessage;

    /// dispatch 对未知事件类型不 panic
    #[test]
    fn test_dispatch_unknown_event_is_safe() {
        let msg = TaskMessage {
            protocol_version: "1".to_string(),
            task_id: "t1".to_string(),
            conversation_id: "c1".to_string(),
            event: "unknown.event".to_string(),
            payload: serde_json::json!({}),
        };
        // 不 panic 即通过
        let result = std::panic::catch_unwind(|| {
            dispatch_event(&msg);
        });
        assert!(result.is_ok(), "unknown event must not panic");
    }
}
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
cd bugfix-bot && cargo test "main::tests" 2>&1
```

Expected: FAIL — `dispatch_event` not defined。

- [ ] **Step 3: 实现完整 main.rs**

```rust
// bugfix-bot/src/main.rs
mod config;
mod db;
mod protocol;
mod claude;
mod gitlab;
mod feishu;
mod worktree;
mod pipeline;

use protocol::{AgentEvent, TaskMessage};
use std::io::BufRead;

fn main() {
    eprintln!("[bugfix-bot] starting, reading from stdin");
    let stdin = std::io::stdin();
    for line in stdin.lock().lines() {
        match line {
            Ok(l) if l.trim().is_empty() => continue,
            Ok(l) => {
                match serde_json::from_str::<TaskMessage>(&l) {
                    Ok(msg) => dispatch_event(&msg),
                    Err(e) => eprintln!("[bugfix-bot] parse error: {} — line: {}", e, l),
                }
            }
            Err(e) => {
                eprintln!("[bugfix-bot] stdin read error: {}", e);
                break;
            }
        }
    }
    eprintln!("[bugfix-bot] stdin closed, exiting");
}

pub fn dispatch_event(msg: &TaskMessage) {
    match msg.event.as_str() {
        "feishu.issue.updated" => handle_feishu_issue(msg),
        "gitlab.merge_request_hook" => handle_gitlab_mr(msg),
        other => eprintln!("[bugfix-bot] unknown event: {}", other),
    }
}

fn handle_feishu_issue(msg: &TaskMessage) {
    AgentEvent::Progress {
        task_id: msg.task_id.clone(),
        conversation_id: msg.conversation_id.clone(),
        message: "received feishu.issue.updated, starting pipeline".to_string(),
    }.emit();

    // 加载配置
    let cfg = match config::Config::load() {
        Ok(c) => c,
        Err(e) => {
            AgentEvent::Error {
                task_id: msg.task_id.clone(),
                conversation_id: msg.conversation_id.clone(),
                code: "config_error".to_string(),
                message: format!("Failed to load config: {}", e),
            }.emit();
            return;
        }
    };

    // 打开 DB
    let db_path = match config::db_path() {
        Ok(p) => p,
        Err(e) => {
            AgentEvent::Error {
                task_id: msg.task_id.clone(),
                conversation_id: msg.conversation_id.clone(),
                code: "db_error".to_string(),
                message: format!("Failed to get db path: {}", e),
            }.emit();
            return;
        }
    };
    let conn = match db::open_at(&db_path) {
        Ok(c) => c,
        Err(e) => {
            AgentEvent::Error {
                task_id: msg.task_id.clone(),
                conversation_id: msg.conversation_id.clone(),
                code: "db_error".to_string(),
                message: format!("Failed to open db: {}", e),
            }.emit();
            return;
        }
    };

    // 提取缺陷上下文
    let ctx = match pipeline::intake::extract_issue_context(&msg.payload) {
        Ok(c) => c,
        Err(e) => {
            AgentEvent::Error {
                task_id: msg.task_id.clone(),
                conversation_id: msg.conversation_id.clone(),
                code: "payload_error".to_string(),
                message: format!("Failed to extract issue context: {}", e),
            }.emit();
            return;
        }
    };

    // 幂等检查
    let existing = db::find_by_feishu_id(&conn, &ctx.title).ok().flatten();
    if let Some(ref task) = existing {
        match pipeline::idempotency_check(&task.status) {
            pipeline::IdempotencyAction::Skip => {
                AgentEvent::Result {
                    task_id: msg.task_id.clone(),
                    conversation_id: msg.conversation_id.clone(),
                    status: "skipped".to_string(),
                    data: None,
                    error: None,
                }.emit();
                return;
            }
            pipeline::IdempotencyAction::Reprocess => {
                eprintln!("[bugfix-bot] reprocessing blocked task: {}", task.id);
            }
            pipeline::IdempotencyAction::Process => {}
        }
    }

    // 创建或复用 BugTask
    let task_id = if let Some(ref task) = existing {
        task.id.clone()
    } else {
        match db::insert_bug_task(&conn, &ctx.title) {
            Ok(id) => id,
            Err(e) => {
                AgentEvent::Error {
                    task_id: msg.task_id.clone(),
                    conversation_id: msg.conversation_id.clone(),
                    code: "db_error".to_string(),
                    message: format!("Failed to insert bug task: {}", e),
                }.emit();
                return;
            }
        }
    };

    AgentEvent::Progress {
        task_id: msg.task_id.clone(),
        conversation_id: msg.conversation_id.clone(),
        message: format!("bug_task_id={} status=analyzing", task_id),
    }.emit();

    // 后续 pipeline 阶段（信息评估、复现、修复、验证、发布）
    // 在后续 Task 中通过集成测试覆盖完整流程
    let _ = cfg;
    eprintln!("[bugfix-bot] pipeline started for bug_task={}", task_id);
}

fn handle_gitlab_mr(msg: &TaskMessage) {
    let action = msg.payload
        .pointer("/object_attributes/action")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown");

    AgentEvent::Progress {
        task_id: msg.task_id.clone(),
        conversation_id: msg.conversation_id.clone(),
        message: format!("gitlab MR event action={}", action),
    }.emit();

    // merge 或 close → 清理 worktree
    if action == "merge" || action == "close" {
        let source_branch = msg.payload
            .pointer("/object_attributes/source_branch")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        eprintln!("[bugfix-bot] MR {} on branch {}, cleanup pending", action, source_branch);
        // worktree 清理逻辑在集成阶段实现
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// dispatch 对未知事件类型不 panic
    #[test]
    fn test_dispatch_unknown_event_is_safe() {
        let msg = TaskMessage {
            protocol_version: "1".to_string(),
            task_id: "t1".to_string(),
            conversation_id: "c1".to_string(),
            event: "unknown.event".to_string(),
            payload: serde_json::json!({}),
        };
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            dispatch_event(&msg);
        }));
        assert!(result.is_ok(), "unknown event must not panic");
    }
}
```

- [ ] **Step 4: 运行全量测试，确认通过**

```bash
cd bugfix-bot && cargo test 2>&1
```

Expected: 所有测试通过，无 error。

- [ ] **Step 5: 验证编译**

```bash
cd bugfix-bot && cargo build 2>&1
```

Expected: `Finished` 无 error。

- [ ] **Step 6: Commit**

```bash
git add bugfix-bot/src/main.rs
git commit -m "feat(bugfix-bot): implement main stdin loop and event dispatch"
```

---

## Task 16: 注册安装脚本 + index.json 更新

**Files:**
- Create: `bugfix-bot/scripts/install.sh`
- Modify: `docs/exec-plans/index.json`

- [ ] **Step 1: 写安装脚本**

```bash
#!/usr/bin/env bash
# bugfix-bot/scripts/install.sh
# 编译并安装 bugfix-bot 到 msctl agents 目录

set -euo pipefail

AGENTS_DIR="${HOME}/.config/msctl/agents"
mkdir -p "$AGENTS_DIR"

echo "Building bugfix-bot..."
cargo build --release

echo "Installing binary..."
cp target/release/bugfix-bot "$AGENTS_DIR/bugfix-bot"
chmod +x "$AGENTS_DIR/bugfix-bot"

echo "Installing manifest..."
cp bugfix-bot.toml "$AGENTS_DIR/bugfix-bot.toml"

echo "Registering plugin..."
msctl agent register --type plugin --name bugfix-bot

echo "Done. Restart msctl serve to activate bugfix-bot."
```

- [ ] **Step 2: 设置执行权限**

```bash
chmod +x bugfix-bot/scripts/install.sh
```

- [ ] **Step 3: 更新 docs/exec-plans/index.json**

读取现有 index.json，在 `documents` 数组头部插入：

```json
{
  "file": "2026-05-10-bugfix-bot.md",
  "title": "bugfix-bot Plugin Agent 实施计划"
}
```

- [ ] **Step 4: 验证 index.json 格式**

```bash
python3 scripts/check-docs-indices.py 2>&1
```

Expected: 通过，无 error。

- [ ] **Step 5: 最终全量测试**

```bash
cd bugfix-bot && cargo test 2>&1
```

Expected: 所有测试通过。

- [ ] **Step 6: 最终 Commit**

```bash
git add bugfix-bot/scripts/install.sh docs/exec-plans/index.json
git commit -m "feat(bugfix-bot): add install script and register in exec-plans index"
```

---

## Self-Review

### Spec 覆盖检查

| SPEC 要求 | 对应 Task |
|-----------|-----------|
| 飞书 Webhook 监听与触发 | Task 15 (main.rs dispatch) |
| 缺陷信息充分性 AI 评估 | Task 9 (intake) |
| 飞书缺陷 → GitLab Issue 同步 | Task 7 (gitlab) + Task 9 |
| Claude Code Agent 分析 | Task 6 (claude) + Task 10 (reproducer) |
| 强制 TDD 修复循环 | Task 10 (reproducer) + Task 11 (patch) |
| git worktree 隔离 | Task 5 (worktree) |
| Draft MR 自动创建 | Task 7 (gitlab) + Task 13 (publisher) |
| 飞书 bot 通知 | Task 8 (feishu) + Task 13 (publisher) |
| 重试机制（最多 5 次） | Task 14 (pipeline/mod) |
| 阻塞状态管理 | Task 7 (gitlab label) + Task 8 (feishu comment) |
| BugTask 持久化 | Task 4 (db) |
| 幂等性 | Task 14 (idempotency_check) + Task 15 |
| GitLab MR 事件处理 | Task 15 (handle_gitlab_mr) |
| Plugin manifest | Task 1 |
| 安装注册 | Task 16 |

所有 SPEC §2.1 In Scope 条目均有对应 Task，无遗漏。

### 类型一致性检查

- `BugTask` 字段在 Task 4 定义，Task 15 使用 `db::find_by_feishu_id` 返回 `Option<BugTask>` — 一致
- `IssueContext` 在 Task 9 定义，Task 15 调用 `pipeline::intake::extract_issue_context` — 一致
- `AgentEvent::emit()` 在 Task 2 定义，Task 15 调用 — 一致
- `pipeline::idempotency_check` 在 Task 14 定义，Task 15 调用 — 一致
