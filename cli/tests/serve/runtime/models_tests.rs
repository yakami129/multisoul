use super::*;
#[cfg(unix)]
use std::{
    path::Path,
    sync::{Mutex, OnceLock},
};
#[cfg(unix)]
use tempfile::tempdir;

/// Claude provider: builtin models expose Default first and concrete Sonnet second.
///
/// 数据构造（含关键数值的推导过程）：
///   runtime        = "claude-code"
///   expected[0]    = Default（虚拟项，数据库 NULL 语义）
///   expected[1]    = claude-sonnet-4-6（内置 Claude fallback 模型）
///
/// 执行过程（逐步说明系统如何处理）：
///   1. 调用 list_models("claude-code")
///   2. 检查 Default 虚拟项排在第一位
///   3. 检查 Sonnet 作为 concrete 模型存在
///
/// 预期结果：
///   - 正断言：第 0 项 id 为 "default" 且 is_default=true
///   - 正断言：第 1 项 id 为 "claude-sonnet-4-6" 且 source=builtin
///   - 负断言：第 1 项不是 default，避免 concrete 模型被 UI 当成 Default
#[test]
fn test_claude_builtin_models_include_default_first() {
    let models = list_models("claude-code").expect("claude-code should list builtin models");
    let default = &models[0];
    let sonnet = &models[1];

    assert_eq!(
        default.id, "default",
        "Claude first model id should be the virtual default item"
    );
    assert!(
        default.is_default,
        "Claude first model should be marked default for NULL model_id"
    );
    assert_eq!(
        sonnet.id, "claude-sonnet-4-6",
        "Claude concrete builtin list should include Sonnet 4.6 after Default"
    );
    assert_eq!(
        sonnet.source,
        ModelSource::Builtin,
        "Claude Sonnet should be a builtin fallback model"
    );
    assert!(
        !sonnet.is_default,
        "Claude Sonnet must not be marked default"
    );
}

/// Codex provider: builtin models expose Default first and GPT-5.3 Codex second.
///
/// 数据构造（含关键数值的推导过程）：
///   runtime        = "codex"
///   expected[0]    = Default（虚拟项，PATCH null 语义）
///   expected[1]    = gpt-5.5（内置 Codex fallback 模型）
///
/// 执行过程（逐步说明系统如何处理）：
///   1. 调用 list_models("codex")
///   2. 检查 Default 虚拟项排在第一位
///   3. 检查 concrete Codex 模型排在后面
///
/// 预期结果：
///   - 正断言：Default 是第一项且可用
///   - 正断言：gpt-5.5 是 concrete builtin
///   - 负断言：gpt-5.5 不应被标记为 default
#[test]
fn test_codex_builtin_models_include_default_first() {
    let models = list_models("codex").expect("codex should list builtin models");
    let default = &models[0];
    let codex = &models[1];

    assert_eq!(
        default.id, "default",
        "Codex first model id should be the virtual default item"
    );
    assert!(
        default.available,
        "Codex Default should be available for switching back to runtime default"
    );
    assert_eq!(
        codex.id, "gpt-5.5",
        "Codex concrete builtin list should include gpt-5.5 after Default"
    );
    assert_eq!(
        codex.source,
        ModelSource::Builtin,
        "Codex concrete model should be builtin fallback"
    );
    assert!(
        !codex.is_default,
        "Codex concrete model must not be marked default"
    );
}

