use crate::commands::inject::inject_context;
use crate::db::{now_ms, open};
use anyhow::{Context, Result};
use clap::Subcommand;
use rusqlite::Connection;
use serde::Serialize;
use uuid::Uuid;

use crate::commands::agent_plugin::{
    install_plugin, plugin_agents_dir, register_plugin, restart_plugin, uninstall_plugin,
};

#[derive(Subcommand)]
pub enum AgentCommands {
    /// Register a new agent. Use --type plugin for plugin agents.
    Register {
        #[arg(long)]
        name: String,
        /// Required for runtime agents; omit for plugin agents
        #[arg(long)]
        project: Option<String>,
        /// Runtime: claude-code | codex | cursor-cli
        #[arg(long, default_value = "claude-code")]
        runtime: String,
        /// Permission mode: suggest | auto-edit | full-auto | yolo
        #[arg(long, default_value = "full-auto")]
        mode: String,
        /// Agent type: runtime (default) | plugin
        #[arg(long, default_value = "runtime")]
        r#type: String,
    },
    /// List all registered agents (runtime + plugin)
    List,
    /// Get agent details
    Get { id: String },
    /// Update agent fields
    Update {
        id: String,
        #[arg(long)]
        name: Option<String>,
        #[arg(long)]
        project: Option<String>,
        #[arg(long)]
        runtime: Option<String>,
    },
    /// Delete an agent record from DB (does not delete files)
    Delete { id: String },
    /// Invoke an agent (create conversation + send message)
    Invoke {
        id: String,
        #[arg(long)]
        message: String,
    },
    /// Install a plugin agent executable from URL or local path
    Install {
        /// URL (https://...) or local path (./fix-bug-bot)
        source: String,
    },
    /// Delete plugin agent executable and toml from disk
    Uninstall { name: String },
    /// Restart a failed plugin agent process (resets DB status)
    Restart { id: String },
}

#[derive(Serialize, Debug)]
pub struct AgentRow {
    pub id: String,
    pub name: String,
    pub project_path: String,
    pub runtime: String,
    pub created_at: i64,
}

pub fn handle(cmd: AgentCommands) -> Result<()> {
    let conn = open()?;
    match cmd {
        AgentCommands::Register {
            name,
            project,
            runtime,
            mode,
            r#type,
        } => {
            if r#type == "plugin" {
                let agents_dir = plugin_agents_dir()?;
                register_plugin(&conn, &name, &agents_dir)
            } else {
                let project = project.context("--project is required for runtime agents")?;
                register(&conn, &name, &project, &runtime, &mode)
            }
        }
        AgentCommands::List => list(&conn),
        AgentCommands::Get { id } => get(&conn, &id),
        AgentCommands::Update {
            id,
            name,
            project,
            runtime,
        } => update(&conn, &id, name, project, runtime),
        AgentCommands::Delete { id } => delete(&conn, &id),
        AgentCommands::Invoke { id, message } => invoke(&conn, &id, &message),
        AgentCommands::Install { source } => install_plugin(&source),
        AgentCommands::Uninstall { name } => uninstall_plugin(&name),
        AgentCommands::Restart { id } => restart_plugin(&conn, &id),
    }
}

pub fn insert_agent(
    conn: &Connection,
    name: &str,
    project_path: &str,
    runtime: &str,
    mode: &str,
) -> Result<String> {
    let id = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO agents (id, name, project_path, runtime, mode, created_at) VALUES (?1,?2,?3,?4,?5,?6)",
        rusqlite::params![id, name, project_path, runtime, mode, now_ms()],
    ).context("Failed to insert agent")?;
    Ok(id)
}

fn register(conn: &Connection, name: &str, project: &str, runtime: &str, mode: &str) -> Result<()> {
    let id = insert_agent(conn, name, project, runtime, mode)?;
    println!("Agent registered. ID: {}", id);
    // 注入 msctl 命令速查到工作空间
    inject_context(&id, runtime, std::path::Path::new(project))?;
    Ok(())
}

