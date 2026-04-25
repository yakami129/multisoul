package com.multisoul.auth;

import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/auth/keys")
public class ApiKeyController {

    private final ApiKeyService apiKeyService;

    public ApiKeyController(ApiKeyService apiKeyService) {
        this.apiKeyService = apiKeyService;
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public GenerateKeyResponse generateKey(@RequestBody GenerateKeyRequest request) {
        return apiKeyService.generateKey(request.userId());
    }

    @GetMapping
    public List<ApiKeyListResponse> listKeys(@AuthenticationPrincipal ApiKey apiKey) {
        return apiKeyService.listKeys(apiKey.getUserId());
    }

    @DeleteMapping("/{keyId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void revokeKey(@PathVariable UUID keyId,
                          @AuthenticationPrincipal ApiKey apiKey) {
        apiKeyService.revokeKey(keyId, apiKey.getUserId());
    }
}
