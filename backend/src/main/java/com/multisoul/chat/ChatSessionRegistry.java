package com.multisoul.chat;

import org.springframework.stereotype.Component;
import org.springframework.web.socket.WebSocketSession;

import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * In-memory state for active WebSocket connections.
 * Thread-safe; no persistence — clients re-fetch history on reconnect.
 */
@Component
public class ChatSessionRegistry {

    /** userId → active mobile WebSocket session */
    private final ConcurrentHashMap<UUID, WebSocketSession> mobileSessions = new ConcurrentHashMap<>();

    /** messageId → accumulated streaming text (cleared on done=true) */
    private final ConcurrentHashMap<String, StringBuilder> pendingChunks = new ConcurrentHashMap<>();

    /** The single cc-connect platform WebSocket session (null when disconnected) */
    private volatile WebSocketSession platformSession;

    public void registerMobile(UUID userId, WebSocketSession session) {
        WebSocketSession old = mobileSessions.put(userId, session);
        if (old != null && old.isOpen()) {
            try { old.close(); } catch (Exception ignored) {}
        }
    }

    public void removeMobile(UUID userId) {
        mobileSessions.remove(userId);
    }

    public WebSocketSession getMobile(UUID userId) {
        return mobileSessions.get(userId);
    }

    public void setPlatformSession(WebSocketSession session) {
        this.platformSession = session;
    }

    public void clearPlatformSession(WebSocketSession session) {
        if (this.platformSession == session) {
            this.platformSession = null;
        }
    }

    public WebSocketSession getPlatformSession() {
        return platformSession;
    }

    public String appendChunk(String messageId, String text) {
        return pendingChunks.computeIfAbsent(messageId, k -> new StringBuilder())
                            .append(text).toString();
    }

    public String finalizeChunk(String messageId) {
        StringBuilder sb = pendingChunks.remove(messageId);
        return sb != null ? sb.toString() : "";
    }
}
