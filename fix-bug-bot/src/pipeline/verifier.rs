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
    pub fn for_rust(test_path: &str, target_test_cmd: &str) -> Self {
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

        steps.push(VerificationStep {
            name: "Clippy lint".to_string(),
            cmd: "cargo".to_string(),
            args: vec![
                "clippy".to_string(),
                "--".to_string(),
                "-D".to_string(),
                "warnings".to_string(),
            ],
        });

        let _ = test_path;
        Self { steps }
    }
}

pub fn run_command(cmd: &str, args: &[&str], cwd: &str) -> Result<String> {
    let output = Command::new(cmd).args(args).current_dir(cwd).output()?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        anyhow::bail!("Command `{} {}` failed: {}", cmd, args.join(" "), stderr)
    }
}

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

    VerificationResult {
        passed: true,
        failed_step: None,
        output: all_output,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_run_command_success() {
        let result = run_command("echo", &["hello"], "/tmp");
        assert!(result.is_ok(), "echo must succeed");
        assert!(result.unwrap().contains("hello"), "stdout must contain hello");
    }

    #[test]
    fn test_run_command_failure() {
        let result = run_command("false", &[], "/tmp");
        assert!(result.is_err(), "false command must return Err");
    }

    #[test]
    fn test_verification_plan_for_rust() {
        let plan =
            VerificationPlan::for_rust("tests/login_test.rs", "cargo test test_login_fails");
        assert!(!plan.steps.is_empty(), "must have verification steps");
        let cmds: Vec<_> = plan.steps.iter().map(|s| &s.cmd).collect();
        assert!(
            cmds.iter().any(|c| c.as_str() == "cargo"),
            "must include cargo commands"
        );
        let all_args: Vec<_> = plan.steps.iter().flat_map(|s| s.args.iter()).collect();
        assert!(
            all_args.iter().any(|a| a.as_str() == "build"),
            "must include cargo build"
        );
    }
}