fn list(conn: &Connection) -> Result<()> {
    let mut stmt = conn.prepare(
        "SELECT id, name, project_path, runtime, created_at FROM agents ORDER BY created_at DESC",
    )?;
    let runtime_agents: Vec<AgentRow> = stmt
        .query_map([], |r| {
            Ok(AgentRow {
                id: r.get(0)?,
                name: r.get(1)?,
                project_path: r.get(2)?,
                runtime: r.get(3)?,
                created_at: r.get(4)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();

    let plugin_agents: Vec<(String, String, String, String)> = conn
        .prepare("SELECT id, name, version, status FROM plugin_agents ORDER BY installed_at ASC")
        .and_then(|mut s| {
            s.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
                .map(|rows| rows.filter_map(|r| r.ok()).collect())
        })
        .unwrap_or_default();

    if runtime_agents.is_empty() && plugin_agents.is_empty() {
        println!("No agents registered.");
        return Ok(());
    }

    println!(
        "{:<36}  {:<20}  {:<12}  {:<10}  PROJECT",
        "ID", "NAME", "RUNTIME", "STATUS"
    );
    println!("{}", "-".repeat(110));
    for a in &runtime_agents {
        println!(
            "{:<36}  {:<20}  {:<12}  {:<10}  {}",
            a.id, a.name, a.runtime, "—", a.project_path
        );
    }
    for (id, name, version, status) in &plugin_agents {
        println!(
            "{:<36}  {:<20}  {:<12}  {:<10}  —",
            id,
            format!("{} v{}", name, version),
            name,
            status
        );
    }
    Ok(())
}

fn get(conn: &Connection, id: &str) -> Result<()> {
    let agent = conn
        .query_row(
            "SELECT id, name, project_path, runtime, created_at FROM agents WHERE id = ?1",
            [id],
            |r| {
                Ok(AgentRow {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    project_path: r.get(2)?,
                    runtime: r.get(3)?,
                    created_at: r.get(4)?,
                })
            },
        )
        .context("Agent not found")?;
    println!("{}", serde_json::to_string_pretty(&agent)?);
    Ok(())
}

fn update(
    conn: &Connection,
    id: &str,
    name: Option<String>,
    project: Option<String>,
    runtime: Option<String>,
) -> Result<()> {
    if let Some(n) = name {
        conn.execute(
            "UPDATE agents SET name = ?1 WHERE id = ?2",
            rusqlite::params![n, id],
        )?;
    }
    if let Some(p) = project {
        conn.execute(
            "UPDATE agents SET project_path = ?1 WHERE id = ?2",
            rusqlite::params![p, id],
        )?;
    }
    if let Some(r) = runtime {
        conn.execute(
            "UPDATE agents SET runtime = ?1 WHERE id = ?2",
            rusqlite::params![r, id],
        )?;
    }
    println!("Agent {} updated.", id);
    Ok(())
}

fn delete(conn: &Connection, id: &str) -> Result<()> {
    use std::io::{self, Write};
    print!("Delete agent {}? [y/N]: ", id);
    io::stdout().flush()?;
    let mut buf = String::new();
    io::stdin().read_line(&mut buf)?;
    if buf.trim().to_lowercase() != "y" {
        println!("Cancelled.");
        return Ok(());
    }
    let n = conn.execute("DELETE FROM agents WHERE id = ?1", [id])?;
    if n == 0 {
        anyhow::bail!("Agent not found.");
    }
    println!("Agent {} deleted.", id);
    Ok(())
}

fn invoke(conn: &Connection, agent_id: &str, message: &str) -> Result<()> {
    let _: String = conn
        .query_row("SELECT id FROM agents WHERE id = ?1", [agent_id], |r| {
            r.get(0)
        })
        .context("Agent not found")?;

    let conv_id = Uuid::new_v4().to_string();
    let msg_id = Uuid::new_v4().to_string();
    let now = now_ms();
    let title = message.chars().take(60).collect::<String>();

    conn.execute(
        "INSERT INTO conversations (id, agent_id, title, created_at, last_message_at, status) VALUES (?1,?2,?3,?4,?5,'idle')",
        rusqlite::params![conv_id, agent_id, title, now, now],
    )?;
    conn.execute(
        "INSERT INTO messages (id, conversation_id, role, payload, created_at, seq) VALUES (?1,?2,'user_text',?3,?4,1)",
        rusqlite::params![msg_id, conv_id, serde_json::json!({"text": message}).to_string(), now],
    )?;
    println!("Conversation created: {}", conv_id);
    println!("Message sent. Connect msctl serve to process.");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// agent register: inserts a row into agents table.
    ///
    /// Data construction:
    ///   name         = "blog-fixer"
    ///   project_path = "/home/user/blog"
    ///   runtime      = "claude-code"
    ///
    /// Execution:
    ///   1. Open temp SQLite DB
    ///   2. Call insert_agent()
    ///   3. Query agents table
    ///
    /// Expected:
    ///   - exactly 1 row with name == "blog-fixer"
    ///   - runtime == "claude-code"
    #[test]
    fn test_insert_agent_writes_row() {
        let dir = tempfile::tempdir().unwrap();
        let conn = crate::db::open_at(&dir.path().join("test.db")).unwrap();
        insert_agent(
            &conn,
            "blog-fixer",
            "/home/user/blog",
            "claude-code",
            "full-auto",
        )
        .unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM agents WHERE name = 'blog-fixer'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1, "insert_agent should create exactly one row");
        let runtime: String = conn
            .query_row(
                "SELECT runtime FROM agents WHERE name = 'blog-fixer'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(runtime, "claude-code", "runtime should be stored as-is");
    }

    /// agent register: duplicate name returns an error.
    ///
    /// Execution:
    ///   1. Insert agent "dup-agent"
    ///   2. Insert agent "dup-agent" again
    ///
    /// Expected:
    ///   - second insert returns Err (UNIQUE constraint)
    #[test]
    fn test_insert_agent_duplicate_name_errors() {
        let dir = tempfile::tempdir().unwrap();
        let conn = crate::db::open_at(&dir.path().join("test.db")).unwrap();
        insert_agent(&conn, "dup-agent", "/p", "claude-code", "full-auto").unwrap();
        let result = insert_agent(&conn, "dup-agent", "/p2", "codex", "full-auto");
        assert!(result.is_err(), "duplicate name should return an error");
    }

    /// agent register: mode column is stored correctly.
    ///
    /// Data construction:
    ///   name    = "codex-agent"
    ///   runtime = "codex"
    ///   mode    = "full-auto"
    ///
    /// Execution:
    ///   1. Open temp DB
    ///   2. Call insert_agent with mode="full-auto"
    ///   3. Query agents.mode
    ///
    /// Expected:
    ///   - mode == "full-auto"
    #[test]
    fn test_insert_agent_stores_mode() {
        let dir = tempfile::tempdir().unwrap();
        let conn = crate::db::open_at(&dir.path().join("test.db")).unwrap();
        insert_agent(&conn, "codex-agent", "/p", "codex", "full-auto").unwrap();
        let mode: String = conn
            .query_row(
                "SELECT mode FROM agents WHERE name = 'codex-agent'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(mode, "full-auto", "mode should be stored as-is");
    }

    /// cursor-cli runtime string is stored like any other runtime.
    #[test]
    fn test_insert_agent_cursor_cli_runtime() {
        let dir = tempfile::tempdir().unwrap();
        let conn = crate::db::open_at(&dir.path().join("test.db")).unwrap();
        insert_agent(
            &conn,
            "cursor-agent",
            "/tmp/proj",
            "cursor-cli",
            "full-auto",
        )
        .unwrap();
        let rt: String = conn
            .query_row(
                "SELECT runtime FROM agents WHERE name = 'cursor-agent'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(rt, "cursor-cli");
    }

    /// register --type plugin 写入 plugin_agents 表，不写 agents 表
    ///
    /// 数据构造：
    ///   在 agents/ 目录创建 fix-bug-bot 可执行文件和 fix-bug-bot.toml
    ///
    /// 执行：
    ///   1. 调用 register_plugin(&conn, "fix-bug-bot", &agents_dir)
    ///   2. 查询 plugin_agents 表
    ///   3. 查询 agents 表
    ///
    /// 预期：
    ///   - plugin_agents 中有 name="fix-bug-bot" 的记录
    ///   - agents 表记录数不变（零改动）
    #[test]
    fn test_register_plugin_writes_plugin_agents_not_agents() {
        use std::fs;
        let dir = tempfile::tempdir().unwrap();
        let conn = crate::db::open_at(&dir.path().join("test.db")).unwrap();
        let agents_dir = dir.path().join("agents");
        fs::create_dir_all(&agents_dir).unwrap();

        let exe = agents_dir.join("fix-bug-bot");
        fs::write(&exe, b"#!/bin/sh\necho ok").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&exe, fs::Permissions::from_mode(0o755)).unwrap();
        }

        let toml_content = r#"
[agent]
name = "fix-bug-bot"
version = "0.1.0"
executable = "fix-bug-bot"
description = "test"

[[triggers]]
event = "feishu.issue.updated"
"#;
        fs::write(agents_dir.join("fix-bug-bot.toml"), toml_content).unwrap();

        register_plugin(&conn, "fix-bug-bot", &agents_dir).unwrap();

        let plugin_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM plugin_agents WHERE name='fix-bug-bot'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(plugin_count, 1, "plugin_agents should have one record");

        let agents_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM agents", [], |r| r.get(0))
            .unwrap();
        assert_eq!(agents_count, 0, "agents table must not be modified");
    }
}