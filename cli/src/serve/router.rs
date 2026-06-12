use crate::serve::{auth, routes, state::AppState};
use axum::{middleware, Router};
use tower_http::cors::CorsLayer;

pub async fn build_router(state: AppState) -> Router {
    use routes::*;

    let public_router = Router::new()
        .route("/api/v1/healthz", axum::routing::get(healthz::healthz))
        .route(
            "/webhook/feishu",
            axum::routing::post(webhook::feishu_webhook),
        )
        .route(
            "/webhook/gitlab",
            axum::routing::post(webhook::gitlab_webhook),
        );

    let authed_router = Router::new()
        .route(
            "/api/v1/activity",
            axum::routing::get(activity::get_activity),
        )
        .route(
            "/api/v1/activity/done/read-all",
            axum::routing::post(activity::mark_all_done_read),
        )
        .route(
            "/api/v1/activity/done/:conversation_id/read",
            axum::routing::post(activity::mark_done_read),
        )
        .route(
            "/ws/activity",
            axum::routing::get(activity_events::activity_ws_handler),
        )
        .route("/api/v1/agents", axum::routing::get(agents::list_agents))
        .route(
            "/api/v1/ask-question",
            axum::routing::post(ask_question::post_ask_question),
        )
        .route(
            "/api/v1/runtime-models",
            axum::routing::get(runtime_models::list_runtime_models),
        )
        .route(
            "/api/v1/workflows",
            axum::routing::get(workflows::list_workflows).post(workflows::create_workflow),
        )
        .route(
            "/api/v1/workflows/:id",
            axum::routing::patch(workflows::update_workflow).delete(workflows::delete_workflow),
        )
        .route(
            "/api/v1/workflows/:id/disable",
            axum::routing::post(workflows::disable_workflow),
        )
        .route(
            "/api/v1/workflows/:id/enable",
            axum::routing::post(workflows::enable_workflow),
        )
        .route(
            "/api/v1/workflows/:id/runs",
            axum::routing::get(workflows::list_workflow_runs),
        )
        .route(
            "/api/v1/workflows/:id/stop-watch",
            axum::routing::post(workflows::stop_watch),
        )
        .route(
            "/api/v1/workflows/:id/restart-watch",
            axum::routing::post(workflows::restart_watch),
        )
        .route("/ws/logs", axum::routing::get(logs::logs_ws_handler))
        .route("/api/v1/agents/:id", axum::routing::get(agents::get_agent))
        .route(
            "/api/v1/agents/:id/conversations",
            axum::routing::get(conversations::list_conversations)
                .post(conversations::create_conversation),
        )
        .route(
            "/api/v1/agents/:id/specs/dispatch",
            axum::routing::post(specs::dispatch_spec),
        )
        .route(
            "/api/v1/spec-ideas",
            axum::routing::get(spec_ideas::list).post(spec_ideas::create),
        )
        .route(
            "/api/v1/spec-ideas/:id",
            axum::routing::patch(spec_ideas::patch).delete(spec_ideas::delete),
        )
        .route(
            "/api/v1/spec-ideas/:id/interview",
            axum::routing::post(spec_ideas::start_interview),
        )
        .route("/api/v1/specs", axum::routing::get(specs::list_specs))
        .route(
            "/api/v1/specs/save-from-path",
            axum::routing::post(specs::save_from_path),
        )
        .route(
            "/api/v1/specs/:id",
            axum::routing::get(specs::get_spec).delete(specs::delete_spec),
        )
        .route(
            "/api/v1/specs/:id/done",
            axum::routing::post(specs::mark_spec_done),
        )
        .route(
            "/api/v1/specs/:id/implement",
            axum::routing::post(spec_implement::start_implementation),
        )
        .route(
            "/api/v1/conversations/:id",
            axum::routing::delete(conversations::delete_conversation),
        )
        .route(
            "/api/v1/conversations/:id/model",
            axum::routing::patch(conversations::patch_conversation_model),
        )
        .route(
            "/api/v1/conversations/:id/abort",
            axum::routing::post(conversations::abort_conversation),
        )
        .route(
            "/api/v1/conversations/:id/messages",
            axum::routing::get(messages::list_messages).post(messages::post_message),
        )
        .route(
            "/api/v1/conversations/:id/transcript-turns",
            axum::routing::get(transcript::list_transcript_turns),
        )
        .route(
            "/api/v1/conversations/:id/turns/:turn_id/hidden-messages",
            axum::routing::get(transcript::list_hidden_messages),
        )
        .route(
            "/api/v1/push-tokens",
            axum::routing::post(push_tokens::register_token),
        )
        .route(
            "/api/v1/push-tokens/:id",
            axum::routing::delete(push_tokens::delete_token),
        )
        .route("/ws/conversations/:id", axum::routing::get(ws::ws_handler))
        .route(
            "/api/v1/uploads",
            axum::routing::post(uploads::upload_image),
        )
        .route(
            "/api/v1/uploads/:file_id",
            axum::routing::get(uploads::get_uploaded_image),
        )
        .route("/api/v1/files", axum::routing::get(files::get_file))
        .route(
            "/api/v1/telemetry",
            axum::routing::post(telemetry::post_telemetry),
        )
        .layer(middleware::from_fn_with_state(
            state.clone(),
            auth::bearer_auth,
        ));

    Router::new()
        .merge(public_router)
        .merge(authed_router)
        .layer(middleware::from_fn(super::http_trace::trace_request))
        .layer(CorsLayer::permissive())
        .with_state(state)
}
