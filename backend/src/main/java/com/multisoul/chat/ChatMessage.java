package com.multisoul.chat;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "chat_messages")
public class ChatMessage {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "agent_id", nullable = false)
    private UUID agentId;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(nullable = false, length = 16)
    private String role; // "user" | "assistant"

    @Column(nullable = false, columnDefinition = "TEXT")
    private String text;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt = Instant.now();

    protected ChatMessage() {}

    public ChatMessage(UUID agentId, UUID userId, String role, String text) {
        this.agentId = agentId;
        this.userId = userId;
        this.role = role;
        this.text = text;
    }

    public UUID getId()           { return id; }
    public UUID getAgentId()      { return agentId; }
    public UUID getUserId()       { return userId; }
    public String getRole()       { return role; }
    public String getText()       { return text; }
    public Instant getCreatedAt() { return createdAt; }
}
