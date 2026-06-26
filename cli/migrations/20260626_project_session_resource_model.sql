CREATE TABLE IF NOT EXISTS projects (
    id                      TEXT PRIMARY KEY,
    name                    TEXT NOT NULL,
    project_path            TEXT NOT NULL,
    normalized_project_path TEXT NOT NULL UNIQUE,
    default_agent_id        TEXT,
    created_at              INTEGER NOT NULL,
    updated_at              INTEGER NOT NULL
);

ALTER TABLE agents ADD COLUMN project_id TEXT REFERENCES projects(id);
ALTER TABLE conversations ADD COLUMN project_id TEXT REFERENCES projects(id);
ALTER TABLE workflows ADD COLUMN project_id TEXT REFERENCES projects(id);
ALTER TABLE spec_ideas ADD COLUMN target_project_id TEXT;
ALTER TABLE spec_ideas ADD COLUMN target_project_name TEXT;
ALTER TABLE spec_ideas ADD COLUMN target_resource_id TEXT;
ALTER TABLE spec_ideas ADD COLUMN target_resource_name TEXT;
ALTER TABLE spec_artifacts ADD COLUMN target_project_id TEXT;
ALTER TABLE spec_artifacts ADD COLUMN target_project_name TEXT;
ALTER TABLE spec_artifacts ADD COLUMN target_resource_id TEXT;
ALTER TABLE spec_artifacts ADD COLUMN target_resource_name TEXT;

CREATE INDEX IF NOT EXISTS idx_agents_project_id
    ON agents(project_id);
CREATE INDEX IF NOT EXISTS idx_conversations_project_last_message
    ON conversations(project_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflows_project_id
    ON workflows(project_id);

INSERT INTO projects (
    id,
    name,
    project_path,
    normalized_project_path,
    created_at,
    updated_at
)
SELECT
    'project_' || lower(hex(randomblob(16))) AS id,
    normalized_project_path AS name,
    MIN(project_path) AS project_path,
    normalized_project_path,
    MIN(created_at) AS created_at,
    MAX(created_at) AS updated_at
FROM (
    SELECT
        project_path,
        CASE
            WHEN rtrim(project_path, '/') = '' THEN project_path
            ELSE rtrim(project_path, '/')
        END AS normalized_project_path,
        created_at
    FROM agents
    WHERE project_path IS NOT NULL AND trim(project_path) <> ''
)
GROUP BY normalized_project_path
ON CONFLICT(normalized_project_path) DO NOTHING;

UPDATE agents
SET project_id = (
    SELECT p.id
    FROM projects p
    WHERE p.normalized_project_path = CASE
        WHEN rtrim(agents.project_path, '/') = '' THEN agents.project_path
        ELSE rtrim(agents.project_path, '/')
    END
    LIMIT 1
)
WHERE project_id IS NULL;

UPDATE projects
SET default_agent_id = (
    SELECT a.id
    FROM agents a
    WHERE a.project_id = projects.id
    ORDER BY a.created_at ASC, a.id ASC
    LIMIT 1
)
WHERE default_agent_id IS NULL;

UPDATE conversations
SET project_id = (
    SELECT a.project_id
    FROM agents a
    WHERE a.id = conversations.agent_id
    LIMIT 1
)
WHERE project_id IS NULL;

UPDATE workflows
SET project_id = (
    SELECT a.project_id
    FROM agents a
    WHERE a.id = workflows.agent_id
    LIMIT 1
)
WHERE project_id IS NULL;
