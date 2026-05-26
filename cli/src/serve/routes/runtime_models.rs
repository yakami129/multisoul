use crate::serve::runtime::models::{self, ModelCapability, ModelProviderError};
use axum::{extract::Query, http::StatusCode, Json};
use serde::Deserialize;

#[derive(Deserialize)]
pub struct RuntimeModelsQuery {
    pub runtime: String,
}

pub async fn list_runtime_models(
    Query(query): Query<RuntimeModelsQuery>,
) -> Result<Json<Vec<ModelCapability>>, StatusCode> {
    models::validate_model(&query.runtime, None).map_err(model_provider_status)?;
    models::list_models(&query.runtime)
        .map(Json)
        .map_err(model_provider_status)
}

pub fn model_provider_status(error: ModelProviderError) -> StatusCode {
    match error {
        ModelProviderError::UnknownRuntime(_) => StatusCode::NOT_FOUND,
        ModelProviderError::UnsupportedModel { .. } | ModelProviderError::InvalidDefaultString => {
            StatusCode::BAD_REQUEST
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        db,
        serve::{auth::bearer_auth, state::AppState},
    };
    use axum::{
        body::Body,
        http::{Request, StatusCode},
    };
    use tempfile::tempdir;
    use tower::ServiceExt;

    async fn make_runtime_models_app(token: &str) -> axum::Router {
        let dir = tempdir().unwrap();
        let conn = db::open_at(&dir.path().join("runtime-models.db")).unwrap();
        let plugin_db = db::open_at(&dir.path().join("plugins.db")).unwrap();
        let state = AppState::new(
            conn,
            token.to_string(),
            dir.path().join("uploads"),
            crate::serve::plugin::PluginManager::empty(std::sync::Arc::new(std::sync::Mutex::new(
                plugin_db,
            ))),
        );

        axum::Router::new()
            .route(
                "/api/v1/runtime-models",
                axum::routing::get(list_runtime_models),
            )
            .layer(axum::middleware::from_fn_with_state(
                state.clone(),
                bearer_auth,
            ))
            .with_state(state)
    }

    /// GET /api/v1/runtime-models?runtime=codex returns authenticated Codex models with Default first.
    ///
    /// 数据构造（含关键数值的推导过程）：
    ///   token          = "tok"（AppState 中配置的唯一合法 Bearer token）
    ///   runtime query  = "codex"
    ///   expected index = 0（Default 虚拟项必须排在 concrete models 前）
    ///
    /// 执行过程（逐步说明系统如何处理）：
    ///   1. 构造只挂载 /api/v1/runtime-models 的测试 router
    ///   2. 带 Authorization: Bearer tok 请求 runtime=codex
    ///   3. handler 调用 provider registry 并序列化模型数组
    ///
    /// 预期结果：
    ///   - 断言 A：返回 200，说明路由在认证通过后可访问
    ///   - 断言 B：第 0 项 id 为 "default"，说明 Default 虚拟项排第一
    ///   - 断言 C：第 0 项 is_default 为 true，说明客户端可直接识别默认项
    #[tokio::test]
    async fn test_list_runtime_models_codex_default_first() {
        let app = make_runtime_models_app("tok").await;
        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/api/v1/runtime-models?runtime=codex")
                    .header("Authorization", "Bearer tok")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(
            resp.status(),
            StatusCode::OK,
            "authenticated codex runtime model request should return 200"
        );

        let bytes = axum::body::to_bytes(resp.into_body(), 4096).await.unwrap();
        let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        let first = json
            .as_array()
            .and_then(|items| items.first())
            .unwrap_or_else(|| panic!("codex response should include at least the Default item"));

        assert_eq!(
            first.get("id").and_then(|value| value.as_str()),
            Some("default"),
            "first codex runtime model should be the virtual default id"
        );
        assert_eq!(
            first.get("is_default").and_then(|value| value.as_bool()),
            Some(true),
            "first codex runtime model should be marked as default"
        );
    }

    /// GET /api/v1/runtime-models returns 404 for unknown runtimes.
    ///
    /// 数据构造（含关键数值的推导过程）：
    ///   token         = "tok"（AppState 中配置的唯一合法 Bearer token）
    ///   runtime query = "unknown-runtime"（不在 3 个 supported runtimes 中）
    ///   supported     = 3（claude-code / codex / cursor-cli）
    ///
    /// 执行过程（逐步说明系统如何处理）：
    ///   1. 构造测试 router
    ///   2. 带 Authorization: Bearer tok 请求 unknown-runtime
    ///   3. provider registry 返回 UnknownRuntime
    ///   4. route error mapper 将 UnknownRuntime 映射为 404
    ///
    /// 预期结果：
    ///   - 断言 A：返回 404，说明未知 runtime 不会伪装为空模型列表
    ///   - 断言 B：不返回 200，说明客户端能明确区分未支持 runtime
    #[tokio::test]
    async fn test_list_runtime_models_unknown_runtime_returns_404() {
        let app = make_runtime_models_app("tok").await;
        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/api/v1/runtime-models?runtime=unknown-runtime")
                    .header("Authorization", "Bearer tok")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(
            resp.status(),
            StatusCode::NOT_FOUND,
            "unknown runtime model request should return 404"
        );
        assert_ne!(
            resp.status(),
            StatusCode::OK,
            "unknown runtime must not return 200 with an empty or fallback model list"
        );
    }
}
