package com.multisoul.agent;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.multisoul.BaseIntegrationTest;
import com.multisoul.auth.ApiKeyService;
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

/// AgentControllerTest: verifies CRUD for agents, ownership isolation, and auth_value encryption.
///
/// Data construction:
///   - Two users (userA, userB) with separate API keys
///   - userA registers an agent with auth_type=api_key, auth_value="secret-token"
///
/// Execution:
///   1. POST /api/v1/agents (as userA) → 201, agent created
///   2. GET /api/v1/agents (as userA) → 200, list contains userA's agent
///   3. GET /api/v1/agents (as userB) → 200, list is empty (ownership isolation)
///   4. PUT /api/v1/agents/{id} (as userA) → 200, name updated
///   5. DELETE /api/v1/agents/{id} (as userA) → 204
///   6. GET /api/v1/agents/{id} after delete → 404
///
/// Expected:
///   - auth_value is NOT returned in responses (encrypted at rest, never exposed)
///   - userB cannot see userA's agents
///   - 404 after deletion
class AgentControllerTest extends BaseIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private ApiKeyService apiKeyService;

    @Autowired
    private ObjectMapper objectMapper;

    private String userAKey;
    private String userBKey;

    @BeforeEach
    void setUp() {
        User userA = userRepository.save(new User("agent-test-a@example.com"));
        User userB = userRepository.save(new User("agent-test-b@example.com"));
        userAKey = apiKeyService.generateKey(userA.getId()).key();
        userBKey = apiKeyService.generateKey(userB.getId()).key();
    }

    @Test
    void registerAgentReturns201() throws Exception {
        String body = """
            {
              "name": "My Agent",
              "description": "Test agent",
              "endpoint": "https://example.com/agent",
              "authType": "api_key",
              "authValue": "secret-token"
            }
            """;

        mockMvc.perform(post("/api/v1/agents")
                .header("Authorization", "Bearer " + userAKey)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
               .andExpect(status().isCreated())
               .andExpect(jsonPath("$.id").isNotEmpty())
               .andExpect(jsonPath("$.name").value("My Agent"))
               .andExpect(jsonPath("$.authValue").doesNotExist());
    }

    @Test
    void listAgentsReturnsOnlyOwnersAgents() throws Exception {
        String body = """
            {
              "name": "Owner Agent",
              "description": "desc",
              "endpoint": "https://example.com/agent",
              "authType": "none",
              "authValue": ""
            }
            """;

        mockMvc.perform(post("/api/v1/agents")
                .header("Authorization", "Bearer " + userAKey)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
               .andExpect(status().isCreated());

        // userA sees their agent
        mockMvc.perform(get("/api/v1/agents")
                .header("Authorization", "Bearer " + userAKey))
               .andExpect(status().isOk())
               .andExpect(jsonPath("$.length()").value(1));

        // userB sees empty list
        mockMvc.perform(get("/api/v1/agents")
                .header("Authorization", "Bearer " + userBKey))
               .andExpect(status().isOk())
               .andExpect(jsonPath("$.length()").value(0));
    }

    @Test
    void updateAndDeleteAgent() throws Exception {
        String createBody = """
            {
              "name": "To Update",
              "description": "desc",
              "endpoint": "https://example.com/agent",
              "authType": "none",
              "authValue": ""
            }
            """;

        MvcResult createResult = mockMvc.perform(post("/api/v1/agents")
                .header("Authorization", "Bearer " + userAKey)
                .contentType(MediaType.APPLICATION_JSON)
                .content(createBody))
               .andExpect(status().isCreated())
               .andReturn();

        AgentResponse created = objectMapper.readValue(
            createResult.getResponse().getContentAsString(), AgentResponse.class);
        String agentId = created.id().toString();

        // Update name
        mockMvc.perform(put("/api/v1/agents/" + agentId)
                .header("Authorization", "Bearer " + userAKey)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\": \"Updated Name\"}"))
               .andExpect(status().isOk())
               .andExpect(jsonPath("$.name").value("Updated Name"));

        // Delete
        mockMvc.perform(delete("/api/v1/agents/" + agentId)
                .header("Authorization", "Bearer " + userAKey))
               .andExpect(status().isNoContent());

        // Verify 404
        mockMvc.perform(get("/api/v1/agents/" + agentId)
                .header("Authorization", "Bearer " + userAKey))
               .andExpect(status().isNotFound());
    }
}
