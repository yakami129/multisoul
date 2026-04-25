package com.multisoul.auth;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.multisoul.BaseIntegrationTest;
import com.multisoul.user.User;
import com.multisoul.user.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/// ApiKeyControllerTest: verifies API key generation, listing (prefix only), and invalid key rejection.
///
/// Data construction:
///   - A user is pre-created in the DB before each test
///   - POST /api/v1/auth/keys with { "userId": "<uuid>" } generates a key
///
/// Execution:
///   1. POST /api/v1/auth/keys → 201, body has "key" starting with "ms_" (plaintext, 35 chars)
///   2. GET /api/v1/auth/keys with Bearer <key> → 200, list shows "keyPrefix" not full key
///   3. GET /api/v1/auth/keys with invalid Bearer → 401
///
/// Expected:
///   - Generated key starts with "ms_" and is 35 chars total
///   - List response shows keyPrefix (first 10 chars), NOT the full key
///   - Invalid key returns 401
class ApiKeyControllerTest extends BaseIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private ObjectMapper objectMapper;

    private User testUser;

    @BeforeEach
    void setUp() {
        testUser = userRepository.save(new User("apikey-test@example.com"));
    }

    @Test
    void generateKeyReturns201WithPlaintextKey() throws Exception {
        String body = "{\"userId\": \"" + testUser.getId() + "\"}";

        MvcResult result = mockMvc.perform(post("/api/v1/auth/keys")
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
               .andExpect(status().isCreated())
               .andExpect(jsonPath("$.key").isNotEmpty())
               .andReturn();

        String responseBody = result.getResponse().getContentAsString();
        GenerateKeyResponse response = objectMapper.readValue(responseBody, GenerateKeyResponse.class);

        assertThat(response.key())
            .as("generated key must start with 'ms_'")
            .startsWith("ms_");
        assertThat(response.key())
            .as("generated key must be 35 chars: 'ms_' (3) + 32 random chars")
            .hasSize(35);
    }

    @Test
    void listKeysShowsPrefixNotFullKey() throws Exception {
        String body = "{\"userId\": \"" + testUser.getId() + "\"}";

        MvcResult genResult = mockMvc.perform(post("/api/v1/auth/keys")
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
               .andExpect(status().isCreated())
               .andReturn();

        GenerateKeyResponse genResponse = objectMapper.readValue(
            genResult.getResponse().getContentAsString(), GenerateKeyResponse.class);
        String fullKey = genResponse.key();

        mockMvc.perform(get("/api/v1/auth/keys")
                .header("Authorization", "Bearer " + fullKey))
               .andExpect(status().isOk())
               .andExpect(jsonPath("$[0].keyPrefix").isNotEmpty())
               .andExpect(jsonPath("$[0].key").doesNotExist());
    }

    @Test
    void invalidBearerTokenReturns401() throws Exception {
        mockMvc.perform(get("/api/v1/auth/keys")
                .header("Authorization", "Bearer ms_invalidkeyvalue12345678901234567"))
               .andExpect(status().isUnauthorized());
    }
}
