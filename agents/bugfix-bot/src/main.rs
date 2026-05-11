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

    let existing = db::find_by_feishu_id(&conn, &ctx.feishu_issue_id).ok().flatten();
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

    let task_id = if let Some(ref task) = existing {
        task.id.clone()
    } else {
        match db::insert_bug_task(&conn, &ctx.feishu_issue_id) {
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

    run_pipeline(&conn, &cfg, &ctx, &task_id, msg);
}

fn run_pipeline(
    conn: &rusqlite::Connection,
    cfg: &config::Config,
    ctx: &pipeline::intake::IssueContext,
    bug_task_id: &str,
    msg: &protocol::TaskMessage,
) {
    // Resolve project path from module_repo_map
    let project_path = match cfg.module_repo_map.get(&ctx.module) {
        Some(entry) => entry.local_path.clone(),
        None => {
            AgentEvent::Error {
                task_id: msg.task_id.clone(),
                conversation_id: msg.conversation_id.clone(),
                code: "config_error".to_string(),
                message: format!("Module '{}' not found in module_repo_map", ctx.module),
            }.emit();
            return;
        }
    };

    let gitlab = gitlab::GitlabClient::new(&cfg.gitlab.base_url, &cfg.gitlab.access_token);
    let feishu = feishu::FeishuClient::new(&cfg.feishu.bot_app_id, &cfg.feishu.bot_app_secret);
    let project_id = cfg.gitlab.gitlab_project_id;

    // ── Stage 1: Intake ──────────────────────────────────────────────────────
    AgentEvent::Progress {
        task_id: msg.task_id.clone(),
        conversation_id: msg.conversation_id.clone(),
        message: "stage=intake: evaluating issue sufficiency".to_string(),
    }.emit();

    let sufficiency_prompt = pipeline::intake::build_sufficiency_prompt(ctx);
    let sufficiency_output = match claude::run(&sufficiency_prompt, &project_path, None) {
        Ok(o) => o,
        Err(e) => {
            AgentEvent::Error {
                task_id: msg.task_id.clone(),
                conversation_id: msg.conversation_id.clone(),
                code: "claude_error".to_string(),
                message: format!("Stage 1 claude::run failed: {}", e),
            }.emit();
            return;
        }
    };

    let sufficiency = pipeline::intake::parse_sufficiency_result(&sufficiency_output.result_text);

    if !sufficiency.is_sufficient {
        // Create GitLab issue with bot:blocked label
        let issue_title = format!("[AutoFix] {}", ctx.title);
        let issue_desc = format!("飞书缺陷 {} 信息不足，无法自动处理。\n\n缺失字段：{}", ctx.feishu_issue_id, sufficiency.missing_fields.join(", "));
        let labels = [cfg.gitlab.blocked_label.as_str()];
        if let Err(e) = gitlab.create_issue(project_id, &issue_title, &issue_desc, &labels) {
            eprintln!("[bugfix-bot] create_issue (blocked) failed: {}", e);
        }

        // Post Feishu comment with missing fields
        let missing_refs: Vec<&str> = sufficiency.missing_fields.iter().map(|s| s.as_str()).collect();
        let comment = feishu::build_missing_info_comment(&missing_refs, &ctx.assignee);
        if let Err(e) = feishu.add_issue_comment(&ctx.feishu_issue_id, &comment) {
            eprintln!("[bugfix-bot] add_issue_comment failed: {}", e);
        }

        let _ = db::update_status(conn, bug_task_id, "blocked_info");

        AgentEvent::Result {
            task_id: msg.task_id.clone(),
            conversation_id: msg.conversation_id.clone(),
            status: "blocked_info".to_string(),
            data: None,
            error: None,
        }.emit();
        return;
    }

    // Sufficient — create open GitLab issue (no blocked label)
    let issue_title = format!("[AutoFix] {}", ctx.title);
    let issue_desc = format!("飞书缺陷 {} 自动修复流程已启动。", ctx.feishu_issue_id);
    let gitlab_issue = match gitlab.create_issue(project_id, &issue_title, &issue_desc, &[]) {
        Ok(i) => i,
        Err(e) => {
            AgentEvent::Error {
                task_id: msg.task_id.clone(),
                conversation_id: msg.conversation_id.clone(),
                code: "gitlab_error".to_string(),
                message: format!("create_issue failed: {}", e),
            }.emit();
            return;
        }
    };

    let _ = db::update_fields(conn, bug_task_id, &db::UpdateFields {
        status: Some("analyzing".to_string()),
        gitlab_issue_id: Some(gitlab_issue.iid),
        ..Default::default()
    });

    // ── Stage 2: Reproducer ──────────────────────────────────────────────────
    AgentEvent::Progress {
        task_id: msg.task_id.clone(),
        conversation_id: msg.conversation_id.clone(),
        message: "stage=reproducer: finding failing test".to_string(),
    }.emit();

    let reproducer_prompt = pipeline::reproducer::build_reproducer_prompt(
        &ctx.title, &ctx.logs, &project_path,
    );
    let reproducer_output = match claude::run(&reproducer_prompt, &project_path, None) {
        Ok(o) => o,
        Err(e) => {
            AgentEvent::Error {
                task_id: msg.task_id.clone(),
                conversation_id: msg.conversation_id.clone(),
                code: "claude_error".to_string(),
                message: format!("Stage 2 claude::run failed: {}", e),
            }.emit();
            return;
        }
    };

    // Save session_id
    if let Some(ref sid) = reproducer_output.session_id {
        let _ = db::update_fields(conn, bug_task_id, &db::UpdateFields {
            claude_session_id: Some(sid.clone()),
            ..Default::default()
        });
    }

    let reproducer = match pipeline::reproducer::parse_reproducer_result(&reproducer_output.result_text) {
        Ok(r) => r,
        Err(e) => {
            AgentEvent::Error {
                task_id: msg.task_id.clone(),
                conversation_id: msg.conversation_id.clone(),
                code: "parse_error".to_string(),
                message: format!("parse_reproducer_result failed: {}", e),
            }.emit();
            return;
        }
    };

    if !reproducer.reproduced {
        let _ = db::update_status(conn, bug_task_id, "blocked_no_reproduce");
        let notify_msg = format!(
            "bugfix-bot 无法复现缺陷 {}（{}），请人工介入。原因：{}",
            ctx.feishu_issue_id, ctx.title, reproducer.reason
        );
        if let Err(e) = feishu.send_message(&ctx.assignee, &notify_msg) {
            eprintln!("[bugfix-bot] send_message (no_reproduce) failed: {}", e);
        }
        AgentEvent::Result {
            task_id: msg.task_id.clone(),
            conversation_id: msg.conversation_id.clone(),
            status: "blocked_no_reproduce".to_string(),
            data: None,
            error: None,
        }.emit();
        return;
    }

    // Create git worktree
    let wt_path = match worktree::create(&project_path, &ctx.feishu_issue_id) {
        Ok(p) => p,
        Err(e) => {
            AgentEvent::Error {
                task_id: msg.task_id.clone(),
                conversation_id: msg.conversation_id.clone(),
                code: "worktree_error".to_string(),
                message: format!("worktree::create failed: {}", e),
            }.emit();
            return;
        }
    };
    let wt_path_str = wt_path.to_string_lossy().to_string();
    let branch = worktree::branch_name_for(&ctx.feishu_issue_id);

    let _ = db::update_fields(conn, bug_task_id, &db::UpdateFields {
        status: Some("fixing".to_string()),
        worktree_path: Some(wt_path_str.clone()),
        branch_name: Some(branch.clone()),
        ..Default::default()
    });

    // ── Stage 3-4: Patch + Verify loop (up to 5 retries) ────────────────────
    AgentEvent::Progress {
        task_id: msg.task_id.clone(),
        conversation_id: msg.conversation_id.clone(),
        message: "stage=patch: starting patch+verify loop".to_string(),
    }.emit();

    // Retrieve current retry_count from DB
    let initial_retry = db::find_by_feishu_id(conn, &ctx.feishu_issue_id)
        .ok()
        .flatten()
        .map(|t| t.retry_count)
        .unwrap_or(0);

    let session_id = reproducer_output.session_id.clone();
    let mut patch_result_opt: Option<pipeline::patch::PatchResult> = None;
    let mut verification_passed = false;

    let mut retry_count = initial_retry;
    while pipeline::should_retry(retry_count) {
        let patch_prompt = pipeline::patch::build_patch_prompt(
            &ctx.title,
            &reproducer.test_path,
            &reproducer.run_cmd,
            &wt_path_str,
        );
        let patch_output = match claude::run(
            &patch_prompt,
            &wt_path_str,
            session_id.as_deref(),
        ) {
            Ok(o) => o,
            Err(e) => {
                eprintln!("[bugfix-bot] patch claude::run failed (retry {}): {}", retry_count, e);
                let _ = db::increment_retry(conn, bug_task_id);
                retry_count += 1;
                continue;
            }
        };

        let patch = match pipeline::patch::parse_patch_result(&patch_output.result_text) {
            Ok(p) => p,
            Err(e) => {
                eprintln!("[bugfix-bot] parse_patch_result failed: {}", e);
                let _ = db::increment_retry(conn, bug_task_id);
                retry_count += 1;
                continue;
            }
        };

        if patch.patched {
            let plan = pipeline::verifier::VerificationPlan::for_rust(
                &reproducer.test_path,
                &reproducer.run_cmd,
            );
            let vresult = pipeline::verifier::run_plan(&plan, &wt_path_str);
            if vresult.passed {
                patch_result_opt = Some(patch);
                verification_passed = true;
                break;
            } else {
                eprintln!(
                    "[bugfix-bot] verification failed at step {:?} (retry {})",
                    vresult.failed_step, retry_count
                );
            }
        }

        let _ = db::increment_retry(conn, bug_task_id);
        retry_count += 1;
    }

    if !verification_passed {
        let _ = db::update_status(conn, bug_task_id, "blocked_fix_failed");
        if let Err(e) = gitlab.add_label(project_id, gitlab_issue.iid, &cfg.gitlab.blocked_label) {
            eprintln!("[bugfix-bot] add_label (fix_failed) failed: {}", e);
        }
        let notify_msg = format!(
            "bugfix-bot 无法自动修复缺陷 {}（{}），已达最大重试次数，请人工介入。",
            ctx.feishu_issue_id, ctx.title
        );
        if let Err(e) = feishu.send_message(&ctx.assignee, &notify_msg) {
            eprintln!("[bugfix-bot] send_message (fix_failed) failed: {}", e);
        }
        AgentEvent::Result {
            task_id: msg.task_id.clone(),
            conversation_id: msg.conversation_id.clone(),
            status: "blocked_fix_failed".to_string(),
            data: None,
            error: None,
        }.emit();
        return;
    }

    let patch_result = patch_result_opt.expect("verification_passed implies patch_result_opt is Some");

    // ── Stage 5: Publish ─────────────────────────────────────────────────────
    AgentEvent::Progress {
        task_id: msg.task_id.clone(),
        conversation_id: msg.conversation_id.clone(),
        message: "stage=publish: committing and creating MR".to_string(),
    }.emit();

    let mr_title = pipeline::publisher::build_mr_title(&ctx.feishu_issue_id, &ctx.title);
    let test_name = reproducer.run_cmd
        .strip_prefix("cargo test ")
        .unwrap_or(&reproducer.run_cmd)
        .trim()
        .to_string();
    let mr_description = pipeline::publisher::build_mr_description(
        &ctx.feishu_issue_id,
        &ctx.title,
        &patch_result.root_cause,
        &patch_result.reason,
        &reproducer.test_path,
        &test_name,
        gitlab_issue.iid,
    );

    let commit_msg = format!("fix: {} (auto-fix for {})", ctx.title, ctx.feishu_issue_id);
    if let Err(e) = pipeline::publisher::commit_worktree(&wt_path_str, &commit_msg) {
        AgentEvent::Error {
            task_id: msg.task_id.clone(),
            conversation_id: msg.conversation_id.clone(),
            code: "git_error".to_string(),
            message: format!("commit_worktree failed: {}", e),
        }.emit();
        return;
    }

    if let Err(e) = pipeline::publisher::push_branch(&wt_path_str, &branch) {
        AgentEvent::Error {
            task_id: msg.task_id.clone(),
            conversation_id: msg.conversation_id.clone(),
            code: "git_error".to_string(),
            message: format!("push_branch failed: {}", e),
        }.emit();
        return;
    }

    let mr = match gitlab.create_draft_mr(project_id, &branch, "main", &mr_title, &mr_description) {
        Ok(m) => m,
        Err(e) => {
            AgentEvent::Error {
                task_id: msg.task_id.clone(),
                conversation_id: msg.conversation_id.clone(),
                code: "gitlab_error".to_string(),
                message: format!("create_draft_mr failed: {}", e),
            }.emit();
            return;
        }
    };

    let _ = db::update_fields(conn, bug_task_id, &db::UpdateFields {
        status: Some("pending_review".to_string()),
        gitlab_mr_id: Some(mr.iid),
        ..Default::default()
    });

    let review_msg = format!(
        "bugfix-bot 已为缺陷 {}（{}）创建 Draft MR，请 Review：{}",
        ctx.feishu_issue_id, ctx.title, mr.web_url
    );
    if let Err(e) = feishu.send_message(&ctx.assignee, &review_msg) {
        eprintln!("[bugfix-bot] send_message (review) failed: {}", e);
    }

    AgentEvent::Result {
        task_id: msg.task_id.clone(),
        conversation_id: msg.conversation_id.clone(),
        status: "done".to_string(),
        data: Some(serde_json::json!({ "mr_url": mr.web_url })),
        error: None,
    }.emit();
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

    if action == "merge" || action == "close" {
        let source_branch = msg.payload
            .pointer("/object_attributes/source_branch")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        eprintln!("[bugfix-bot] MR {} on branch {}, cleanup pending", action, source_branch);
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
