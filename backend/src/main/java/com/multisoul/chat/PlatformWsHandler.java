package com.multisoul.chat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.*;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import java.util.Map;
import java.util.UUID;

/**
 * Handles the single WebSocket connection from cc-connect's platform/multisoul.
 * Receives streaming chunks and forwards them to the correct mobile session.
 */
@Component
public class PlatformWsHandler extends TextWebSocketHandler {

    private static final Logger log = LoggerFactory.getLogger(PlatformWsHandler.class);

    private final ChatSessionRegistry registry;
    private final ChatMessageRepository messageRepo;
    private final ObjectMapper mapper;

    public PlatformWsHandler(ChatSessionRegistry registry,
                             ChatMessageRepository messageRepo,
                             ObjectMapper mapper) {
        this.registry = registry;
        this.messageRepo = messageRepo;
        this.mapper = mapper;
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        registry.setPlatformSession(session);
        log.info("cc-connect platform connected");
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) throws Exception {
        JsonNode root = mapper.readTree(message.getPayload());
        String type = root.path("type").asText();

        if ("chunk".equals(type)) {
            handleChunk(root.path("payload"));
        }
    }

    private void handleChunk(JsonNode payload) throws Exception {
        String messageId  = payload.path("message_id").asText();
        String sessionKey = payload.path("session_key").asText();
        String text       = payload.path("text").asText();
        boolean done      = payload.path("done").asBoolean();

        // session_key format: multisoul:{agentId}:{userId}
        String[] parts = sessionKey.split(":", 3);
        if (parts.length != 3) {
            log.warn("invalid session_key: {}", sessionKey);
            return;
        }
        UUID agentId = UUID.fromString(parts[1]);
        UUID userId  = UUID.fromString(parts[2]);

        // Forward chunk to mobile
        WebSocketSession mobile = registry.getMobile(userId);
        if (mobile != null && mobile.isOpen()) {
            String chunkMsg = mapper.writeValueAsString(Map.of(
                "type", "chunk",
                "payload", Map.of(
                    "message_id", messageId,
                    "agent_id", agentId.toString(),
                    "text", text,
                    "done", done
                )
            ));
            mobile.sendMessage(new TextMessage(chunkMsg));
        }

        if (done) {
            registry.finalizeChunk(messageId);
            if (!text.isBlank()) {
                messageRepo.save(new ChatMessage(agentId, userId, "assistant", text));
            }
        }
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        registry.clearPlatformSession(session);
        log.info("cc-connect platform disconnected: {}", status);
    }
}
