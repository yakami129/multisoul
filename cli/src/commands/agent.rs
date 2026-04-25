use anyhow::{Context, Result};
use clap::Subcommand;
use serde::{Deserialize, Serialize};
use std::io::{self, Write};
use crate::config::load_config;

#[derive(Subcommand)]
pub enum AgentCommands {
    /// Interactively register a new Agent
    Register,
    /// List all agents
    List,
    /// Get agent details
    Get { id: String },
    /// Update an agent
    Update {
        id: String,
        #[arg(long)] name: Option<String>,
        #[arg(long)] endpoint: Option<String>,
        #[arg(long)] description: Option<String>,
    },
    /// Delete an agent (with confirmation)
    Delete { id: String },
    /// Invoke an agent
    Invoke {
        id: String,
        #[arg(long)] body: Option<String>,
    },
}

#[derive(Serialize, Deserialize, Debug)]
pub struct AgentRequest {
    pub name: String,
    pub description: String,
    pub endpoint: String,
    #[serde(rename = "authType")]
    pub auth_type: String,
    #[serde(rename = "authValue", skip_serializing_if = "Option::is_none")]
    pub auth_value: Option<String>,
}

#[derive(Deserialize, Debug)]
pub struct AgentResponse {
    pub id: String,
    pub name: String,
    pub status: String,
    pub endpoint: String,
    pub description: Option<String>,
    #[serde(rename = "authType")]
    pub auth_type: String,
}

#[derive(Serialize, Deserialize, Debug)]
struct UpdateRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub endpoint: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

pub fn handle(cmd: AgentCommands) -> Result<()> {
    match cmd {
        AgentCommands::Register => register(),
        AgentCommands::List => list(),
        AgentCommands::Get { id } => get(&id),
        AgentCommands::Update { id, name, endpoint, description } => {
            update(&id, name, endpoint, description)
        }
        AgentCommands::Delete { id } => delete(&id),
        AgentCommands::Invoke { id, body } => invoke(&id, body.as_deref()),
    }
}

fn prompt(label: &str) -> Result<String> {
    print!("{}: ", label);
    io::stdout().flush()?;
    let mut buf = String::new();
    io::stdin().read_line(&mut buf)?;
    Ok(buf.trim().to_string())
}

fn register() -> Result<()> {
    let config = load_config()?;
    let name = prompt("Agent name")?;
    let description = prompt("Description")?;
    let endpoint = prompt("Endpoint URL")?;
    println!("Auth type [none/api_key/bearer_token/basic] (default: none):");
    let auth_type_raw = prompt("Auth type")?;
    let auth_type = if auth_type_raw.is_empty() {
        "none".to_string()
    } else {
        auth_type_raw
    };
    let auth_value = if auth_type != "none" {
        Some(prompt("Auth value")?)
    } else {
        None
    };

    let body = AgentRequest { name, description, endpoint, auth_type, auth_value };
    let client = reqwest::blocking::Client::new();
    let url = format!("{}/api/v1/agents", config.server_url);
    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", config.api_key))
        .json(&body)
        .send()
        .context("Failed to connect to server")?;

    check_status(resp.status().as_u16())?;
    let agent: AgentResponse = resp.json().context("Invalid response from server")?;
    println!("Agent registered. ID: {}", agent.id);
    Ok(())
}

fn list() -> Result<()> {
    let config = load_config()?;
    let client = reqwest::blocking::Client::new();
    let url = format!("{}/api/v1/agents", config.server_url);
    let resp = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", config.api_key))
        .send()
        .context("Failed to connect to server")?;

    check_status(resp.status().as_u16())?;
    let agents: Vec<AgentResponse> = resp.json().context("Invalid response from server")?;

    if agents.is_empty() {
        println!("No agents registered.");
        return Ok(());
    }

    println!("{:<36}  {:<20}  {:<8}  {}", "ID", "NAME", "STATUS", "ENDPOINT");
    println!("{}", "-".repeat(100));
    for a in &agents {
        println!("{:<36}  {:<20}  {:<8}  {}", a.id, a.name, a.status, a.endpoint);
    }
    Ok(())
}

