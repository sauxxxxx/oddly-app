use axum::{extract::State, Json};
use serde_json::{json, Value};

use crate::{error::AppResult, state::AppState};

/// Liveness + database connectivity. Public, returns no business data.
pub async fn health(State(state): State<AppState>) -> AppResult<Json<Value>> {
    sqlx::query("select 1").execute(&state.db).await?;
    Ok(Json(json!({ "status": "ok", "database": "ok", "version": env!("CARGO_PKG_VERSION") })))
}
