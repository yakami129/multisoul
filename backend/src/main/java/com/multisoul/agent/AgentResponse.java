package com.multisoul.agent;

import java.time.Instant;
import java.util.UUID;

public record AgentResponse(
    UUID id,
    String name,
    String description,
    String endpoint,
    String authType,
    String status,
    UUID ownerId,
    Instant createdAt,
    Instant updatedAt
) {
    // Note: authValue intentionally excluded — never returned to clients
    static AgentResponse from(Agent agent) {
        return new AgentResponse(
            agent.getId(),
            agent.getName(),
            agent.getDescription(),
            agent.getEndpoint(),
            agent.getAuthType(),
            agent.getStatus(),
            agent.getOwnerId(),
            agent.getCreatedAt(),
            agent.getUpdatedAt()
        );
    }
}
