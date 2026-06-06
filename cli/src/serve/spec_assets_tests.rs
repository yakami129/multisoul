use super::*;
use crate::{db, serve::plugin::PluginManager, serve::state::AppState};
use std::sync::{Arc, Mutex};
use tempfile::tempdir;

struct Fixture {
    state: AppState,
    project_dir: tempfile::TempDir,
}

fn fixture() -> Fixture {
    let project_dir = tempdir().expect("project tempdir should be created");
    let db_dir = tempdir().expect("db tempdir should be created");
    let conn = db::open_at(&db_dir.path().join("specs.db")).expect("test database should open");
    conn.execute(
        "INSERT INTO agents (id, name, project_path, runtime, created_at, mode)
         VALUES ('agent-1', 'Agent One', ?1, 'codex', 1, 'full-auto')",
        [project_dir.path().to_string_lossy().as_ref()],
    )
    .expect("agent row should be inserted");
    conn.execute(
        "INSERT INTO conversations (id, agent_id, title, created_at, last_message_at, status)
         VALUES ('conv-1', 'agent-1', 'Interview', 1, 1, 'idle')",
        [],
    )
    .expect("conversation row should be inserted");
    let plugin_db =
        db::open_at(&db_dir.path().join("plugins.db")).expect("plugin database should open");
    let state = AppState::new(
        conn,
        "ms_v2_tok".to_string(),
        db_dir.path().join("uploads"),
        PluginManager::empty(Arc::new(Mutex::new(plugin_db))),
    );
    Fixture { state, project_dir }
}

