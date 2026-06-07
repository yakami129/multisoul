// Unit tests for `interactive::AskUserQuestion::build_updated_input`.
//
// These tests mirror the exact data flow from Mobile → WS handler → build_updated_input:
//
//   Mobile AskQuestionCard.handleConfirm(selectedId)
//     where selectedId = option.id  (the id assigned by build_ask_payload, e.g. "0", "1")
//
//   WS handler parses:
//     choice_id  = selectedId  (single-select)
//     choice_ids = {"questionIdx": selectedId}  (multi-question or multi-select via sendAnswerMulti)
//
//   build_updated_input must resolve choice_id / choice_ids back to the
//   original Claude option label and insert it into an answers map keyed by
//   the original question text, as required by Claude Code.
//
// The original_args below match what Claude Code actually emits in the
// control_request "input" field (camelCase options with "label"/"description" fields).

    use crate::serve::interactive::{AskUserQuestion, AnswerPayload};
    use std::collections::HashMap;

    fn claude_original_args() -> serde_json::Value {
        // Claude Code's AskUserQuestion input format (original_args passed to build_updated_input)
        serde_json::json!({
            "questions": [
                {
                    "question": "Which approach should we use?",
                    "header": "Approach",
                    "multiSelect": false,
                    "options": [
                        {"label": "Option A", "description": "Use approach A"},
                        {"label": "Option B", "description": "Use approach B"},
                        {"label": "Option C", "description": "Use approach C"}
                    ]
                }
            ]
        })
    }

    fn claude_multi_question_args() -> serde_json::Value {
        serde_json::json!({
            "questions": [
                {
                    "question": "Pick environment",
                    "header": "Env",
                    "multiSelect": false,
                    "options": [
                        {"label": "Staging", "description": ""},
                        {"label": "Production", "description": ""}
                    ]
                },
                {
                    "question": "Pick feature flags",
                    "header": "Flags",
                    "multiSelect": true,
                    "options": [
                        {"label": "Flag Alpha", "description": ""},
                        {"label": "Flag Beta", "description": ""},
                        {"label": "Flag Gamma", "description": ""}
                    ]
                }
            ]
        })
    }

    // ─── Single-question single-select ────────────────────────────────────────

    /// The most common path: single question, user picks option index 1 ("Option B").
    ///
    /// 数据构造：
    ///   build_ask_payload assigns option ids "0", "1", "2"
    ///   Mobile AskQuestionCard sends: choice_id = "1"  (second option)
    ///
    /// 期望：
    ///   answers["Which approach should we use?"] = "Option B"
    #[test]
    fn single_select_choice_id_resolves_to_label() {
        let original_args = claude_original_args();
        let answer = AnswerPayload {
            _ask_id: "ask-1".to_string(),
            choice_id: Some("1".to_string()),  // user picked option index 1
            choice_ids: None,
            freeform: None,
        };

        let result = AskUserQuestion::build_updated_input(&original_args, &answer);
        let answers = &result["answers"];

        assert_eq!(
            answers["Which approach should we use?"].as_str(),
            Some("Option B"),
            "choice_id '1' must resolve to label 'Option B' keyed by question text; got: {:?}",
            answers
        );
        assert!(
            answers.get("0").is_none(),
            "Claude Code expects answers keyed by question text, not question index; got: {:?}",
            answers
        );
    }

    /// User picks the first option (index 0).
    #[test]
    fn single_select_choice_id_zero_resolves_to_first_label() {
        let original_args = claude_original_args();
        let answer = AnswerPayload {
            _ask_id: "ask-1".to_string(),
            choice_id: Some("0".to_string()),
            choice_ids: None,
            freeform: None,
        };

        let result = AskUserQuestion::build_updated_input(&original_args, &answer);
        assert_eq!(
            result["answers"]["Which approach should we use?"].as_str(),
            Some("Option A"),
            "choice_id '0' must resolve to first label 'Option A'; got: {:?}",
            result["answers"]
        );
    }

    /// User picks the last option (index 2).
    #[test]
    fn single_select_choice_id_last_option_resolves_correctly() {
        let original_args = claude_original_args();
        let answer = AnswerPayload {
            _ask_id: "ask-1".to_string(),
            choice_id: Some("2".to_string()),
            choice_ids: None,
            freeform: None,
        };

        let result = AskUserQuestion::build_updated_input(&original_args, &answer);
        assert_eq!(
            result["answers"]["Which approach should we use?"].as_str(),
            Some("Option C"),
            "choice_id '2' must resolve to label 'Option C'; got: {:?}",
            result["answers"]
        );
    }

    /// Cancelled answer must NOT populate answers map.
    #[test]
    fn cancelled_answer_produces_empty_answers() {
        let original_args = claude_original_args();
        let answer = AnswerPayload {
            _ask_id: "ask-1".to_string(),
            choice_id: Some("__cancelled__".to_string()),
            choice_ids: None,
            freeform: None,
        };

        let result = AskUserQuestion::build_updated_input(&original_args, &answer);
        let answers = &result["answers"];
        assert!(
            answers.as_object().map(|m| m.is_empty()).unwrap_or(false),
            "cancelled answer must produce empty answers map; got: {:?}",
            answers
        );
    }

    /// Freeform "Other" text must go into answers keyed by question text.
    #[test]
    fn freeform_text_becomes_answer_for_question_zero() {
        let original_args = claude_original_args();
        let answer = AnswerPayload {
            _ask_id: "ask-1".to_string(),
            choice_id: None,
            choice_ids: None,
            freeform: Some("My custom answer".to_string()),
        };

        let result = AskUserQuestion::build_updated_input(&original_args, &answer);
        assert_eq!(
            result["answers"]["Which approach should we use?"].as_str(),
            Some("My custom answer"),
            "non-empty freeform text must appear under the question text key; got: {:?}",
            result["answers"]
        );
    }

    /// Empty freeform must fall through and not populate answers.
    #[test]
    fn empty_freeform_falls_through_to_empty_answers_when_no_choice() {
        let original_args = claude_original_args();
        let answer = AnswerPayload {
            _ask_id: "ask-1".to_string(),
            choice_id: None,
            choice_ids: None,
            freeform: Some("".to_string()),  // empty string
        };

        let result = AskUserQuestion::build_updated_input(&original_args, &answer);
        let answers = result["answers"].as_object().expect("answers must be an object");
        assert!(
            answers.is_empty(),
            "empty freeform with no choice_id must produce empty answers map; got: {:?}",
            answers
        );
    }

    // ─── Multi-question via choice_ids ────────────────────────────────────────

    /// Multi-question: choice_ids = {"0": "1", "1": "0"} (one selection per question).
    ///
    /// 数据构造：
    ///   Mobile sendAnswerMulti sends: choice_ids = {"0": "1", "1": "0"}
    ///   q0 idx 1 = "Production"
    ///   q1 idx 0 = "Flag Alpha"
    ///
    /// 期望：
    ///   answers["Pick environment"] = "Production"
    ///   answers["Pick feature flags"] = "Flag Alpha"
    #[test]
    fn multi_question_choice_ids_resolve_each_question_to_label() {
        let original_args = claude_multi_question_args();
        let mut choice_ids = HashMap::new();
        choice_ids.insert("0".to_string(), "1".to_string());  // Production
        choice_ids.insert("1".to_string(), "0".to_string());  // Flag Alpha
        let answer = AnswerPayload {
            _ask_id: "ask-multi".to_string(),
            choice_id: None,
            choice_ids: Some(choice_ids),
            freeform: None,
        };

        let result = AskUserQuestion::build_updated_input(&original_args, &answer);
        let answers = &result["answers"];

        assert_eq!(
            answers["Pick environment"].as_str(),
            Some("Production"),
            "q0 choice '1' must resolve to 'Production'; answers = {:?}",
            answers
        );
        assert_eq!(
            answers["Pick feature flags"].as_str(),
            Some("Flag Alpha"),
            "q1 choice '0' must resolve to 'Flag Alpha'; answers = {:?}",
            answers
        );
    }

    /// Multi-select within a question: choice_ids = {"1": "0,2"} → labels joined with ", ".
    #[test]
    fn multi_select_comma_joined_ids_resolve_to_comma_joined_labels() {
        let original_args = claude_multi_question_args();
        let mut choice_ids = HashMap::new();
        choice_ids.insert("0".to_string(), "0".to_string());    // Staging
        choice_ids.insert("1".to_string(), "0,2".to_string());  // Flag Alpha + Flag Gamma
        let answer = AnswerPayload {
            _ask_id: "ask-multi-select".to_string(),
            choice_id: None,
            choice_ids: Some(choice_ids),
            freeform: None,
        };

        let result = AskUserQuestion::build_updated_input(&original_args, &answer);
        let answers = &result["answers"];

        assert_eq!(
            answers["Pick environment"].as_str(),
            Some("Staging"),
            "q0 single choice must resolve to 'Staging'; got: {:?}",
            answers
        );
        assert_eq!(
            answers["Pick feature flags"].as_str(),
            Some("Flag Alpha, Flag Gamma"),
            "multi-select '0,2' must join labels with ', '; got: {:?}",
            answers
        );
    }

    /// Multi-select custom "Other" text must be preserved alongside option labels.
    #[test]
    fn multi_select_preserves_non_numeric_custom_text() {
        let original_args = claude_multi_question_args();
        let mut choice_ids = HashMap::new();
        choice_ids.insert("0".to_string(), "0".to_string());
        choice_ids.insert("1".to_string(), "0,custom note".to_string());
        let answer = AnswerPayload {
            _ask_id: "ask-multi-custom".to_string(),
            choice_id: None,
            choice_ids: Some(choice_ids),
            freeform: None,
        };

        let result = AskUserQuestion::build_updated_input(&original_args, &answer);

        assert_eq!(
            result["answers"]["Pick feature flags"].as_str(),
            Some("Flag Alpha, custom note"),
            "multi-select custom text must not be dropped; got: {:?}",
            result["answers"]
        );
    }

    // ─── Regression: non-numeric choice_id (freeform text passed as choice_id) ─

    /// If the user typed a custom "Other" answer and it was passed as choice_id
    /// (non-numeric), it should appear as-is in answers keyed by question text.
    #[test]
    fn non_numeric_choice_id_used_verbatim_as_answer() {
        let original_args = claude_original_args();
        let answer = AnswerPayload {
            _ask_id: "ask-custom".to_string(),
            choice_id: Some("my custom freeform text".to_string()),
            choice_ids: None,
            freeform: None,
        };

        let result = AskUserQuestion::build_updated_input(&original_args, &answer);
        assert_eq!(
            result["answers"]["Which approach should we use?"].as_str(),
            Some("my custom freeform text"),
            "non-numeric choice_id must be used verbatim when it can't be parsed as option index; got: {:?}",
            result["answers"]
        );
    }

    // ─── Regression: answers map must be present even when empty ──────────────

    /// The returned updatedInput must always contain an "answers" key,
    /// even if the map is empty (e.g. cancelled answer).
    #[test]
    fn answers_key_always_present_in_updated_input() {
        let original_args = claude_original_args();
        let answer = AnswerPayload {
            _ask_id: "ask-empty".to_string(),
            choice_id: Some("__cancelled__".to_string()),
            choice_ids: None,
            freeform: None,
        };

        let result = AskUserQuestion::build_updated_input(&original_args, &answer);
        assert!(
            result.get("answers").is_some(),
            "updatedInput must always have 'answers' key; got: {result}"
        );
    }

    // ─── build_ask_payload: option ids must be numeric strings ───────────────

    /// Verifies that build_ask_payload assigns "0", "1", "2" as option ids,
    /// which must match what sendAnswer sends back as choice_id.
    ///
    /// This is the contract test between build_ask_payload and build_updated_input:
    ///   build_ask_payload   → assigns opt.id = "0", "1", ...
    ///   Mobile              → sends choice_id = opt.id (e.g. "1")
    ///   build_updated_input → receives choice_id = "1", parses as index, looks up label
    #[test]
    fn build_ask_payload_assigns_numeric_string_ids_to_options() {
        use crate::serve::interactive::InteractiveTool;

        let args = claude_original_args();
        let payload = AskUserQuestion::build_ask_payload("ask-id-test", &args);

        let options = &payload["questions"][0]["options"];
        assert_eq!(
            options[0]["id"].as_str(), Some("0"),
            "first option must have id '0'; got: {:?}", options[0]
        );
        assert_eq!(
            options[1]["id"].as_str(), Some("1"),
            "second option must have id '1'; got: {:?}", options[1]
        );
        assert_eq!(
            options[2]["id"].as_str(), Some("2"),
            "third option must have id '2'; got: {:?}", options[2]
        );
    }

    /// End-to-end contract: build_ask_payload ids round-trip correctly through build_updated_input.
    ///
    /// This is the key regression test: if Mobile picks option with id="1",
    /// the answer WS message will have choice_id="1", and build_updated_input
    /// must resolve it to the correct label "Option B".
    #[test]
    fn option_id_from_build_ask_payload_round_trips_through_build_updated_input() {
        use crate::serve::interactive::InteractiveTool;

        let original_args = claude_original_args();

        // Step 1: Server sends ask_question payload to Mobile
        let ask_payload = AskUserQuestion::build_ask_payload("ask-roundtrip", &original_args);

        // Step 2: Mobile receives options with ids "0", "1", "2"
        //         User picks option[1] (id="1", label="Option B")
        let option_id_picked_by_user = ask_payload["questions"][0]["options"][1]["id"]
            .as_str()
            .unwrap()
            .to_string();
        assert_eq!(option_id_picked_by_user, "1",
            "sanity check: option at index 1 must have id '1'");

        // Step 3: Mobile sends WS answer with choice_id = option_id_picked_by_user
        let answer = AnswerPayload {
            _ask_id: "ask-roundtrip".to_string(),
            choice_id: Some(option_id_picked_by_user),
            choice_ids: None,
            freeform: None,
        };

        // Step 4: Server calls build_updated_input and sends control_response to Claude
        let updated_input = AskUserQuestion::build_updated_input(&original_args, &answer);

        // Step 5: Claude receives updatedInput.answers["Which approach should we use?"] = "Option B"
        assert_eq!(
            updated_input["answers"]["Which approach should we use?"].as_str(),
            Some("Option B"),
            "end-to-end: option id '1' must round-trip to label 'Option B' under the question text key; \
             updatedInput = {updated_input}"
        );
    }
