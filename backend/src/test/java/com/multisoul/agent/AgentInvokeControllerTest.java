package com.multisoul.agent;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.github.tomakehurst.wiremock.WireMockServer;
import com.github.tomakehurst.wiremock.core.WireMockConfiguration;
import com.multisoul.BaseIntegrationTest;
import com.multisoul.auth.ApiKeyService;
import com.multisoul.user.User;
import com.multisoul.user.UserRepository;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import com.github.tomakehurst.wiremock.client.WireMock;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/// AgentInvokeControllerTest: verifies that POST /api/v1/agents/{id}/invoke
/// forwards the request body to the agent endpoint with correct auth headers,
/// and returns the agent's response to the caller.
///
/// Data construction:
///   - WireMock server on a random port simulates the agent endpoint
///   - Agent registered with authType=bearer_token, authValue="agent-secret"
///   - Invoke body: { "input": "hello" }
///
/// Execution:
///   1. WireMock stubs POST /invoke → 200 { "result": "ok" }
///   2. POST /api/v1/agents/{id}/invoke with body { "input": "hello" }
///   3. Backend decrypts auth_value, forwards to WireMock with Authorization: Bearer agent-secret
///   4. Returns WireMock's response to caller
///
/// Expected:
///   - HTTP 200 from invoke endpoint
///   - Response body contains "result": "ok"
///   - WireMock received exactly 1 request with Authorization: Bearer agent-secret
class AgentInvokeControllerTest extends BaseIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private ApiKeyService apiKeyService;

    @Autowired
    private AgentService agentService;

    @Autowired
    private ObjectMapper objectMapper;

    private WireMockServer wireMock;
    private String userKey;
    private String agentId;

    @BeforeEach
    void setUp() {
        wireMock = new WireMockServer(WireMockConfiguration.wireMockConfig().dynamicPort());
        wireMock.start();

        wireMock.stubFor(WireMock.post(WireMock.urlEqualTo("/invoke"))
            .willReturn(WireMock.aResponse()
                .withStatus(200)
                .withHeader("Content-Type", "application/json")
                .withBody("{\"result\": \"ok\"}")));

        User user = userRepository.save(new User("invoke-test@example.com"));
        userKey = apiKeyService.generateKey(user.getId()).key();

        CreateAgentRequest req = new CreateAgentRequest(
            "Invoke Agent",
            "test",
            "http://localhost:" + wireMock.port() + "/invoke",
            "bearer_token",
            "agent-secret"
        );
        Agent agent = agentService.createAgent(req, user.getId());
        agentId = agent.getId().toString();
    }

    @AfterEach
    void tearDown() {
        wireMock.stop();
    }

    @Test
    void invokeForwardsRequestAndReturnsAgentResponse() throws Exception {
        mockMvc.perform(post("/api/v1/agents/" + agentId + "/invoke")
                .header("Authorization", "Bearer " + userKey)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"input\": \"hello\"}"))
               .andExpect(status().isOk())
               .andExpect(jsonPath("$.result").value("ok"));

        wireMock.verify(1, WireMock.postRequestedFor(WireMock.urlEqualTo("/invoke"))
            .withHeader("Authorization", WireMock.equalTo("Bearer agent-secret"))
            .withRequestBody(WireMock.equalToJson("{\"input\": \"hello\"}")));
    }
}