/// InfCode provider: builtin models expose Default first and provider:model entries.
///
/// 数据构造（含关键数值的推导过程）：
///   runtime        = "infcode"
///   expected[0]    = Default（虚拟项，PATCH null 语义）
///   expected[1..]  = 常用 InfCode provider:model 内置项
///
/// 执行过程（逐步说明系统如何处理）：
///   1. 调用 list_models("infcode")
///   2. 检查 Default 虚拟项排在第一位
///   3. 检查 InfCode concrete 模型使用 provider:model 格式
///
/// 预期结果：
///   - 正断言：Default 是第一项且可用
///   - 正断言：内置列表包含 InfCode 常用 provider:model 项
///   - 负断言：concrete 模型不应被标记为 default
#[test]
fn test_infcode_builtin_models_include_default_first_and_provider_models() {
    let models = list_models("infcode").expect("infcode should list builtin models");
    let default = &models[0];
    let concrete_ids: Vec<&str> = models
        .iter()
        .filter(|model| !model.is_default)
        .map(|model| model.id.as_str())
        .collect();

    assert_eq!(
        default.id, "default",
        "InfCode first model id should be the virtual default item"
    );
    assert!(
        default.available,
        "InfCode Default should be available for switching back to runtime default"
    );
    for expected in [
        "openai:gpt-5.3-codex",
        "openai:gpt-5.4",
        "openai:gpt-5.3-codex-spark",
        "anthropic:claude-sonnet-4-6",
        "deepseek:deepseek-chat",
        "kimi:k2.5",
        "kimi-code:k2.5",
        "qwen:qwen3.5-plus",
        "zhipu:glm-5",
        "zhipu-coding:glm-5",
        "minimax-coding:MiniMax-M2.7",
    ] {
        assert!(
            concrete_ids.contains(&expected),
            "InfCode builtin models should include {expected}"
        );
    }
    assert!(
        models[1..].iter().all(|model| {
            !model.is_default && model.source == ModelSource::Builtin && model.id.contains(':')
        }),
        "InfCode concrete models should be builtin provider:model entries"
    );
}

/// Cursor provider: dynamic `agent models` output wins over builtin fallback.
///
/// 数据构造（含关键数值的推导过程）：
///   fake agent models JSON = [{"id":"cursor-dynamic","label":"Cursor Dynamic"}]
///   expected[0] = Default（虚拟项，本地插入）
///   expected[1] = cursor-dynamic（dynamic source）
///
/// 执行过程（逐步说明系统如何处理）：
///   1. CURSOR_AGENT_BIN 指向 fake agent，可响应 `models`
///   2. 调用 list_models("cursor-cli")
///   3. 检查返回列表使用动态模型，而不是 fallback Auto
///
/// 预期结果：
///   - 正断言：第 1 项为 cursor-dynamic 且 source=dynamic
///   - 负断言：第 1 项不是 builtin fallback auto
#[cfg(unix)]
#[test]
fn test_cursor_dynamic_models_prefer_agent_models_output() {
    let dir = tempdir().expect("tempdir should be created for fake cursor agent");
    let fake_agent = dir.path().join("agent");
    write_fake_agent(
        &fake_agent,
        "printf '[{\"id\":\"cursor-dynamic\",\"label\":\"Cursor Dynamic\"}]\\n'",
    );
    let _guard = EnvVarGuard::set("CURSOR_AGENT_BIN", &fake_agent);

    let models = list_models("cursor-cli").expect("cursor-cli should list models");
    let dynamic = &models[1];

    assert_eq!(
        models[0].id, "default",
        "Cursor first model should remain the virtual Default item"
    );
    assert_eq!(
        dynamic.id, "cursor-dynamic",
        "Cursor should use dynamic agent models output before builtin fallback"
    );
    assert_eq!(
        dynamic.source,
        ModelSource::Dynamic,
        "Cursor dynamic model should be marked with dynamic source"
    );
    assert_ne!(
        dynamic.id, "auto",
        "Cursor dynamic result must not be replaced by builtin fallback Auto"
    );
}

/// Cursor provider: failed `agent models` command falls back to builtin Auto.
///
/// 数据构造（含关键数值的推导过程）：
///   fake agent models exit code = 7（动态查询失败）
///   fallback[0] after Default = auto（内置 Cursor fallback）
///
/// 执行过程（逐步说明系统如何处理）：
///   1. CURSOR_AGENT_BIN 指向 always-failing fake agent
///   2. 调用 list_models("cursor-cli")
///   3. 检查 fallback 列表仍返回给 mobile
///
/// 预期结果：
///   - 正断言：第 1 项为 auto 且 source=builtin
///   - 负断言：fallback 不应返回 dynamic source
#[cfg(unix)]
#[test]
fn test_cursor_models_fallback_to_builtin_when_agent_models_fails() {
    let dir = tempdir().expect("tempdir should be created for fake cursor agent");
    let fake_agent = dir.path().join("agent");
    write_fake_agent(&fake_agent, "exit 7");
    let _guard = EnvVarGuard::set("CURSOR_AGENT_BIN", &fake_agent);

    let models = list_models("cursor-cli").expect("cursor-cli should fall back to builtins");
    let fallback = &models[1];

    assert_eq!(
        fallback.id, "auto",
        "Cursor fallback first concrete model should be Auto"
    );
    assert_eq!(
        fallback.source,
        ModelSource::Builtin,
        "Cursor fallback model should be marked builtin"
    );
    assert_ne!(
        fallback.source,
        ModelSource::Dynamic,
        "Cursor fallback must not be marked dynamic after agent models failure"
    );
}

