CREATE TABLE IF NOT EXISTS spec_ideas (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    status TEXT NOT NULL,
    target_agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    target_endpoint_id TEXT NOT NULL,
    target_repo_path TEXT NOT NULL,
    target_agent_name TEXT NOT NULL,
    body TEXT NOT NULL,
    interview_conversation_id TEXT UNIQUE REFERENCES conversations(id) ON DELETE SET NULL,
    converted_spec_id TEXT,
    error_message TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    archived_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_spec_ideas_status_updated
    ON spec_ideas(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_spec_ideas_interview_conversation
    ON spec_ideas(interview_conversation_id);

CREATE TABLE IF NOT EXISTS spec_idea_notes (
    id TEXT PRIMARY KEY,
    idea_id TEXT NOT NULL REFERENCES spec_ideas(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_spec_idea_notes_idea
    ON spec_idea_notes(idea_id, created_at ASC);

CREATE TABLE IF NOT EXISTS spec_idea_attachments (
    id TEXT PRIMARY KEY,
    idea_id TEXT NOT NULL REFERENCES spec_ideas(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    title TEXT,
    uri TEXT,
    text TEXT,
    file_id TEXT,
    metadata_json TEXT,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_spec_idea_attachments_idea
    ON spec_idea_attachments(idea_id, created_at ASC);

CREATE TABLE IF NOT EXISTS spec_artifacts (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    slug TEXT NOT NULL,
    status TEXT NOT NULL,
    target_agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    target_endpoint_id TEXT NOT NULL,
    target_repo_path TEXT NOT NULL,
    repo_spec_path TEXT NOT NULL UNIQUE,
    latest_version_id TEXT,
    source_idea_id TEXT REFERENCES spec_ideas(id) ON DELETE SET NULL,
    interview_conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    latest_implementation_conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
    linked_activity_item_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_spec_artifacts_status_updated
    ON spec_artifacts(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_spec_artifacts_repo_spec_path
    ON spec_artifacts(repo_spec_path);

CREATE TABLE IF NOT EXISTS spec_artifact_versions (
    id TEXT PRIMARY KEY,
    spec_id TEXT NOT NULL REFERENCES spec_artifacts(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL,
    repo_spec_path TEXT NOT NULL,
    markdown TEXT NOT NULL,
    markdown_sha256 TEXT NOT NULL,
    source_conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    UNIQUE(spec_id, revision)
);
CREATE INDEX IF NOT EXISTS idx_spec_artifact_versions_spec_revision
    ON spec_artifact_versions(spec_id, revision DESC);