fn get(id: &str) -> Result<()> {
    let config = load_config()?;
    let client = reqwest::blocking::Client::new();
    let url = format!("{}/api/v1/agents/{}", config.server_url, id);
    let resp = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", config.api_key))
        .send()
        .context("Failed to connect to server")?;

    check_status(resp.status().as_u16())?;
    let body: serde_json::Value = resp.json().context("Invalid response from server")?;
    println!("{}", serde_json::to_string_pretty(&body)?);
    Ok(())
}

fn update(id: &str, name: Option<String>, endpoint: Option<String>, description: Option<String>) -> Result<()> {
    let config = load_config()?;
    let client = reqwest::blocking::Client::new();
    let url = format!("{}/api/v1/agents/{}", config.server_url, id);
    let body = UpdateRequest { name, endpoint, description };
    let resp = client
        .put(&url)
        .header("Authorization", format!("Bearer {}", config.api_key))
        .json(&body)
        .send()
        .context("Failed to connect to server")?;

    check_status(resp.status().as_u16())?;
    let agent: AgentResponse = resp.json().context("Invalid response from server")?;
    println!("Agent updated. Name: {}", agent.name);
    Ok(())
}

fn delete(id: &str) -> Result<()> {
    print!("Delete agent {}? [y/N]: ", id);
    io::stdout().flush()?;
    let mut buf = String::new();
    io::stdin().read_line(&mut buf)?;
    if buf.trim().to_lowercase() != "y" {
        println!("Cancelled.");
        return Ok(());
    }

    let config = load_config()?;
    let client = reqwest::blocking::Client::new();
    let url = format!("{}/api/v1/agents/{}", config.server_url, id);
    let resp = client
        .delete(&url)
        .header("Authorization", format!("Bearer {}", config.api_key))
        .send()
        .context("Failed to connect to server")?;

    check_status(resp.status().as_u16())?;
    println!("Agent {} deleted.", id);
    Ok(())
}

fn invoke(id: &str, body: Option<&str>) -> Result<()> {
    let config = load_config()?;
    let client = reqwest::blocking::Client::new();
    let url = format!("{}/api/v1/agents/{}/invoke", config.server_url, id);
    let payload = body.unwrap_or("{}");
    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", config.api_key))
        .header("Content-Type", "application/json")
        .body(payload.to_string())
        .send()
        .context("Failed to connect to server")?;

    check_status(resp.status().as_u16())?;
    let result: serde_json::Value = resp.json().context("Invalid response from server")?;
    println!("{}", serde_json::to_string_pretty(&result)?);
    Ok(())
}

