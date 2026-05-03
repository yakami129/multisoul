mod claude;
pub mod codex;

use crate::serve::state::AppState;

/// Dispatch a user message to the appropriate runtime backend.
/// `runtime` matches the agent's `runtime` column ("claude-code" | "codex").
/// `mode` is the agent's `mode` column (only used by codex).
pub fn send_to_session(
    state: &AppState,
    conv_id: &str,
    user_text: &str,
    file_id: Option<&str>,
    project_path: &str,
    runtime: &str,
    mode: &str,
) {
    match runtime {
        "codex" => codex::send_to_session(state, conv_id, user_text, project_path, mode),
        _ => claude::send_to_session(state, conv_id, user_text, file_id, project_path),
    }
}
