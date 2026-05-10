// fix-bug-bot/src/pipeline/mod.rs
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_should_retry_under_limit() {
        assert!(should_retry(0), "retry_count=0 must allow retry");
        assert!(should_retry(4), "retry_count=4 must allow retry");
    }

    #[test]
    fn test_should_retry_at_limit() {
        assert!(!should_retry(5), "retry_count=5 must not allow retry");
        assert!(!should_retry(10), "retry_count=10 must not allow retry");
    }

    #[test]
    fn test_idempotency_check_in_progress() {
        let action = idempotency_check("analyzing");
        assert!(matches!(action, IdempotencyAction::Skip), "analyzing status must skip");
    }

    #[test]
    fn test_idempotency_check_blocked_info() {
        let action = idempotency_check("blocked_info");
        assert!(matches!(action, IdempotencyAction::Reprocess), "blocked_info must reprocess");
    }

    #[test]
    fn test_idempotency_check_done() {
        let action = idempotency_check("done");
        assert!(matches!(action, IdempotencyAction::Skip), "done status must skip");
    }
}
