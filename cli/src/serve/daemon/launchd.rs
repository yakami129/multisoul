#![cfg(target_os = "macos")]

use anyhow::Result;
use super::{Config, Manager, Status, SERVICE_LABEL};

pub struct LaunchdManager;

pub fn new_manager() -> Result<Box<dyn Manager>> {
    Ok(Box::new(LaunchdManager))
}

fn plist_path() -> std::path::PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("Library")
        .join("LaunchAgents")
        .join(format!("{}.plist", SERVICE_LABEL))
}

fn build_plist(cfg: &Config) -> String {
    format!(r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>{label}</string>
    <key>ProgramArguments</key>
    <array>
        <string>{binary}</string>
        <string>serve</string>
        <string>--token</string>
        <string>{token}</string>
        <string>--port</string>
        <string>{port}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <true/>
    </dict>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>{path}</string>
    </dict>
    <key>StandardOutPath</key>
    <string>{log}</string>
    <key>StandardErrorPath</key>
    <string>{log}</string>
</dict>
</plist>
"#,
        label  = SERVICE_LABEL,
        binary = cfg.binary_path,
        token  = cfg.token,
        port   = cfg.port,
        path   = cfg.env_path,
        log    = cfg.log_file,
    )
}

fn launchctl(args: &[&str]) -> anyhow::Result<String> {
    use std::process::Command;
    let out = Command::new("launchctl")
        .args(args)
        .output()
        .map_err(|e| anyhow::anyhow!("launchctl not found: {}", e))?;
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string()
        + &String::from_utf8_lossy(&out.stderr).trim().to_string())
}

fn domain() -> String {
    format!("gui/{}", unsafe { libc::getuid() })
}

fn target() -> String {
    format!("{}/{}", domain(), SERVICE_LABEL)
}

impl Manager for LaunchdManager {
    fn platform(&self) -> &'static str { "launchd" }

    fn install(&self, cfg: &Config) -> Result<()> {
        let plist = plist_path();
        std::fs::create_dir_all(plist.parent().unwrap())?;
        if let Some(log_dir) = std::path::Path::new(&cfg.log_file).parent() {
            std::fs::create_dir_all(log_dir)?;
        }
        let _ = launchctl(&["bootout", &target()]);
        std::fs::write(&plist, build_plist(cfg))?;
        let plist_str = plist.to_string_lossy().into_owned();
        launchctl(&["bootstrap", &domain(), &plist_str])
            .map_err(|e| anyhow::anyhow!("launchctl bootstrap failed: {}", e))?;
        launchctl(&["kickstart", "-kp", &target()])
            .map_err(|e| anyhow::anyhow!("launchctl kickstart failed: {}", e))?;
        Ok(())
    }

    fn uninstall(&self) -> Result<()> {
        let _ = launchctl(&["bootout", &target()]);
        let plist = plist_path();
        if plist.exists() { std::fs::remove_file(&plist)?; }
        Ok(())
    }

    fn start(&self) -> Result<()> {
        let plist_str = plist_path().to_string_lossy().into_owned();
        if launchctl(&["bootstrap", &domain(), &plist_str]).is_err() {
            launchctl(&["kickstart", "-kp", &target()])?;
        }
        Ok(())
    }

    fn stop(&self) -> Result<()> {
        launchctl(&["bootout", &target()])?;
        Ok(())
    }

    fn restart(&self) -> Result<()> {
        let _ = launchctl(&["bootout", &target()]);
        let plist_str = plist_path().to_string_lossy().into_owned();
        for i in 0..3 {
            if i > 0 { std::thread::sleep(std::time::Duration::from_millis(500)); }
            if launchctl(&["bootstrap", &domain(), &plist_str]).is_ok() { break; }
        }
        launchctl(&["kickstart", "-kp", &target()])?;
        Ok(())
    }

    fn status(&self) -> Result<Status> {
        let installed = plist_path().exists();
        if !installed {
            return Ok(Status { installed: false, running: false, pid: None, platform: "launchd" });
        }
        let out = launchctl(&["print", &target()]).unwrap_or_default();
        let mut pid = None;
        let mut running = false;
        for line in out.lines() {
            let t = line.trim();
            if let Some(rest) = t.strip_prefix("pid = ") {
                if let Ok(p) = rest.parse::<u32>() {
                    if p > 0 { pid = Some(p); running = true; }
                }
            }
            if t.contains("state = running") { running = true; }
        }
        Ok(Status { installed, running, pid, platform: "launchd" })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// build_plist embeds binary, token, port, and log path correctly.
    ///
    /// Data:
    ///   binary = "/usr/local/bin/msctl"
    ///   token  = "ms_v2_test"
    ///   port   = 9000
    ///   log    = "/tmp/msctl.log"
    ///
    /// Expected:
    ///   - plist contains the binary path
    ///   - plist contains the token
    ///   - plist contains port "9000"
    ///   - plist contains the log path
    ///   - plist does NOT contain "8765" (wrong default leaked in)
    #[test]
    fn test_build_plist_contains_correct_values() {
        let cfg = Config {
            binary_path: "/usr/local/bin/msctl".into(),
            token: "ms_v2_test".into(),
            port: 9000,
            log_file: "/tmp/msctl.log".into(),
            env_path: "/usr/bin:/bin".into(),
        };
        let plist = build_plist(&cfg);
        assert!(plist.contains("/usr/local/bin/msctl"), "plist must contain binary path");
        assert!(plist.contains("ms_v2_test"), "plist must contain token");
        assert!(plist.contains("9000"), "plist must contain port 9000");
        assert!(plist.contains("/tmp/msctl.log"), "plist must contain log path");
        assert!(!plist.contains("8765"), "plist must not contain default port when overridden");
    }

    /// build_plist uses KeepAlive.SuccessfulExit = true so that
    /// `msctl daemon stop` does not cause launchd to auto-restart the service.
    ///
    /// Expected:
    ///   - plist contains "SuccessfulExit"
    #[test]
    fn test_build_plist_keepalive_successful_exit() {
        let cfg = Config {
            binary_path: "/bin/msctl".into(),
            token: "tok".into(),
            port: 8765,
            log_file: "/tmp/msctl.log".into(),
            env_path: "/usr/bin".into(),
        };
        let plist = build_plist(&cfg);
        assert!(plist.contains("SuccessfulExit"),
            "plist must use KeepAlive.SuccessfulExit so stop does not auto-restart");
    }
}
