use crate::db::open_at;
use tempfile::tempdir;

/// Workflow schema includes workflow definitions and run history.
///
/// Data construction:
///   - tempdir creates an isolated SQLite path: <temp>/test.db
///   - open_at initializes the production schema from scratch
///   - workflows.enabled must be a persisted ON/OFF configuration flag
///   - workflow_runs.conversation_id must be nullable because skipped overlap runs do not create conversations
///
/// Execution process:
///   1. Open the temp DB through open_at so init_schema runs exactly as production startup does.
///   2. Query sqlite_master for workflows and workflow_runs.
///   3. Query pragma_table_info('workflows') for enabled.
///   4. Query pragma_table_info('workflow_runs') for conversation_id.notnull.
///
/// Expected results:
///   - workflows table exists for mobile-created schedules.
///   - workflow_runs table exists for each scheduled attempt.
///   - workflows.enabled exists exactly once and represents ON/OFF.
///   - workflow_runs.conversation_id is nullable so skipped_overlap records are valid without fake conversations.
#[test]
fn test_schema_has_workflows_and_nullable_run_conversation() {
    let dir = tempdir().unwrap();
    let conn = open_at(&dir.path().join("test.db")).unwrap();

    let workflows_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='workflows'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        workflows_count, 1,
        "workflows table must exist exactly once for scheduled agent jobs"
    );

    let workflow_runs_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='workflow_runs'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        workflow_runs_count, 1,
        "workflow_runs table must exist exactly once for run history"
    );

    let enabled_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('workflows') WHERE name='enabled'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        enabled_count, 1,
        "workflows.enabled must exist exactly once as the persisted ON/OFF flag"
    );

    let run_conversation_notnull: i64 = conn
        .query_row(
            "SELECT [notnull] FROM pragma_table_info('workflow_runs') WHERE name='conversation_id'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        run_conversation_notnull, 0,
        "workflow_runs.conversation_id must be nullable because skipped_overlap runs do not create conversations"
    );
}
