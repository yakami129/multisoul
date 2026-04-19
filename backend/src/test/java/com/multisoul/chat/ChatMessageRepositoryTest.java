package com.multisoul.chat;

import com.multisoul.BaseIntegrationTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/// ChatMessageRepository: saves and queries messages by agentId+userId
///
/// Data: two messages for (agent1, user1), one for (agent2, user1)
///
/// Execution:
///   1. Save 3 messages
///   2. Query by agent1+user1 → expect 2 results ordered by createdAt ASC
///   3. Query by agent2+user1 → expect 1 result
///
/// Expected:
///   - agent1+user1 returns exactly 2 messages in insertion order
///   - agent2+user1 returns exactly 1 message
///   - agent1+user2 (nonexistent) returns empty list
class ChatMessageRepositoryTest extends BaseIntegrationTest {

    @Autowired
    ChatMessageRepository repo;

    @Test
    void savesAndQueriesBySession() throws InterruptedException {
        UUID agent1 = UUID.randomUUID();
        UUID agent2 = UUID.randomUUID();
        UUID user1  = UUID.randomUUID();
        UUID user2  = UUID.randomUUID();

        repo.save(new ChatMessage(agent1, user1, "user", "hello"));
        Thread.sleep(1);
        repo.save(new ChatMessage(agent1, user1, "assistant", "hi there"));
        Thread.sleep(1);
        repo.save(new ChatMessage(agent2, user1, "user", "other agent"));

        List<ChatMessage> session1 = repo.findByAgentIdAndUserIdOrderByCreatedAtAsc(agent1, user1);
        assertThat(session1).hasSize(2)
            .as("agent1+user1 should have 2 messages");
        assertThat(session1.get(0).getRole()).isEqualTo("user")
            .as("first message should be from user");
        assertThat(session1.get(1).getRole()).isEqualTo("assistant")
            .as("second message should be from assistant");

        List<ChatMessage> session2 = repo.findByAgentIdAndUserIdOrderByCreatedAtAsc(agent2, user1);
        assertThat(session2).hasSize(1)
            .as("agent2+user1 should have 1 message");

        List<ChatMessage> empty = repo.findByAgentIdAndUserIdOrderByCreatedAtAsc(agent1, user2);
        assertThat(empty).as("agent1+user2 has no messages").isEmpty();
    }
}
