use crate::serve::plugin::protocol::TaskMessage;
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

    /// 进程启动
    pub fn start(&mut self) -> Result<()> {
        let mut child = Command::new(&self.executable)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()?;
        self.stdin = child.stdin.take();
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
