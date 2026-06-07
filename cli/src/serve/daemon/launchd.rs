use super::{Config, Manager, Status, SERVICE_LABEL};
use crate::config::ServeMode;
use anyhow::Result;

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

fn mode_args(cfg: &Config) -> String {
    match cfg.serve_mode {
        ServeMode::Relay => format!(
            "        <string>--relay</string>\n\
                    <string>--relay-url</string>\n\
                    <string>{}</string>\n",
            cfg.relay_url
        ),
        ServeMode::Tailnet => "        <string>--tailnet</string>\n".into(),
        ServeMode::Funnel => "        <string>--funnel</string>\n".into(),
    }
}

fn build_plist(cfg: &Config) -> String {
    let mode_arg = mode_args(cfg);
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
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
{mode_arg}    </array>
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
        label = SERVICE_LABEL,
        binary = cfg.binary_path,
        token = cfg.token,
        port = cfg.port,
        mode_arg = mode_arg,
        path = cfg.env_path,
        log = cfg.log_file,
    )
}

/// First ProgramArguments entry from a LaunchAgent plist body.
pub(crate) fn parse_plist_binary_path(content: &str) -> Option<String> {
    let mut in_program_args = false;
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed == "<key>ProgramArguments</key>" {
            in_program_args = true;
            continue;
        }
        if in_program_args && trimmed == "<array>" {
            continue;
        }
        if in_program_args {
            if let Some(value) = trimmed
                .strip_prefix("<string>")
                .and_then(|s| s.strip_suffix("</string>"))
            {
                return Some(value.to_string());
            }
            if trimmed == "</array>" {
                break;
            }
        }
    }
    None
}

pub(crate) fn launchctl_output(
    args: &[&str],
    exit_code: Option<i32>,
    stdout: &str,
    stderr: &str,
) -> anyhow::Result<String> {
    let combined = format!("{}{}", stdout.trim(), stderr.trim());
    if exit_code != Some(0) {
        anyhow::bail!(
            "launchctl {} failed (exit {}): {}",
            args.join(" "),
            exit_code.unwrap_or(-1),
            combined
        );
    }
    Ok(combined)
}

fn launchctl(args: &[&str]) -> anyhow::Result<String> {
    use std::process::Command;
    let out = Command::new("launchctl")
        .args(args)
        .output()
        .map_err(|e| anyhow::anyhow!("launchctl not found: {}", e))?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);
    launchctl_output(args, out.status.code(), &stdout, &stderr)
}

/// First ProgramArguments entry from the installed LaunchAgent plist.
pub fn installed_binary_path() -> Option<String> {
    let plist = plist_path();
    if !plist.exists() {
        return None;
    }
    let content = std::fs::read_to_string(plist).ok()?;
    parse_plist_binary_path(&content)
}

fn domain() -> String {
    format!("gui/{}", unsafe { libc::getuid() })
}

fn target() -> String {
    format!("{}/{}", domain(), SERVICE_LABEL)
}

fn bootout_best_effort(plist: &std::path::Path) {
    let domain = domain();
    let target = target();
    let plist_str = plist.to_string_lossy().into_owned();
    let _ = launchctl(&["bootout", &target]);
    let _ = launchctl(&["bootout", &domain, &plist_str]);
}

fn bootstrap_plist(plist: &std::path::Path) -> Result<()> {
    let domain = domain();
    let plist_str = plist.to_string_lossy().into_owned();
    match launchctl(&["bootstrap", &domain, &plist_str]) {
        Ok(_) => Ok(()),
        Err(e) => {
            let msg = e.to_string();
            // Exit 5: job already loaded in domain (bootout race or stale registration).
            if !msg.contains("exit 5") {
                return Err(e);
            }
            bootout_best_effort(plist);
            std::thread::sleep(std::time::Duration::from_millis(300));
            launchctl(&["bootstrap", &domain, &plist_str])?;
            Ok(())
        }
    }
}

