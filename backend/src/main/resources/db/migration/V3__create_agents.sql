CREATE TABLE agents (
    id           UUID         NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    name         VARCHAR(255) NOT NULL,
    description  TEXT,
    endpoint     VARCHAR(2048) NOT NULL,
    auth_type    VARCHAR(50)  NOT NULL DEFAULT 'none',
    auth_value   TEXT,
    status       VARCHAR(50)  NOT NULL DEFAULT 'active',
    owner_id     UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_agents_owner_id ON agents(owner_id);
