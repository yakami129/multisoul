package com.multisoul.chat;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.util.List;
import java.util.UUID;

public interface ChatMessageRepository extends JpaRepository<ChatMessage, UUID> {

    @Query("""
        SELECT m FROM ChatMessage m
        WHERE m.agentId = :agentId AND m.userId = :userId
        ORDER BY m.createdAt ASC
        LIMIT 50
        """)
    List<ChatMessage> findByAgentIdAndUserIdOrderByCreatedAtAsc(UUID agentId, UUID userId);
}
