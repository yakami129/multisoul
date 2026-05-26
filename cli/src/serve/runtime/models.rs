use serde::Serialize;
use std::process::Command;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ModelSource {
    Builtin,
    Dynamic,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ModelCapability {
    pub id: String,
    pub label: String,
    pub is_default: bool,
    pub source: ModelSource,
    pub available: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ModelProviderError {
    UnknownRuntime(String),
    UnsupportedModel { runtime: String, model_id: String },
    InvalidDefaultString,
}

struct BuiltinModel {
    id: &'static str,
    label: &'static str,
}

const CLAUDE_MODELS: &[BuiltinModel] = &[
    BuiltinModel {
        id: "claude-sonnet-4-6",
        label: "Sonnet 4.6",
    },
    BuiltinModel {
        id: "claude-opus-4-6",
        label: "Opus 4.6",
    },
];

const CODEX_MODELS: &[BuiltinModel] = &[
    BuiltinModel {
        id: "gpt-5.5",
        label: "GPT-5.5",
    },
    BuiltinModel {
        id: "gpt-5.5:high",
        label: "GPT-5.5 High",
    },
    BuiltinModel {
        id: "gpt-5.5:xhigh",
        label: "GPT-5.5 XHigh",
    },
    BuiltinModel {
        id: "gpt-5.4-mini",
        label: "GPT-5.4 Mini",
    },
];

const CURSOR_MODELS: &[BuiltinModel] = &[
    BuiltinModel {
        id: "auto",
        label: "Auto",
    },
    BuiltinModel {
        id: "composer-2",
        label: "Composer 2",
    },
    BuiltinModel {
        id: "gpt-5.5",
        label: "GPT-5.5",
    },
];

pub fn list_models(runtime: &str) -> Result<Vec<ModelCapability>, ModelProviderError> {
    if runtime == "cursor-cli" {
        return Ok(with_default(cursor_models()));
    }
    let builtins = builtin_models(runtime)?;
    Ok(with_default(
        builtins
            .iter()
            .map(|model| builtin_capability(model.id, model.label))
            .collect(),
    ))
}

fn with_default(mut concrete: Vec<ModelCapability>) -> Vec<ModelCapability> {
    let mut models = Vec::with_capacity(concrete.len() + 1);
    models.push(ModelCapability {
        id: "default".to_string(),
        label: "Default".to_string(),
        is_default: true,
        source: ModelSource::Builtin,
        available: true,
    });
    models.append(&mut concrete);
    models
}

fn builtin_capability(id: &str, label: &str) -> ModelCapability {
    ModelCapability {
        id: id.to_string(),
        label: label.to_string(),
        is_default: false,
        source: ModelSource::Builtin,
        available: true,
    }
}

fn dynamic_capability(id: String, label: String) -> ModelCapability {
    ModelCapability {
        id,
        label,
        is_default: false,
        source: ModelSource::Dynamic,
        available: true,
    }
}

pub fn validate_model(runtime: &str, model_id: Option<&str>) -> Result<(), ModelProviderError> {
    let Some(model_id) = model_id else {
        builtin_models(runtime)?;
        return Ok(());
    };

    if model_id == "default" {
        return Err(ModelProviderError::InvalidDefaultString);
    }

    let models = list_models(runtime)?;
    if models
        .iter()
        .any(|model| !model.is_default && model.id == model_id)
    {
        Ok(())
    } else {
        Err(ModelProviderError::UnsupportedModel {
            runtime: runtime.to_string(),
            model_id: model_id.to_string(),
        })
    }
}

/// Split a compound model ID (`"gpt-5.5:high"`) into base model and optional
/// reasoning effort. Plain IDs like `"gpt-5.5"` return `None` for effort.
pub fn split_model_effort(compound: &str) -> (&str, Option<&str>) {
    match compound.split_once(':') {
        Some((model, effort)) if !effort.is_empty() => (model, Some(effort)),
        _ => (compound, None),
    }
}

fn builtin_models(runtime: &str) -> Result<&'static [BuiltinModel], ModelProviderError> {
    match runtime {
        "claude-code" => Ok(CLAUDE_MODELS),
        "codex" => Ok(CODEX_MODELS),
        "cursor-cli" => Ok(CURSOR_MODELS),
        other => Err(ModelProviderError::UnknownRuntime(other.to_string())),
    }
}

fn cursor_models() -> Vec<ModelCapability> {
    match query_cursor_models() {
        Some(models) if !models.is_empty() => models,
        _ => CURSOR_MODELS
            .iter()
            .map(|model| builtin_capability(model.id, model.label))
            .collect(),
    }
}

fn query_cursor_models() -> Option<Vec<ModelCapability>> {
    let output = Command::new(cursor_agent_bin())
        .arg("models")
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8(output.stdout).ok()?;
    parse_cursor_models(&stdout)
}

fn cursor_agent_bin() -> String {
    std::env::var("CURSOR_AGENT_BIN").unwrap_or_else(|_| "agent".to_string())
}

fn parse_cursor_models(stdout: &str) -> Option<Vec<ModelCapability>> {
    let trimmed = stdout.trim();
    if trimmed.is_empty() {
        return None;
    }
    if let Ok(json) = serde_json::from_str::<serde_json::Value>(trimmed) {
        return parse_cursor_models_json(&json);
    }

    let models: Vec<ModelCapability> = stdout
        .lines()
        .filter_map(|line| {
            let id = line
                .trim()
                .trim_start_matches(['-', '*'])
                .split_whitespace()
                .next()?;
            if id.is_empty() || id.eq_ignore_ascii_case("model") || id.eq_ignore_ascii_case("id") {
                return None;
            }
            Some(dynamic_capability(id.to_string(), label_from_model_id(id)))
        })
        .collect();
    (!models.is_empty()).then_some(models)
}

fn parse_cursor_models_json(json: &serde_json::Value) -> Option<Vec<ModelCapability>> {
    let array = json.as_array().or_else(|| {
        json.get("models")
            .and_then(|models| models.as_array())
            .or_else(|| json.get("data").and_then(|models| models.as_array()))
    })?;
    let models: Vec<ModelCapability> = array
        .iter()
        .filter_map(|item| {
            if let Some(id) = item.as_str().filter(|id| !id.trim().is_empty()) {
                return Some(dynamic_capability(id.to_string(), label_from_model_id(id)));
            }
            let id = item
                .get("id")
                .or_else(|| item.get("name"))
                .and_then(|value| value.as_str())
                .filter(|id| !id.trim().is_empty())?;
            let label = item
                .get("label")
                .or_else(|| item.get("display_name"))
                .and_then(|value| value.as_str())
                .filter(|label| !label.trim().is_empty())
                .map(str::to_string)
                .unwrap_or_else(|| label_from_model_id(id));
            Some(dynamic_capability(id.to_string(), label))
        })
        .collect();
    (!models.is_empty()).then_some(models)
}

fn label_from_model_id(id: &str) -> String {
    id.split(['-', '_'])
        .filter(|part| !part.is_empty())
        .map(|part| {
            let mut chars = part.chars();
            match chars.next() {
                Some(first) => first.to_uppercase().chain(chars).collect::<String>(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
#[path = "models_tests.rs"]
mod tests;
