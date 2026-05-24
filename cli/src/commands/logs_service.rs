//! Plain-text service log reader for daemon/launchd stdout and stderr.

use crate::serve::daemon;
use anyhow::{Context, Result};
use regex::Regex;
use std::collections::VecDeque;
use std::io::{BufRead, BufReader, Seek, SeekFrom, Write};
use std::path::PathBuf;
use std::time::Duration;

pub struct ServiceLogOptions {
    pub tail: usize,
    pub follow: bool,
    pub grep: Option<String>,
    pub log_file: Option<PathBuf>,
    pub prefix: bool,
    pub missing_ok: bool,
}

pub fn handle(opts: ServiceLogOptions) -> Result<()> {
    let path = service_log_path(opts.log_file);
    let grep = opts
        .grep
        .as_deref()
        .map(Regex::new)
        .transpose()
        .context("invalid --grep regex")?;

    if !path.exists() {
        if !opts.missing_ok {
            eprintln!("no service logs yet — run `msctl daemon install` first.");
        }
        return Ok(());
    }

    print_last_lines(&path, opts.tail, grep.as_ref(), opts.prefix)?;
    if opts.follow {
        follow_file(&path, grep.as_ref(), opts.prefix)?;
    }
    Ok(())
}

fn service_log_path(override_path: Option<PathBuf>) -> PathBuf {
    override_path.unwrap_or_else(|| {
        daemon::load_meta()
            .map(|m| PathBuf::from(m.log_file))
            .unwrap_or_else(|_| PathBuf::from(daemon::default_log_file()))
    })
}

fn print_last_lines(path: &PathBuf, n: usize, grep: Option<&Regex>, prefix: bool) -> Result<()> {
    let f = std::fs::File::open(path).with_context(|| format!("opening {}", path.display()))?;
    let reader = BufReader::new(f);
    let mut kept: VecDeque<String> = VecDeque::with_capacity(n.max(16));

    for line in reader.lines().map_while(|line| line.ok()) {
        if grep.is_some_and(|re| !re.is_match(&line)) {
            continue;
        }
        kept.push_back(line);
        if kept.len() > n {
            kept.pop_front();
        }
    }

    let stdout = std::io::stdout();
    let mut out = stdout.lock();
    for line in kept {
        emit(&mut out, &line, prefix).ok();
    }
    Ok(())
}

fn follow_file(path: &PathBuf, grep: Option<&Regex>, prefix: bool) -> Result<()> {
    let mut f = std::fs::File::open(path)?;
    f.seek(SeekFrom::End(0))?;
    let mut reader = BufReader::new(f);
    let stdout = std::io::stdout();

    loop {
        let mut line = String::new();
        match reader.read_line(&mut line) {
            Ok(0) => std::thread::sleep(Duration::from_millis(300)),
            Ok(_) => {
                let trimmed = line.trim_end();
                if grep.is_none_or(|re| re.is_match(trimmed)) {
                    let mut out = stdout.lock();
                    emit(&mut out, trimmed, prefix).ok();
                }
            }
            Err(e) => anyhow::bail!("Error reading log: {}", e),
        }
    }
}

fn emit(w: &mut impl Write, line: &str, prefix: bool) -> std::io::Result<()> {
    if prefix {
        writeln!(w, "[service] {line}")
    } else {
        writeln!(w, "{line}")
    }
}
