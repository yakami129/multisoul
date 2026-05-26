use serde_json::Value;

pub(super) fn merge_stream_fragment(acc: &mut String, frag: &str) {
    if frag.is_empty() {
        return;
    }
    if frag.starts_with(acc.as_str()) && frag.len() >= acc.len() {
        *acc = frag.to_string();
        return;
    }
    acc.push_str(frag);
}

pub(super) fn extract_assistant_text(v: &Value) -> String {
    let Some(msg) = v.get("message") else {
        return String::new();
    };
    let Some(arr) = msg.get("content").and_then(|c| c.as_array()) else {
        return String::new();
    };
    let mut out = String::new();
    for block in arr {
        if block.get("type").and_then(|t| t.as_str()) != Some("text") {
            continue;
        }
        if let Some(t) = block.get("text").and_then(|s| s.as_str()) {
            out.push_str(t);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn merge_stream_fragment_prefix_then_deltas() {
        let mut acc = String::new();
        merge_stream_fragment(&mut acc, "1");
        assert_eq!(acc, "1");
        merge_stream_fragment(&mut acc, ",");
        assert_eq!(acc, "1,");
        merge_stream_fragment(&mut acc, "2");
        assert_eq!(acc, "1,2");
        merge_stream_fragment(&mut acc, "1,2,3");
        assert_eq!(acc, "1,2,3");
    }

    #[test]
    fn extract_assistant_text_reads_message_content() {
        let v = json!({
            "type": "assistant",
            "message": {
                "role": "assistant",
                "content": [{"type": "text", "text": "Hello"}]
            }
        });
        assert_eq!(extract_assistant_text(&v), "Hello");
    }
}