/// validate_model treats None as default but rejects the literal "default" for persistence.
///
/// 数据构造（含关键数值的推导过程）：
///   runtime             = "codex"（受支持 runtime）
///   persisted default   = None（数据库 NULL 表示默认模型）
///   forbidden string    = Some("default")（不能持久化的虚拟 id）
///
/// 执行过程（逐步说明系统如何处理）：
///   1. validate_model("codex", None) 表示用户未覆盖模型
///   2. validate_model("codex", Some("default")) 表示尝试持久化虚拟 id
///
/// 预期结果：
///   - 断言 A：None 校验通过，说明 NULL/None 是唯一默认语义
///   - 断言 B：Some("default") 返回 InvalidDefaultString，说明不会把虚拟 id 写入配置
#[test]
fn test_validate_default_semantics() {
    assert!(
        validate_model("codex", None).is_ok(),
        "None should be accepted as the persisted default model semantics"
    );

    let err = validate_model("codex", Some("default"))
        .expect_err("literal default should be rejected for persistence");
    assert_eq!(
        err,
        ModelProviderError::InvalidDefaultString,
        "literal default must be rejected so storage uses None for default semantics"
    );
}

/// validate_model rejects unknown concrete models for an otherwise supported runtime.
///
/// 数据构造（含关键数值的推导过程）：
///   runtime        = "codex"（受支持 runtime）
///   model_id       = "made-up-model"（不在 Codex builtin fallback 列表）
///   fallback count = 4（gpt-5.5 / gpt-5.5:high / gpt-5.5:xhigh / gpt-5.4-mini，均不匹配 model_id）
///
/// 执行过程（逐步说明系统如何处理）：
///   1. 调用 validate_model("codex", Some("made-up-model"))
///   2. provider 在 codex 的 3 个 builtin 模型中查找
///   3. 未命中时返回 UnsupportedModel
///
/// 预期结果：
///   - 断言 A：返回 UnsupportedModel，说明 valid runtime 不会静默接受未知模型
///   - 断言 B：错误携带 runtime，说明调用方能定位哪个 runtime 校验失败
///   - 断言 C：错误携带 model_id，说明调用方能提示具体非法值
#[test]
fn test_validate_unsupported_model_for_supported_runtime() {
    let err = validate_model("codex", Some("made-up-model"))
        .expect_err("unknown codex model should be rejected");

    assert_eq!(
        err,
        ModelProviderError::UnsupportedModel {
            runtime: "codex".to_string(),
            model_id: "made-up-model".to_string(),
        },
        "unsupported model errors should include the runtime and rejected model id"
    );
}

/// validate_model accepts only builtin InfCode provider:model entries.
///
/// 数据构造（含关键数值的推导过程）：
///   runtime            = "infcode"（受支持 runtime）
///   persisted default  = None（数据库 NULL 表示默认模型）
///   valid model        = "openai:gpt-5.4"（内置 provider:model）
///   invalid values     = default / openai / openai: / :gpt-5.4 / gpt-5.4
///
/// 执行过程（逐步说明系统如何处理）：
///   1. validate_model("infcode", None)
///   2. validate_model("infcode", Some("openai:gpt-5.4"))
///   3. 校验虚拟 default 和非内置或格式不完整的字符串
///
/// 预期结果：
///   - 正断言：None 和内置 provider:model 校验通过
///   - 负断言：literal default 仍返回 InvalidDefaultString
///   - 负断言：格式不完整或非内置 model 返回 UnsupportedModel
#[test]
fn test_validate_infcode_builtin_provider_models_only() {
    assert!(
        validate_model("infcode", None).is_ok(),
        "None should be accepted as the persisted default InfCode model semantics"
    );
    assert!(
        validate_model("infcode", Some("openai:gpt-5.4")).is_ok(),
        "InfCode builtin provider:model entries should validate"
    );

    let default_err = validate_model("infcode", Some("default"))
        .expect_err("literal default should be rejected for InfCode persistence");
    assert_eq!(
        default_err,
        ModelProviderError::InvalidDefaultString,
        "InfCode literal default must be rejected so storage uses None"
    );

    for invalid in ["openai", "openai:", ":gpt-5.4", "gpt-5.4"] {
        let err = validate_model("infcode", Some(invalid))
            .expect_err("malformed or unknown InfCode model should be rejected");
        assert_eq!(
            err,
            ModelProviderError::UnsupportedModel {
                runtime: "infcode".to_string(),
                model_id: invalid.to_string(),
            },
            "InfCode unsupported model errors should identify the rejected id"
        );
    }
}

