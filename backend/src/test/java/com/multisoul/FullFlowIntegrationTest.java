package com.multisoul;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.github.tomakehurst.wiremock.WireMockServer;
import com.github.tomakehurst.wiremock.core.WireMockConfiguration;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import com.github.tomakehurst.wiremock.client.WireMock;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/// FullFlowIntegrationTest: end-to-end test covering the complete user journey.
///
/// Flow:
///   1. Register user → get userId
///   2. Generate API key for user → get plaintext key
///   3. Register agent (with WireMock endpoint) using API key
///   4. List agents → verify agent appears
///   5. Invoke agent → verify WireMock received request with correct auth
///   6. Revoke API key → verify subsequent requests return 401
///
/// Data construction:
///   - WireMock on dynamic port simulates agent endpoint
///   - Agent uses bearer_token auth with value "flow-secret"
///   - Invoke body: { "query": "test" }
///
/// Expected:
///   - Each step returns expected HTTP status
///   - Agent list contains exactly 1 agent after registration
///   - WireMock receives invoke with Authorization: Bearer flow-secret
///   - After key revocation, GET /api/v1/agents returns 401
class FullFlowIntegrationTest extends BaseIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    private WireMockServer wireMock;

    @BeforeEach
    void setUp() {
        wireMock = new WireMockServer(WireMockConfiguration.wireMockConfig().dynamicPort());
        wireMock.start();
        wireMock.stubFor(WireMock.post(WireMock.anyUrl())
            .willReturn(WireMock.aResponse()
                .withStatus(200)
                .withHeader("Content-Type", "application/json")
                .withBody("{\"status\": \"invoked\"}")));
    }

    @AfterEach
    void tearDown() {
        wireMock.stop();
    }

    @Test
    void fullUserJourney() throws Exception {
        // Step 1: Register user
        MvcResult userResult = mockMvc.perform(post("/api/v1/users")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\": \"flow@example.com\"}"))
               .andExpect(status().isCreated())
               .andReturn();

        JsonNode userJson = objectMapper.readTree(userResult.getResponse().getContentAsString());
        String userId = userJson.get("id").asText();
        assertThat(userId)
            .as("user id must be a non-empty UUID")
            .isNotBlank();

        // Step 2: Generate API key
        MvcResult keyResult = mockMvc.perform(post("/api/v1/auth/keys")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"userId\": \"" + userId + "\"}"))
               .andExpect(status().isCreated())
               .andReturn();

        JsonNode keyJson = objectMapper.readTree(keyResult.getResponse().getContentAsString());
        String apiKey = keyJson.get("key").asText();
        String keyId = keyJson.get("id").asText();
        assertThat(apiKey)
            .as("generated key must start with ms_")
            .startsWith("ms_");

        // Step 3: Register agent
        String agentBody = String.format("""
            {
              "name": "Flow Agent",
              "description": "Integration test agent",
              "endpoint": "http://localhost:%d/run",
              "authType": "bearer_token",
              "authValue": "flow-secret"
            }
            """, wireMock.port());

        MvcResult agentResult = mockMvc.perform(post("/api/v1/agents")
                .header("Authorization", "Bearer " + apiKey)
                .contentType(MediaType.APPLICATION_JSON)
                .content(agentBody))
               .andExpect(status().isCreated())
               .andReturn();

        JsonNode agentJson = objectMapper.readTree(agentResult.getResponse().getContentAsString());
        String agentId = agentJson.get("id").asText();
        assertThat(agentJson.get("authValue"))
            .as("authValue must not be present in response — it is encrypted at rest")
            .isNull();

        // Step 4: List agents — exactly 1
        mockMvc.perform(get("/api/v1/agents")
                .header("Authorization", "Bearer " + apiKey))
               .andExpect(status().isOk())
               .andExpect(jsonPath("$.length()").value(1))
               .andExpect(jsonPath("$[0].name").value("Flow Agent"));

        // Step 5: Invoke agent
        mockMvc.perform(post("/api/v1/agents/" + agentId + "/invoke")
                .header("Authorization", "Bearer " + apiKey)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"query\": \"test\"}"))
               .andExpect(status().isOk())
               .andExpect(jsonPath("$.status").value("invoked"));

        wireMock.verify(1, WireMock.postRequestedFor(WireMock.urlEqualTo("/run"))
            .withHeader("Authorization", WireMock.equalTo("Bearer flow-secret")));

        // Step 6: Revoke key — subsequent requests return 401
        mockMvc.perform(delete("/api/v1/auth/keys/" + keyId)
                .header("Authorization", "Bearer " + apiKey))
               .andExpect(status().isNoContent());

        mockMvc.perform(get("/api/v1/agents")
                .header("Authorization", "Bearer " + apiKey))
               .andExpect(status().isUnauthorized());
    }
}
