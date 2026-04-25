package com.multisoul.agent;

import com.multisoul.common.AppException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.UUID;

@Service
public class AgentInvokeService {

    private static final Logger log = LoggerFactory.getLogger(AgentInvokeService.class);
    private static final Duration TIMEOUT = Duration.ofSeconds(30);

    private final AgentService agentService;
    private final HttpClient httpClient;

    public AgentInvokeService(AgentService agentService) {
        this.agentService = agentService;
        this.httpClient = HttpClient.newBuilder()
            .connectTimeout(TIMEOUT)
            .build();
    }

    public String invoke(UUID agentId, UUID callerId, String requestBody) {
        Agent agent = agentService.getAgent(agentId, callerId);

        HttpRequest.Builder requestBuilder = HttpRequest.newBuilder()
            .uri(URI.create(agent.getEndpoint()))
            .timeout(TIMEOUT)
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(
                requestBody != null ? requestBody : "{}"));

        String decryptedAuthValue = agentService.decryptAuthValue(agent);
        if (decryptedAuthValue != null) {
            switch (agent.getAuthType()) {
                case "bearer_token" ->
                    requestBuilder.header("Authorization", "Bearer " + decryptedAuthValue);
                case "api_key" ->
                    requestBuilder.header("X-Api-Key", decryptedAuthValue);
                case "basic" ->
                    requestBuilder.header("Authorization", "Basic " + decryptedAuthValue);
            }
        }

        try {
            HttpResponse<String> response = httpClient.send(
                requestBuilder.build(),
                HttpResponse.BodyHandlers.ofString()
            );
            log.info("Agent {} invoked, status={}", agentId, response.statusCode());
            return response.body();
        } catch (Exception e) {
            log.error("Failed to invoke agent {}: {}", agentId, e.getMessage());
            throw new AppException(502, "INVOKE_FAILED",
                "Failed to reach agent endpoint: " + e.getMessage());
        }
    }
}
