package com.multisoul.chat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.multisoul.agent.AgentService;
import com.multisoul.auth.ApiKey;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.*;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import java.util.Map;
import java.util.UUID;

/**
 * Handles WebSocket connections from the mobile app.
 * On connect: validates API key (set by handshake interceptor), registers session.
 * On message: validates agent ownership, persists user message, forwards to cc-connect.
 */
@Component
public class WsChatHandler extends TextWebSocketHandler {

    private static final Logger log = LoggerFactory.getLogger(WsChatHandler.class);
    static final String ATTR_API_KEY = "apiKey";

    private final ChatSessionRegistry registry;
    private final ChatMessageRepository messageRepo;
    private final AgentService agentService;
    private final ObjectMapper mapper;

    public WsChatHandler(ChatSessionRegistry registry,
                         ChatMessageRepository messageRepo,
                         AgentService agentService,
                         ObjectMapper mapper) {
        this.registry = registry;
        this.messageRepo = messageRepo;
        this.agentService = agentService;
        this.mapper = mapper;
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) throws Exception {
        ApiKey apiKey = (ApiKey) session.getAttributes().get(ATTR_API_KEY);
        if (apiKey == null) {
            session.close(CloseStatus.POLICY_VIOLATION);
            return;
        }
        registry.registerMobile(apiKey.getUserId(), session);
        log.info("mobile connected: userId={}", apiKey.getUserId());
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) throws Exception {
        ApiKey apiKey = (ApiKey) session.getAttributes().get(ATTR_API_KEY);
        if (apiKey == null) return;

        JsonNode root = mapper.readTree(message.getPayload());
        if (!"message".equals(root.path("type").asText())) return;

        JsonNode payload = root.path("payload");
        String agentIdStr = payload.path("agent_id").asText();
        String text       = payload.path("text").asText();

        if (text.isBlank() || agentIdStr.isBlank()) return;

        UUID agentId = UUID.fromString(agentIdStr);
        UUID userId  = apiKey.getUserId();

        // Verify agent belongs to this user
        agentService.getAgent(agentId, userId);

        // Persist user message
        String messageId = UUID.randomUUID().toString();
        messageRepo.save(new ChatMessage(agentId, userId, "user", text));

        // Forward to cc-connect
        WebSocketSession platform = registry.getPlatformSession();
        if (platform == null || !platform.isOpen()) {
            sendError(session, "SERVICE_UNAVAILABLE", "AI service not connected");
            return;
        }

        String sessionKey = "multisoul:" + agentId + ":" + userId;
        String fwd = mapper.writeValueAsString(Map.of(
            "type", "message",
            "payload", Map.of(
                "message_id",   messageId,
                "from_user_id", "user:" + userId,
                "session_key",  sessionKey,
                "text",         text
            )
        ));
        platform.sendMessage(new TextMessage(fwd));
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        ApiKey apiKey = (ApiKey) session.getAttributes().get(ATTR_API_KEY);
        if (apiKey != null) {
            registry.removeMobile(apiKey.getUserId());
            log.info("mobile disconnected: userId={}", apiKey.getUserId());
        }
    }

    private void sendError(WebSocketSession session, String code, String msg) throws Exception {
        session.sendMessage(new TextMessage(mapper.writeValueAsString(Map.of(
            "type", "error",
            "payload", Map.of("code", code, "message", msg)
        ))));
    }
}