impl Manager for LaunchdManager {
    fn platform(&self) -> &'static str {
        "launchd"
    }

    fn install(&self, cfg: &Config) -> Result<()> {
        let plist = plist_path();
        std::fs::create_dir_all(plist.parent().unwrap())?;
        if let Some(log_dir) = std::path::Path::new(&cfg.log_file).parent() {
            std::fs::create_dir_all(log_dir)?;
        }
        bootout_best_effort(&plist);
        std::fs::write(&plist, build_plist(cfg))?;
        bootstrap_plist(&plist)
            .map_err(|e| anyhow::anyhow!("launchctl bootstrap failed: {}", e))?;
        launchctl(&["kickstart", "-kp", &target()])
            .map_err(|e| anyhow::anyhow!("launchctl kickstart failed: {}", e))?;
        Ok(())
    }

    fn uninstall(&self) -> Result<()> {
        let _ = launchctl(&["bootout", &target()]);
        let plist = plist_path();
        if plist.exists() {
            std::fs::remove_file(&plist)?;
        }
        Ok(())
    }

    fn start(&self) -> Result<()> {
        if let Some(binary) = installed_binary_path() {
            super::require_installed_binary(&binary)?;
        }
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
        if let Some(binary) = installed_binary_path() {
            super::require_installed_binary(&binary)?;
        }
        let _ = launchctl(&["bootout", &target()]);
        let plist_str = plist_path().to_string_lossy().into_owned();
        for i in 0..3 {
            if i > 0 {
                std::thread::sleep(std::time::Duration::from_millis(500));
            }
            if launchctl(&["bootstrap", &domain(), &plist_str]).is_ok() {
                break;
            }
        }
        launchctl(&["kickstart", "-kp", &target()])?;
        Ok(())
    }

    fn status(&self) -> Result<Status> {
        let installed = plist_path().exists();
        if !installed {
            return Ok(Status {
                installed: false,
                running: false,
                pid: None,
                platform: "launchd",
            });
        }
        let out = launchctl(&["print", &target()]).unwrap_or_default();
        let mut pid = None;
        let mut running = false;
        for line in out.lines() {
            let t = line.trim();
            if let Some(rest) = t.strip_prefix("pid = ") {
                if let Ok(p) = rest.parse::<u32>() {
                    if p > 0 {
                        pid = Some(p);
                        running = true;
                    }
                }
            }
            if t.contains("state = running") {
                running = true;
            }
        }
        Ok(Status {
            installed,
            running,
            pid,
            platform: "launchd",
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::ServeMode;

    fn sample_cfg(serve_mode: ServeMode) -> Config {
        Config {
            binary_path: "/usr/local/bin/msctl".into(),
            token: "ms_v2_test".into(),
            port: 9000,
            serve_mode,
            relay_url: "https://relay.example.dev".into(),
            log_file: "/tmp/msctl.log".into(),
            env_path: "/usr/bin:/bin".into(),
        }
    }

    #[test]
    fn test_build_plist_contains_correct_values() {
        let cfg = sample_cfg(ServeMode::Tailnet);
        let plist = build_plist(&cfg);
        assert!(
            plist.contains("/usr/local/bin/msctl"),
            "plist must contain binary path"
        );
        assert!(plist.contains("ms_v2_test"), "plist must contain token");
        assert!(plist.contains("9000"), "plist must contain port 9000");
        assert!(
            plist.contains("--tailnet"),
            "plist must include --tailnet when enabled"
        );
        assert!(
            plist.contains("/tmp/msctl.log"),
            "plist must contain log path"
        );
        assert!(
            !plist.contains("8765"),
            "plist must not contain default port when overridden"
        );
    }

    #[test]
    fn test_build_plist_relay_contains_relay_and_url() {
        let cfg = sample_cfg(ServeMode::Relay);
        let plist = build_plist(&cfg);
        assert!(
            plist.contains("--relay"),
            "relay plist must include --relay"
        );
        assert!(
            plist.contains("--relay-url"),
            "relay plist must include --relay-url"
        );
        assert!(
            plist.contains("https://relay.example.dev"),
            "relay plist must include relay URL"
        );
        assert!(
            !plist.contains("--tailnet"),
            "relay plist must not include --tailnet"
        );
    }

    #[test]
    fn test_build_plist_funnel_contains_funnel() {
        let cfg = sample_cfg(ServeMode::Funnel);
        let plist = build_plist(&cfg);
        assert!(
            plist.contains("--funnel"),
            "funnel plist must include --funnel"
        );
        assert!(
            !plist.contains("--relay"),
            "funnel plist must not include --relay"
        );
    }

    #[test]
    fn test_build_plist_tailnet_omits_relay() {
        let cfg = sample_cfg(ServeMode::Tailnet);
        let plist = build_plist(&cfg);
        assert!(plist.contains("--tailnet"));
        assert!(!plist.contains("--relay"));
    }

    #[test]
    fn test_build_plist_keepalive_successful_exit() {
        let cfg = Config {
            binary_path: "/bin/msctl".into(),
            token: "tok".into(),
            port: 8765,
            serve_mode: ServeMode::Relay,
            relay_url: "https://relay.example.dev".into(),
            log_file: "/tmp/msctl.log".into(),
            env_path: "/usr/bin".into(),
        };
        let plist = build_plist(&cfg);
        assert!(
            plist.contains("SuccessfulExit"),
            "plist must use KeepAlive.SuccessfulExit so stop does not auto-restart"
        );
        assert!(
            !plist.contains("--tailnet"),
            "relay plist must omit --tailnet"
        );
    }

    #[test]
    fn parse_plist_binary_path_reads_first_program_argument() {
        let plist = build_plist(&sample_cfg(ServeMode::Tailnet));
        assert_eq!(
            parse_plist_binary_path(&plist).as_deref(),
            Some("/usr/local/bin/msctl")
        );
    }

    #[test]
    fn parse_plist_binary_path_returns_none_without_program_arguments() {
        let plist = r#"<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.example.app</string>
</dict>
</plist>"#;
        assert_eq!(parse_plist_binary_path(plist), None);
    }

    #[test]
    fn launchctl_output_succeeds_on_exit_zero() {
        let out = launchctl_output(
            &["kickstart", "-kp", "gui/501/com.multisoul.msctl"],
            Some(0),
            "ok",
            "",
        )
        .expect("launchctl_output");
        assert_eq!(out, "ok");
    }

    #[test]
    fn launchctl_output_fails_on_nonzero_exit() {
        let err = launchctl_output(
            &["kickstart", "-kp", "gui/501/com.multisoul.msctl"],
            Some(78),
            "",
            "Bootstrap failed",
        )
        .unwrap_err();
        let message = err.to_string();
        assert!(
            message.contains("launchctl kickstart"),
            "unexpected: {message}"
        );
        assert!(message.contains("exit 78"), "unexpected: {message}");
        assert!(
            message.contains("Bootstrap failed"),
            "unexpected: {message}"
        );
    }
}
