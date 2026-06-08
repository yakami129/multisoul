//! E2E integration tests that spawn a real `msctl serve` subprocess and exercise
//! the HTTP/WS API surface.
//!
//! Each test:
//!  1. Finds a free port
//!  2. Spawns `msctl serve --port <port> --token <token>` with an isolated HOME
//!  3. Waits for `GET /api/v1/healthz` to respond
//!  4. Asserts against the live server
//!  5. Drops `TestServer`, which kills the child process

use std::net::TcpListener;
use std::process::{Child, Command};
use tempfile::TempDir;

/// Find a free port by binding to :0 and reading the OS-assigned port.
fn find_free_port() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind :0");
    let port = listener.local_addr().expect("local_addr").port();
    drop(listener);
    port
}

const TEST_TOKEN: &str = "ms_v2_aabbccddaabbccddaabbccddaabbccdd";

/// A running `msctl serve` child process with its isolated HOME directory.
struct TestServer {
    port: u16,
    token: String,
    _home: TempDir,
    child: Child,
}

impl TestServer {
    fn start() -> Self {
        let port = find_free_port();
        let token = TEST_TOKEN.to_string();
        let home = tempfile::tempdir().expect("tempdir");
        let bin = env!("CARGO_BIN_EXE_msctl");
        let child = Command::new(bin)
            .args(["serve", "--port", &port.to_string(), "--token", &token])
            .env("HOME", home.path())
            .spawn()
            .expect("spawn msctl serve");
        TestServer {
            port,
            token,
            _home: home,
            child,
        }
    }

    fn base_url(&self) -> String {
        format!("http://127.0.0.1:{}", self.port)
    }

    fn auth_header(&self) -> String {
        format!("Bearer {}", self.token)
    }

    fn home_path(&self) -> std::path::PathBuf {
        self._home.path().to_path_buf()
    }
}

impl Drop for TestServer {
    fn drop(&mut self) {
        self.child.kill().ok();
        self.child.wait().ok();
    }
}

