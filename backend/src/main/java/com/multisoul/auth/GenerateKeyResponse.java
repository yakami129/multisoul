package com.multisoul.auth;

import java.util.UUID;

public record GenerateKeyResponse(UUID id, String key, String keyPrefix) {}
