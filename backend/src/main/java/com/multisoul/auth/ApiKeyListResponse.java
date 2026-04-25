package com.multisoul.auth;

import java.time.Instant;
import java.util.UUID;

public record ApiKeyListResponse(UUID id, String keyPrefix, Instant createdAt, Instant lastUsedAt) {
    static ApiKeyListResponse from(ApiKey apiKey) {
        return new ApiKeyListResponse(
            apiKey.getId(),
            apiKey.getKeyPrefix(),
            apiKey.getCreatedAt(),
            apiKey.getLastUsedAt()
        );
    }
}
