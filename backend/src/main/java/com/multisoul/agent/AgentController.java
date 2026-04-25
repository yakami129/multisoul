package com.multisoul.agent;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.multisoul.auth.ApiKey;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/agents")
public class AgentController {

    private final AgentService agentService;
    private final AgentInvokeService agentInvokeService;
    private final ObjectMapper objectMapper;

    public AgentController(AgentService agentService,
                           AgentInvokeService agentInvokeService,
                           ObjectMapper objectMapper) {
        this.agentService = agentService;
        this.agentInvokeService = agentInvokeService;
        this.objectMapper = objectMapper;
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public AgentResponse createAgent(@RequestBody CreateAgentRequest request,
                                     @AuthenticationPrincipal ApiKey apiKey) {
        Agent agent = agentService.createAgent(request, apiKey.getUserId());
        return AgentResponse.from(agent);
    }

    @GetMapping
    public List<AgentResponse> listAgents(@AuthenticationPrincipal ApiKey apiKey) {
        return agentService.listAgents(apiKey.getUserId())
            .stream()
            .map(AgentResponse::from)
            .toList();
    }

    @GetMapping("/{id}")
    public AgentResponse getAgent(@PathVariable UUID id,
                                  @AuthenticationPrincipal ApiKey apiKey) {
        return AgentResponse.from(agentService.getAgent(id, apiKey.getUserId()));
    }

    @PutMapping("/{id}")
    public AgentResponse updateAgent(@PathVariable UUID id,
                                     @RequestBody UpdateAgentRequest request,
                                     @AuthenticationPrincipal ApiKey apiKey) {
        return AgentResponse.from(agentService.updateAgent(id, request, apiKey.getUserId()));
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteAgent(@PathVariable UUID id,
                            @AuthenticationPrincipal ApiKey apiKey) {
        agentService.deleteAgent(id, apiKey.getUserId());
    }

    @PostMapping("/{id}/invoke")
    public Object invokeAgent(@PathVariable UUID id,
                              @RequestBody(required = false) String body,
                              @AuthenticationPrincipal ApiKey apiKey) {
        String result = agentInvokeService.invoke(id, apiKey.getUserId(), body);
        try {
            return objectMapper.readValue(result, Object.class);
        } catch (Exception e) {
            return result;
        }
    }
}