/// Poll `GET /api/v1/healthz` until it responds 200, or panic after 5s.
async fn wait_for_ready(base_url: &str) {
    let client = reqwest::Client::new();
    let url = format!("{}/api/v1/healthz", base_url);
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    loop {
        if let Ok(resp) = client.get(&url).send().await {
            if resp.status().is_success() {
                return;
            }
        }
        if std::time::Instant::now() >= deadline {
            panic!("Server at {} did not become ready within 5s", base_url);
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
}

// ─── Scenario A: Auth ─────────────────────────────────────────────────────────

/// GET /api/v1/agents without any token must return 401.
#[tokio::test]
async fn auth_no_token_returns_401() {
    let srv = TestServer::start();
    wait_for_ready(&srv.base_url()).await;
    let client = reqwest::Client::new();
    let resp = client
        .get(format!("{}/api/v1/agents", srv.base_url()))
        .send()
        .await
        .expect("request");
    assert_eq!(resp.status(), 401, "no token must return 401");
}

/// GET /api/v1/agents with a wrong Bearer token must return 401.
#[tokio::test]
async fn auth_wrong_token_returns_401() {
    let srv = TestServer::start();
    wait_for_ready(&srv.base_url()).await;
    let client = reqwest::Client::new();
    let resp = client
        .get(format!("{}/api/v1/agents", srv.base_url()))
        .header("Authorization", "Bearer ms_v2_wrongtoken000000000000000000000")
        .send()
        .await
        .expect("request");
    assert_eq!(resp.status(), 401, "wrong token must return 401");
}

/// GET /api/v1/agents with the correct Bearer token must return 200.
#[tokio::test]
async fn auth_valid_token_returns_200() {
    let srv = TestServer::start();
    wait_for_ready(&srv.base_url()).await;
    let client = reqwest::Client::new();
    let resp = client
        .get(format!("{}/api/v1/agents", srv.base_url()))
        .header("Authorization", &srv.auth_header())
        .send()
        .await
        .expect("request");
    assert_eq!(resp.status(), 200, "valid token must return 200");
}

// ─── Scenario B: Agent CRUD ───────────────────────────────────────────────────

/// Register an agent via CLI, list and get it via REST, then verify it appears.
///
/// Since the REST API has no POST /api/v1/agents, we register via the CLI
/// `msctl agent register` command pointing at the same HOME directory.
#[tokio::test]
async fn agent_crud() {
    let srv = TestServer::start();
    wait_for_ready(&srv.base_url()).await;

    // Use a real temp dir as project path so inject_context can write CLAUDE.md
    let project_dir = tempfile::tempdir().expect("project tempdir");
    let bin = env!("CARGO_BIN_EXE_msctl");
    let reg = Command::new(bin)
        .args([
            "agent",
            "register",
            "--name",
            "e2e-test-agent",
            "--project",
            project_dir.path().to_str().unwrap(),
            "--runtime",
            "claude-code",
        ])
        .env("HOME", srv.home_path())
        .output()
        .expect("msctl agent register");
    assert!(
        reg.status.success(),
        "agent register must succeed, stderr: {}",
        String::from_utf8_lossy(&reg.stderr)
    );

    let client = reqwest::Client::new();

    // List → agent appears
    let list_resp = client
        .get(format!("{}/api/v1/agents", srv.base_url()))
        .header("Authorization", &srv.auth_header())
        .send()
        .await
        .expect("list agents");
    assert_eq!(list_resp.status(), 200);
    let agents: serde_json::Value = list_resp.json().await.expect("parse list");
    let arr = agents.as_array().expect("agents must be array");
    assert!(!arr.is_empty(), "registered agent must appear in list");

    let agent_id = arr[0]["id"].as_str().expect("agent id").to_string();
    assert_eq!(arr[0]["name"], "e2e-test-agent");
    assert_eq!(arr[0]["runtime"], "claude-code");

    // GET /api/v1/agents/:id → fields match
    let get_resp = client
        .get(format!("{}/api/v1/agents/{}", srv.base_url(), agent_id))
        .header("Authorization", &srv.auth_header())
        .send()
        .await
        .expect("get agent");
    assert_eq!(get_resp.status(), 200);
    let agent: serde_json::Value = get_resp.json().await.expect("parse agent");
    assert_eq!(agent["id"], agent_id.as_str());
    assert_eq!(agent["name"], "e2e-test-agent");
    assert_eq!(agent["runtime"], "claude-code");
}

// ─── Scenario C: Conversation + Message + WebSocket ───────────────────────────

/// Register an agent, create a conversation, send a message, list messages.
#[tokio::test]
async fn conversation_and_messages() {
    let srv = TestServer::start();
    wait_for_ready(&srv.base_url()).await;

    let project_dir = tempfile::tempdir().expect("project tempdir");
    // Register agent via CLI
    let bin = env!("CARGO_BIN_EXE_msctl");
    let reg = Command::new(bin)
        .args([
            "agent",
            "register",
            "--name",
            "conv-test-agent",
            "--project",
            project_dir.path().to_str().unwrap(),
            "--runtime",
            "claude-code",
        ])
        .env("HOME", srv.home_path())
        .output()
        .expect("msctl agent register");
    assert!(reg.status.success(), "agent register failed");

    let client = reqwest::Client::new();

    // Get agent id
    let agents: serde_json::Value = client
        .get(format!("{}/api/v1/agents", srv.base_url()))
        .header("Authorization", &srv.auth_header())
        .send()
        .await
        .expect("list agents")
        .json()
        .await
        .expect("parse agents");
    let agent_id = agents[0]["id"].as_str().expect("agent id").to_string();

    // Create conversation
    let conv_resp = client
        .post(format!(
            "{}/api/v1/agents/{}/conversations",
            srv.base_url(),
            agent_id
        ))
        .header("Authorization", &srv.auth_header())
        .header("Content-Type", "application/json")
        .body(r#"{"title":"e2e conv"}"#)
        .send()
        .await
        .expect("create conversation");
    assert_eq!(conv_resp.status(), 201, "create conversation must return 201");
    let conv: serde_json::Value = conv_resp.json().await.expect("parse conv");
    let conv_id = conv["id"].as_str().expect("conv id").to_string();
    assert_eq!(conv["agent_id"], agent_id.as_str());

    // POST message
    let msg_resp = client
        .post(format!(
            "{}/api/v1/conversations/{}/messages",
            srv.base_url(),
            conv_id
        ))
        .header("Authorization", &srv.auth_header())
        .header("Content-Type", "application/json")
        .body(r#"{"text":"hello e2e"}"#)
        .send()
        .await
        .expect("post message");
    assert_eq!(msg_resp.status(), 201, "post message must return 201");

    // GET messages → contains the sent message
    let msgs: serde_json::Value = client
        .get(format!(
            "{}/api/v1/conversations/{}/messages",
            srv.base_url(),
            conv_id
        ))
        .header("Authorization", &srv.auth_header())
        .send()
        .await
        .expect("list messages")
        .json()
        .await
        .expect("parse messages");
    let msgs_arr = msgs.as_array().expect("messages must be array");
    assert!(!msgs_arr.is_empty(), "message list must not be empty");
    let user_msg = msgs_arr
        .iter()
        .find(|m| m["role"] == "user_text")
        .expect("user_text message must exist");
    assert_eq!(
        user_msg["payload"]["text"], "hello e2e",
        "message text must match"
    );
}

/// WebSocket upgrade to /ws/conversations/:id must succeed.
#[tokio::test]
async fn websocket_upgrade_succeeds() {
    let srv = TestServer::start();
    wait_for_ready(&srv.base_url()).await;

    let project_dir = tempfile::tempdir().expect("project tempdir");
    // Register agent
    let bin = env!("CARGO_BIN_EXE_msctl");
    let reg = Command::new(bin)
        .args([
            "agent",
            "register",
            "--name",
            "ws-test-agent",
            "--project",
            project_dir.path().to_str().unwrap(),
            "--runtime",
            "claude-code",
        ])
        .env("HOME", srv.home_path())
        .output()
        .expect("msctl agent register");
    assert!(reg.status.success(), "agent register failed");

    let client = reqwest::Client::new();

    // Get agent id and create conversation
    let agents: serde_json::Value = client
        .get(format!("{}/api/v1/agents", srv.base_url()))
        .header("Authorization", &srv.auth_header())
        .send()
        .await
        .expect("list agents")
        .json()
        .await
        .expect("parse agents");
    let agent_id = agents[0]["id"].as_str().expect("agent id").to_string();

    let conv: serde_json::Value = client
        .post(format!(
            "{}/api/v1/agents/{}/conversations",
            srv.base_url(),
            agent_id
        ))
        .header("Authorization", &srv.auth_header())
        .header("Content-Type", "application/json")
        .body(r#"{"title":"ws test conv"}"#)
        .send()
        .await
        .expect("create conversation")
        .json()
        .await
        .expect("parse conv");
    let conv_id = conv["id"].as_str().expect("conv id").to_string();

    // Connect WebSocket
    let ws_url = format!(
        "ws://127.0.0.1:{}/ws/conversations/{}?token={}",
        srv.port, conv_id, srv.token
    );
    let (_, _resp) =
        tokio_tungstenite::connect_async(&ws_url)
            .await
            .expect("WebSocket upgrade must succeed");
    // Successful connect_async means upgrade worked
}

// ─── Scenario D: Push Token ───────────────────────────────────────────────────

/// Register a push token and delete it.
#[tokio::test]
async fn push_token_register_and_delete() {
    let srv = TestServer::start();
    wait_for_ready(&srv.base_url()).await;
    let client = reqwest::Client::new();

    let body = serde_json::json!({
        "expo_push_token": "ExponentPushToken[e2etest001]",
        "device_label": "iPhone E2E"
    });
    let reg_resp = client
        .post(format!("{}/api/v1/push-tokens", srv.base_url()))
        .header("Authorization", &srv.auth_header())
        .header("Content-Type", "application/json")
        .body(body.to_string())
        .send()
        .await
        .expect("register push token");
    assert_eq!(
        reg_resp.status(),
        201,
        "push token register must return 201"
    );
    let token_row: serde_json::Value = reg_resp.json().await.expect("parse token");
    let token_id = token_row["id"].as_str().expect("token id").to_string();
    assert_eq!(token_row["expo_push_token"], "ExponentPushToken[e2etest001]");

    // Delete
    let del_resp = client
        .delete(format!("{}/api/v1/push-tokens/{}", srv.base_url(), token_id))
        .header("Authorization", &srv.auth_header())
        .send()
        .await
        .expect("delete push token");
    assert_eq!(del_resp.status(), 204, "push token delete must return 204");
}

/// Registering the same push token twice must be idempotent (not 500).
#[tokio::test]
async fn push_token_duplicate_is_idempotent() {
    let srv = TestServer::start();
    wait_for_ready(&srv.base_url()).await;
    let client = reqwest::Client::new();

    let body = serde_json::json!({
        "expo_push_token": "ExponentPushToken[e2edupe]",
        "device_label": "iPhone E2E Dupe"
    });

    for _ in 0..2 {
        let resp = client
            .post(format!("{}/api/v1/push-tokens", srv.base_url()))
            .header("Authorization", &srv.auth_header())
            .header("Content-Type", "application/json")
            .body(body.to_string())
            .send()
            .await
            .expect("register push token");
        assert!(
            resp.status() == 201 || resp.status() == 200 || resp.status() == 409,
            "duplicate token must not return 5xx, got {}",
            resp.status()
        );
    }
}
