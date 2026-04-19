package com.multisoul.chat;

import com.multisoul.BaseIntegrationTest;
import com.multisoul.auth.ApiKeyService;
import com.multisoul.user.UserService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.web.socket.*;
import org.springframework.web.socket.client.standard.StandardWebSocketClient;
import org.springframework.web.socket.handler.AbstractWebSocketHandler;

import java.util.concurrent.*;

import static org.assertj.core.api.Assertions.assertThat;

/// WsChatHandler integration tests
///
/// T-1: invalid token → connection rejected (handshake interceptor returns false)
/// T-2: valid token → connection accepted (no error = success)
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class WsChatHandlerTest extends BaseIntegrationTest {

    @LocalServerPort int port;

    @Autowired ApiKeyService apiKeyService;
    @Autowired UserService userService;

    /// T-1: invalid token → connection rejected
    ///
    /// Execution:
    ///   1. Connect to /ws/chat?token=bad-token
    ///   2. Handshake interceptor fails to validate key → returns false → connection closed
    ///
    /// Expected:
    ///   - Connection is closed (afterConnectionClosed called)
    @Test
    void rejectsInvalidToken() throws Exception {
        BlockingQueue<CloseStatus> closed = new LinkedBlockingQueue<>();
        StandardWebSocketClient client = new StandardWebSocketClient();
        try {
            client.execute(new AbstractWebSocketHandler() {
                @Override
                public void afterConnectionClosed(WebSocketSession s, CloseStatus status) {
                    closed.add(status);
                }
            }, "ws://localhost:" + port + "/ws/chat?token=bad-token").get(3, TimeUnit.SECONDS);
        } catch (Exception ignored) {
            // Connection may be refused outright — that also counts as rejected
            closed.add(CloseStatus.NOT_ACCEPTABLE);
        }

        CloseStatus status = closed.poll(3, TimeUnit.SECONDS);
        assertThat(status).isNotNull()
            .as("connection should be closed for invalid token");
    }

    /// T-2: valid token → connection accepted
    ///
    /// Data:
    ///   - Create user with email test-ws@example.com
    ///   - Generate API key for that user
    ///
    /// Execution:
    ///   1. Connect to /ws/chat?token=<rawKey>
    ///   2. Handshake interceptor validates key → returns true → connection established
    ///
    /// Expected:
    ///   - No exception thrown (connection accepted)
    ///   - Session is open after connect
    @Test
    void acceptsValidToken() throws Exception {
        var user = userService.createUser("test-ws-" + System.nanoTime() + "@example.com");
        var keyResp = apiKeyService.generateKey(user.getId());
        String rawKey = keyResp.key();

        BlockingQueue<WebSocketSession> opened = new LinkedBlockingQueue<>();
        StandardWebSocketClient client = new StandardWebSocketClient();
        WebSocketSession session = client.execute(new AbstractWebSocketHandler() {
            @Override
            public void afterConnectionEstablished(WebSocketSession s) {
                opened.add(s);
            }
        }, "ws://localhost:" + port + "/ws/chat?token=" + rawKey).get(3, TimeUnit.SECONDS);

        WebSocketSession openedSession = opened.poll(3, TimeUnit.SECONDS);
        assertThat(openedSession).isNotNull()
            .as("connection should be established for valid token");
        assertThat(openedSession.isOpen()).isTrue()
            .as("session should be open after connect");

        session.close();
    }
}
