use regex::Regex;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum InfcodeOutputMode {
    JsonEvents,
    LegacyPrint,
}

#[derive(Clone, Debug)]
pub(super) struct InfcodeInvocation {
    pub(super) bin: String,
    pub(super) args: Vec<String>,
    pub(super) output_mode: InfcodeOutputMode,
}

pub(super) fn primary_invocation(
    conv_id: &str,
    prompt: &str,
    model_id: Option<&str>,
) -> Result<InfcodeInvocation, String> {
    let bin = configured_infcode_bin().unwrap_or_else(|| "infcode".to_string());
    Ok(InfcodeInvocation {
        bin,
        args: build_infcode_args(conv_id, prompt, model_id)?,
        output_mode: InfcodeOutputMode::JsonEvents,
    })
}

pub(super) fn legacy_fallback_invocation(
    primary: &InfcodeInvocation,
    prompt: &str,
    model_id: Option<&str>,
    error: &str,
) -> Option<InfcodeInvocation> {
    let bin = if configured_infcode_bin().is_some() {
        primary.bin.clone()
    } else if should_fallback_to_kodax_bin(error) {
        "kodax".to_string()
    } else if should_retry_same_bin_in_legacy_mode(error) {
        primary.bin.clone()
    } else {
        return None;
    };

    build_legacy_args(prompt, model_id)
        .ok()
        .map(|args| InfcodeInvocation {
            bin,
            args,
            output_mode: InfcodeOutputMode::LegacyPrint,
        })
}

fn configured_infcode_bin() -> Option<String> {
    std::env::var("INFCODE_BIN")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

pub(super) fn build_infcode_args(
    conv_id: &str,
    prompt: &str,
    model_id: Option<&str>,
) -> Result<Vec<String>, String> {
    let mut args = vec![
        "--mode".to_string(),
        "json".to_string(),
        "--session".to_string(),
        conv_id.to_string(),
        "--agent-mode".to_string(),
        "ama".to_string(),
    ];
    if let Some(model_id) = normalize_model_id(model_id) {
        let (provider, model) = split_provider_model(&model_id)?;
        args.push("-m".to_string());
        args.push(provider.to_string());
        args.push("--model".to_string());
        args.push(model.to_string());
    }
    args.push(prompt.to_string());
    Ok(args)
}

pub(super) fn build_legacy_args(
    prompt: &str,
    model_id: Option<&str>,
) -> Result<Vec<String>, String> {
    let mut args = Vec::new();
    if let Some(model_id) = normalize_model_id(model_id) {
        let (provider, model) = split_provider_model(&model_id)?;
        args.push("-m".to_string());
        args.push(provider.to_string());
        args.push("--model".to_string());
        args.push(model.to_string());
    }
    args.push("-p".to_string());
    args.push(prompt.to_string());
    args.push("--no-session".to_string());
    Ok(args)
}

pub(super) fn should_retry_same_bin_in_legacy_mode(error: &str) -> bool {
    error.contains("too many arguments")
        || error.contains("Expected 0 arguments but got 1")
        || error.contains("`--mode json` cannot be combined with `-p/--print`")
}

fn should_fallback_to_kodax_bin(error: &str) -> bool {
    error.contains("spawn infcode:")
        && (error.contains("No such file or directory") || error.contains("os error 2"))
}

pub(super) fn split_provider_model(model_id: &str) -> Result<(&str, &str), String> {
    let (provider, model) = model_id.split_once(':').ok_or_else(|| {
        format!(
            "invalid InfCode model id `{}`: expected provider:model",
            model_id
        )
    })?;
    let provider = provider.trim();
    let model = model.trim();
    if provider.is_empty() || model.is_empty() {
        return Err(format!(
            "invalid InfCode model id `{}`: provider and model must be non-empty",
            model_id
        ));
    }
    Ok((provider, model))
}

pub(super) fn normalize_model_id(model_id: Option<&str>) -> Option<String> {
    model_id
        .map(str::trim)
        .filter(|model_id| !model_id.is_empty())
        .map(ToString::to_string)
}

pub(super) fn sanitize_legacy_output(raw: &str) -> String {
    let ansi = ansi_regex();
    let normalized = ansi.replace_all(raw, "");
    let normalized = normalized.replace('\r', "\n");
    let mut kept = Vec::new();

    for raw_line in normalized.lines() {
        let line = raw_line.trim();
        if line.is_empty() {
            continue;
        }
        if line.starts_with("[KodaX] Provider:")
            || line == "[Assistant]"
            || line == "[KodaX] Done!"
            || line.starts_with("Thinking...")
            || line.starts_with("Processing...")
            || line.contains("⠋ Thinking...")
            || line.contains("⠙ Thinking...")
            || line.contains("⠹ Thinking...")
            || line.contains("⠸ Thinking...")
            || line.contains("⠼ Thinking...")
            || line.contains("⠴ Thinking...")
            || line.contains("⠦ Thinking...")
            || line.contains("⠧ Thinking...")
            || line.contains("⠇ Thinking...")
            || line.contains("⠏ Thinking...")
            || line.contains("⠋ Processing...")
            || line.contains("⠙ Processing...")
            || line.contains("⠹ Processing...")
            || line.contains("⠸ Processing...")
            || line.contains("⠼ Processing...")
            || line.contains("⠴ Processing...")
            || line.contains("⠦ Processing...")
            || line.contains("⠧ Processing...")
            || line.contains("⠇ Processing...")
            || line.contains("⠏ Processing...")
        {
            continue;
        }

        kept.push(line.to_string());
    }

    let mut text = kept.join("\n");
    if let Some((answer, _)) = text.split_once("[Thinking]") {
        text = answer.trim().to_string();
    }
    text.trim().to_string()
}

fn ansi_regex() -> &'static Regex {
    static ANSI_REGEX: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    ANSI_REGEX.get_or_init(|| {
        Regex::new(r"\x1B\[[0-9;?]*[ -/]*[@-~]").expect("ANSI escape regex should compile")
    })
}
