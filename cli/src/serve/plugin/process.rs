use crate::serve::plugin::protocol::{AgentEvent, TaskMessage};
use anyhow::Result;
use std::io::Write;
use std::process::{Child, ChildStdin, Command, Stdio};

#[derive(Debug, PartialEq, Clone)]
pub enum AgentStatus {
    Running,
    Restarting,
    Failed,
}

pub struct AgentProcess {
    pub name: String,
    pub executable: std::path::PathBuf,
    pub restart_count: u32,
    pub status: AgentStatus,
    child: Option<Child>,
    stdin: Option<ChildStdin>,
}

impl AgentProcess {
    pub fn new(name: &str, executable: std::path::PathBuf) -> Self {
        Self {
            name: name.to_string(),
            executable,
            restart_count: 0,
            status: AgentStatus::Failed,
            child: None,
            stdin: None,
        }
    }

    /// 进程启动，并在后台 task 中消费 stdout（防止 pipe buffer 满导致 agent 阻塞）
    pub fn start(&mut self) -> Result<()> {
        let mut child = Command::new(&self.executable)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()?;
        self.stdin = child.stdin.take();

        // 消费 stdout：每行解析为 AgentEvent 并记录日志
        if let Some(stdout) = child.stdout.take() {
            let agent_name = self.name.clone();
            tokio::spawn(async move {
                use std::io::BufRead;
                let reader = std::io::BufReader::new(stdout);
                for line in reader.lines() {
                    match line {
                        Ok(l) if l.trim().is_empty() => continue,
                        Ok(l) => match serde_json::from_str::<AgentEvent>(&l) {
                            Ok(AgentEvent::Progress {
                                task_id,
                                conversation_id,
                                message,
                            }) => {
                                tracing::info!(agent = %agent_name, task = %task_id, conv = %conversation_id, "progress: {}", message);
                            }
                            Ok(AgentEvent::Result {
                                task_id,
                                conversation_id,
                                status,
                                data,
                                error,
                            }) => {
                                tracing::info!(agent = %agent_name, task = %task_id, conv = %conversation_id, has_data = data.is_some(), err = ?error, "result: status={}", status);
                            }
                            Ok(AgentEvent::Error {
                                task_id,
                                conversation_id,
                                code,
                                message,
                            }) => {
                                tracing::warn!(agent = %agent_name, task = %task_id, conv = %conversation_id, "error: code={} msg={}", code, message);
                            }
                            Err(_) => {
                                tracing::debug!(agent = %agent_name, "stdout: {}", l);
                            }
                        },
                        Err(e) => {
                            tracing::warn!(agent = %agent_name, "stdout read error: {}", e);
                            break;
                        }
                    }
                }
            });
        }

        self.child = Some(child);
        self.status = AgentStatus::Running;
        Ok(())
    }

    /// 向 agent stdin 写入一条任务（NDJSON 行）
    pub fn send_task(&mut self, msg: &TaskMessage) -> Result<()> {
        if let Some(stdin) = &mut self.stdin {
            let line = serde_json::to_string(msg)?;
            writeln!(stdin, "{}", line)?;
            stdin.flush()?;
        }
        Ok(())
    }

    /// 检查进程是否仍在运行
    pub fn is_alive(&mut self) -> bool {
        if let Some(child) = &mut self.child {
            matches!(child.try_wait(), Ok(None))
        } else {
            false
        }
    }
}
