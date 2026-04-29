use crate::serve::state::AppState;

pub fn send_to_session(
    _state: &AppState,
    _conv_id: &str,
    _user_text: &str,
    _project_path: &str,
    _mode: &str,
) {
    eprintln!("[codex] send_to_session: not yet implemented");
}