/// validate_model accepts dynamically discovered Cursor models and rejects absent ones.
///
/// 数据构造（含关键数值的推导过程）：
///   fake dynamic model = cursor-dynamic（只来自 agent models，不在 builtin fallback）
///   absent model       = made-up-cursor（动态列表和 fallback 都不包含）
///
/// 执行过程（逐步说明系统如何处理）：
///   1. CURSOR_AGENT_BIN 指向返回 cursor-dynamic 的 fake agent
///   2. validate_model("cursor-cli", Some("cursor-dynamic"))
///   3. validate_model("cursor-cli", Some("made-up-cursor"))
///
/// 预期结果：
///   - 正断言：cursor-dynamic 校验通过
///   - 负断言：made-up-cursor 返回 UnsupportedModel
#[cfg(unix)]
#[test]
fn test_validate_cursor_dynamic_model() {
    let dir = tempdir().expect("tempdir should be created for fake cursor agent");
    let fake_agent = dir.path().join("agent");
    write_fake_agent(&fake_agent, "printf '[\"cursor-dynamic\"]\\n'");
    let _guard = EnvVarGuard::set("CURSOR_AGENT_BIN", &fake_agent);

    assert!(
        validate_model("cursor-cli", Some("cursor-dynamic")).is_ok(),
        "Cursor dynamic model from agent models should validate"
    );
    let err = validate_model("cursor-cli", Some("made-up-cursor"))
        .expect_err("absent Cursor dynamic model should be rejected");
    assert_eq!(
        err,
        ModelProviderError::UnsupportedModel {
            runtime: "cursor-cli".to_string(),
            model_id: "made-up-cursor".to_string(),
        },
        "Cursor unsupported dynamic model error should include runtime and model id"
    );
}

/// split_model_effort: compound "model:effort" splits correctly; plain model returns None effort.
#[test]
fn test_split_model_effort() {
    let (model, effort) = split_model_effort("gpt-5.5:high");
    assert_eq!(model, "gpt-5.5");
    assert_eq!(effort, Some("high"));

    let (model, effort) = split_model_effort("gpt-5.5:xhigh");
    assert_eq!(model, "gpt-5.5");
    assert_eq!(effort, Some("xhigh"));

    let (model, effort) = split_model_effort("gpt-5.5");
    assert_eq!(model, "gpt-5.5");
    assert_eq!(effort, None);

    let (model, effort) = split_model_effort("claude-sonnet-4-6");
    assert_eq!(model, "claude-sonnet-4-6");
    assert_eq!(effort, None);
}

#[cfg(unix)]
fn write_fake_agent(path: &Path, body: &str) {
    std::fs::write(path, format!("#!/bin/sh\n{}\n", body))
        .expect("fake cursor agent should be written");
    use std::os::unix::fs::PermissionsExt;
    let mut perms = std::fs::metadata(path)
        .expect("fake cursor agent metadata should exist")
        .permissions();
    perms.set_mode(0o755);
    std::fs::set_permissions(path, perms).expect("fake cursor agent should be executable");
}

#[cfg(unix)]
struct EnvVarGuard {
    key: String,
    previous: Option<String>,
    _lock: std::sync::MutexGuard<'static, ()>,
}

#[cfg(unix)]
impl EnvVarGuard {
    fn set(key: &str, value: &Path) -> Self {
        static ENV_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        let lock = ENV_LOCK.get_or_init(|| Mutex::new(())).lock().unwrap();
        let previous = std::env::var(key).ok();
        std::env::set_var(key, value);
        Self {
            key: key.to_string(),
            previous,
            _lock: lock,
        }
    }
}

#[cfg(unix)]
impl Drop for EnvVarGuard {
    fn drop(&mut self) {
        if let Some(value) = &self.previous {
            std::env::set_var(&self.key, value);
        } else {
            std::env::remove_var(&self.key);
        }
    }
}
