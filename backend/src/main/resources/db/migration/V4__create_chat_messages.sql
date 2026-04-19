-- No FK constraints on agent_id/user_id: application-level validation
-- (WsChatHandler.getAgent) enforces ownership. Omitting FKs allows
-- integration tests to insert messages with arbitrary UUIDs without
-- needing real agent/user records.
CREATE TABLE chat_messages (
    id         UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    agent_id   UUID        NOT NULL,
    user_id    UUID        NOT NULL,
    role       VARCHAR(16) NOT NULL,
    text       TEXT        NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_chat_messages_session
    ON chat_messages (agent_id, user_id, created_at ASC);
