package com.multisoul.chat;

import com.multisoul.auth.ApiKeyService;
import com.multisoul.common.AppException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;
import org.springframework.web.socket.server.HandshakeInterceptor;

import java.util.Map;

@Configuration
@EnableWebSocket
public class WebSocketConfig implements WebSocketConfigurer {

    private final WsChatHandler chatHandler;
    private final PlatformWsHandler platformHandler;
    private final ApiKeyService apiKeyService;

    @Value("${app.platform.secret}")
    private String platformSecret;

    public WebSocketConfig(WsChatHandler chatHandler,
                           PlatformWsHandler platformHandler,
                           ApiKeyService apiKeyService) {
        this.chatHandler = chatHandler;
        this.platformHandler = platformHandler;
        this.apiKeyService = apiKeyService;
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(chatHandler, "/ws/chat")
                .addInterceptors(mobileInterceptor())
                .setAllowedOrigins("*");

        registry.addHandler(platformHandler, "/ws/platform")
                .addInterceptors(platformInterceptor())
                .setAllowedOrigins("*");
    }

    private HandshakeInterceptor mobileInterceptor() {
        return new HandshakeInterceptor() {
            @Override
            public boolean beforeHandshake(ServerHttpRequest req, ServerHttpResponse res,
                                           WebSocketHandler handler, Map<String, Object> attrs) {
                String token = extractToken(req);
                if (token == null) return false;
                try {
                    attrs.put(WsChatHandler.ATTR_API_KEY, apiKeyService.validateKey(token));
                    return true;
                } catch (AppException e) {
                    return false;
                }
            }
            @Override
            public void afterHandshake(ServerHttpRequest req, ServerHttpResponse res,
                                       WebSocketHandler handler, Exception ex) {}
        };
    }

    private HandshakeInterceptor platformInterceptor() {
        return new HandshakeInterceptor() {
            @Override
            public boolean beforeHandshake(ServerHttpRequest req, ServerHttpResponse res,
                                           WebSocketHandler handler, Map<String, Object> attrs) {
                String token = extractToken(req);
                return platformSecret.equals(token);
            }
            @Override
            public void afterHandshake(ServerHttpRequest req, ServerHttpResponse res,
                                       WebSocketHandler handler, Exception ex) {}
        };
    }

    private static String extractToken(ServerHttpRequest req) {
        String query = req.getURI().getQuery();
        if (query == null) return null;
        for (String param : query.split("&")) {
            if (param.startsWith("token=")) {
                return param.substring(6);
            }
        }
        return null;
    }
}