fn check_status(code: u16) -> Result<()> {
    match code {
        200..=299 => Ok(()),
        401 => anyhow::bail!("Invalid API key. Run 'msctl auth login' to reconfigure."),
        404 => anyhow::bail!("Agent not found."),
        409 => anyhow::bail!("Conflict: resource already exists."),
        500 => anyhow::bail!("Server error. Check backend logs."),
        c => anyhow::bail!("Unexpected HTTP {}", c),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use mockito::Server;

    /// agent register: sends correct JSON body to POST /api/v1/agents
    ///
    /// Data construction:
    ///   name        = "my-agent"
    ///   description = "test agent"
    ///   endpoint    = "http://localhost:9000"
    ///   auth_type   = "none"
    ///   auth_value  = None
    ///
    /// Execution:
    ///   1. Start mockito server
    ///   2. Register mock for POST /api/v1/agents returning 201 + agent JSON
    ///   3. Build AgentRequest and POST it
    ///   4. Assert mock was called exactly once
    ///
    /// Expected:
    ///   - Mock receives exactly the expected JSON body
    ///   - Response deserializes to AgentResponse with correct id
    #[test]
    fn test_register_sends_correct_body() {
        let mut server = Server::new();
        let mock = server
            .mock("POST", "/api/v1/agents")
            .match_header("Authorization", "Bearer ms_testkey")
            .with_status(201)
            .with_header("content-type", "application/json")
            .with_body(r#"{"id":"uuid-001","name":"my-agent","status":"active","endpoint":"http://localhost:9000","description":"test agent","authType":"none"}"#)
            .create();

        let client = reqwest::blocking::Client::new();
        let body = AgentRequest {
            name: "my-agent".to_string(),
            description: "test agent".to_string(),
            endpoint: "http://localhost:9000".to_string(),
            auth_type: "none".to_string(),
            auth_value: None,
        };
        let resp = client
            .post(format!("{}/api/v1/agents", server.url()))
            .header("Authorization", "Bearer ms_testkey")
            .json(&body)
            .send()
            .unwrap();

        assert_eq!(resp.status().as_u16(), 201,
            "register should return 201 Created");
        let agent: AgentResponse = resp.json().unwrap();
        assert_eq!(agent.id, "uuid-001",
            "response should contain the agent id");
        mock.assert();
    }

    /// agent list: GET /api/v1/agents returns table of agents
    ///
    /// Data construction:
    ///   - Mock returns 2 agents
    ///
    /// Execution:
    ///   1. Start mockito server
    ///   2. Mock GET /api/v1/agents → 200 with 2-item array
    ///   3. Deserialize response
    ///
    /// Expected:
    ///   - Response contains 2 agents
    ///   - First agent name == "agent-one"
    #[test]
    fn test_list_returns_agents() {
        let mut server = Server::new();
        let mock = server
            .mock("GET", "/api/v1/agents")
            .match_header("Authorization", "Bearer ms_testkey")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"[
                {"id":"id-1","name":"agent-one","status":"active","endpoint":"http://a.com","description":"desc","authType":"none"},
                {"id":"id-2","name":"agent-two","status":"inactive","endpoint":"http://b.com","description":"desc","authType":"none"}
            ]"#)
            .create();

        let client = reqwest::blocking::Client::new();
        let resp = client
            .get(format!("{}/api/v1/agents", server.url()))
            .header("Authorization", "Bearer ms_testkey")
            .send()
            .unwrap();

        assert_eq!(resp.status().as_u16(), 200);
        let agents: Vec<AgentResponse> = resp.json().unwrap();
        assert_eq!(agents.len(), 2,
            "list should return 2 agents");
        assert_eq!(agents[0].name, "agent-one",
            "first agent name should be agent-one");
        mock.assert();
    }

    /// agent invoke: POST /api/v1/agents/{id}/invoke forwards body and returns response
    ///
    /// Data construction:
    ///   - invoke body: {"query": "hello"}
    ///   - mock returns {"result": "ok"}
    ///
    /// Execution:
    ///   1. Mock POST /api/v1/agents/uuid-001/invoke → 200 {"result": "ok"}
    ///   2. POST with body
    ///
    /// Expected:
    ///   - HTTP 200
    ///   - Response body contains "result": "ok"
    #[test]
    fn test_invoke_sends_body_and_returns_response() {
        let mut server = Server::new();
        let mock = server
            .mock("POST", "/api/v1/agents/uuid-001/invoke")
            .match_header("Authorization", "Bearer ms_testkey")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"result":"ok"}"#)
            .create();

        let client = reqwest::blocking::Client::new();
        let resp = client
            .post(format!("{}/api/v1/agents/uuid-001/invoke", server.url()))
            .header("Authorization", "Bearer ms_testkey")
            .header("Content-Type", "application/json")
            .body(r#"{"query":"hello"}"#)
            .send()
            .unwrap();

        assert_eq!(resp.status().as_u16(), 200);
        let result: serde_json::Value = resp.json().unwrap();
        assert_eq!(result["result"], "ok",
            "invoke response should contain result: ok");
        mock.assert();
    }
}