/// save_spec_from_path creates an immutable artifact snapshot from a repo file.
///
/// Execution:
///   1. Seed an agent/conversation pointing at a temp repo.
///   2. Write docs/product-specs/2026-06-06-SPEC-demo.md.
///   3. Save that path for conv-1.
///
/// Expected:
///   - revision 1 is returned.
///   - spec_artifacts contains the repo path.
///   - spec_artifact_versions stores markdown and a 64-char sha256.
#[test]
fn save_spec_from_path_creates_first_artifact_version() {
    let fixture = fixture();
    let spec_dir = fixture.project_dir.path().join("docs/product-specs");
    std::fs::create_dir_all(&spec_dir).expect("spec dir should be created");
    std::fs::write(
        spec_dir.join("2026-06-06-SPEC-demo.md"),
        "# Demo Spec\n\nShip the workflow.\n",
    )
    .expect("spec markdown should be written");

    let result = save_spec_from_path(
        &fixture.state,
        SaveSpecFromPathInput {
            repo_spec_path: "docs/product-specs/2026-06-06-SPEC-demo.md".to_string(),
            conversation_id: "conv-1".to_string(),
        },
    )
    .expect("valid spec path should save");

    assert_eq!(result.revision, 1, "first save should create revision 1");
    let (repo_path, latest_version_id): (String, String) = fixture
        .state
        .db
        .lock()
        .expect("db mutex should be available")
        .query_row(
            "SELECT repo_spec_path, latest_version_id FROM spec_artifacts WHERE id = ?1",
            [&result.spec_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .expect("artifact should exist");
    assert_eq!(
        repo_path, "docs/product-specs/2026-06-06-SPEC-demo.md",
        "artifact should store the repo-relative path"
    );
    assert_eq!(
        latest_version_id, result.version_id,
        "artifact latest_version_id should point at the inserted version"
    );

    let (markdown, hash): (String, String) = fixture
        .state
        .db
        .lock()
        .expect("db mutex should be available")
        .query_row(
            "SELECT markdown, markdown_sha256 FROM spec_artifact_versions WHERE id = ?1",
            [&result.version_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .expect("version should exist");
    assert!(
        markdown.contains("Ship the workflow."),
        "version should store the markdown snapshot"
    );
    assert_eq!(hash.len(), 64, "sha256 hex should be 64 chars");
}

/// save_spec_from_path creates a new immutable version for an existing repo path.
///
/// Execution:
///   1. Save the same repo path twice with different content.
///   2. Count versions for the returned spec id.
///
/// Expected:
///   - second save returns revision 2.
///   - there are two version rows, preserving the first snapshot.
#[test]
fn save_spec_from_path_creates_new_revision_for_existing_path() {
    let fixture = fixture();
    let spec_dir = fixture.project_dir.path().join("docs/product-specs");
    std::fs::create_dir_all(&spec_dir).expect("spec dir should be created");
    let spec_path = spec_dir.join("2026-06-06-SPEC-demo.md");
    std::fs::write(&spec_path, "# Demo Spec\n\nFirst.\n").expect("first markdown should write");
    let first = save_spec_from_path(
        &fixture.state,
        SaveSpecFromPathInput {
            repo_spec_path: "docs/product-specs/2026-06-06-SPEC-demo.md".to_string(),
            conversation_id: "conv-1".to_string(),
        },
    )
    .expect("first save should succeed");

    std::fs::write(&spec_path, "# Demo Spec\n\nSecond.\n").expect("second markdown should write");
    let second = save_spec_from_path(
        &fixture.state,
        SaveSpecFromPathInput {
            repo_spec_path: "docs/product-specs/2026-06-06-SPEC-demo.md".to_string(),
            conversation_id: "conv-1".to_string(),
        },
    )
    .expect("second save should succeed");

    assert_eq!(
        first.spec_id, second.spec_id,
        "same path should reuse spec id"
    );
    assert_eq!(second.revision, 2, "second save should create revision 2");
    let count: i64 = fixture
        .state
        .db
        .lock()
        .expect("db mutex should be available")
        .query_row(
            "SELECT COUNT(*) FROM spec_artifact_versions WHERE spec_id = ?1",
            [&second.spec_id],
            |row| row.get(0),
        )
        .expect("version count should query");
    assert_eq!(count, 2, "both immutable versions should remain stored");
}

/// list_spec_artifacts returns specs saved through save_spec_from_path.
#[test]
fn list_spec_artifacts_returns_saved_spec_with_empty_target_endpoint_id() {
    let fixture = fixture();
    let spec_dir = fixture.project_dir.path().join("docs/product-specs");
    std::fs::create_dir_all(&spec_dir).expect("spec dir should be created");
    std::fs::write(
        spec_dir.join("2026-06-06-SPEC-demo.md"),
        "# Demo Spec\n\nShip the workflow.\n",
    )
    .expect("spec markdown should be written");

    save_spec_from_path(
        &fixture.state,
        SaveSpecFromPathInput {
            repo_spec_path: "docs/product-specs/2026-06-06-SPEC-demo.md".to_string(),
            conversation_id: "conv-1".to_string(),
        },
    )
    .expect("valid spec path should save");

    let specs = list_spec_artifacts(&fixture.state).expect("list should succeed");
    assert_eq!(specs.len(), 1, "saved spec should appear in list");
}

/// save_spec_from_path rejects paths outside docs/product-specs before reading files.
///
/// Execution:
///   1. Request ../secret.md for conv-1.
///
/// Expected:
///   - invalid_path is returned.
///   - no artifact row is inserted.
#[test]
fn save_spec_from_path_rejects_path_traversal() {
    let fixture = fixture();
    let err = save_spec_from_path(
        &fixture.state,
        SaveSpecFromPathInput {
            repo_spec_path: "../secret.md".to_string(),
            conversation_id: "conv-1".to_string(),
        },
    )
    .expect_err("path traversal should be rejected");
    assert_eq!(err, SaveSpecError::InvalidPath);
    let count: i64 = fixture
        .state
        .db
        .lock()
        .expect("db mutex should be available")
        .query_row("SELECT COUNT(*) FROM spec_artifacts", [], |row| row.get(0))
        .expect("artifact count should query");
    assert_eq!(count, 0, "invalid paths must not create artifacts");
}
