package com.multisoul.auth;

import com.multisoul.common.AppException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.HexFormat;
import java.util.List;
import java.util.UUID;

@Service
public class ApiKeyService {

    private static final String KEY_PREFIX = "ms_";
    private static final int RANDOM_PART_LENGTH = 32;
    private static final SecureRandom SECURE_RANDOM = new SecureRandom();
    private static final String CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

    private final ApiKeyRepository apiKeyRepository;

    public ApiKeyService(ApiKeyRepository apiKeyRepository) {
        this.apiKeyRepository = apiKeyRepository;
    }

    @Transactional
    public GenerateKeyResponse generateKey(UUID userId) {
        String randomPart = generateRandomString(RANDOM_PART_LENGTH);
        String fullKey = KEY_PREFIX + randomPart;
        String keyHash = sha256(fullKey);
        String keyPrefix = fullKey.substring(0, Math.min(10, fullKey.length()));

        ApiKey apiKey = new ApiKey(userId, keyHash, keyPrefix);
        ApiKey saved = apiKeyRepository.save(apiKey);

        return new GenerateKeyResponse(saved.getId(), fullKey, keyPrefix);
    }

    @Transactional(readOnly = true)
    public List<ApiKeyListResponse> listKeys(UUID userId) {
        return apiKeyRepository.findByUserId(userId)
            .stream()
            .map(ApiKeyListResponse::from)
            .toList();
    }

    @Transactional
    public ApiKey validateKey(String rawKey) {
        String hash = sha256(rawKey);
        ApiKey apiKey = apiKeyRepository.findByKeyHash(hash)
            .orElseThrow(() -> AppException.unauthorized("Invalid API key"));
        apiKey.setLastUsedAt(Instant.now());
        return apiKeyRepository.save(apiKey);
    }

    @Transactional
    public void revokeKey(UUID keyId, UUID userId) {
        ApiKey apiKey = apiKeyRepository.findById(keyId)
            .orElseThrow(() -> AppException.notFound("API key not found"));
        if (!apiKey.getUserId().equals(userId)) {
            throw AppException.forbidden("Cannot revoke another user's key");
        }
        apiKeyRepository.delete(apiKey);
    }

    private static String generateRandomString(int length) {
        StringBuilder sb = new StringBuilder(length);
        for (int i = 0; i < length; i++) {
            sb.append(CHARS.charAt(SECURE_RANDOM.nextInt(CHARS.length())));
        }
        return sb.toString();
    }

    public static String sha256(String input) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(input.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(hash);
        } catch (NoSuchAlgorithmException e) {
            throw new RuntimeException("SHA-256 not available", e);
        }
    }
}
