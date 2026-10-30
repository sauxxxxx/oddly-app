use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    auth::AuthUser,
    error::{AppError, AppResult},
    state::AppState,
    validate::Validator,
};

const MODULES: &[&str] = &["leads", "clients", "tasks", "content"];

#[derive(Serialize, sqlx::FromRow)]
pub struct SavedFilter {
    id: Uuid,
    name: String,
    filters: serde_json::Value,
    is_shared: bool,
    mine: bool,
}

#[derive(Deserialize)]
pub struct ModuleQuery {
    module: String,
}

/// The user's own filters plus filters teammates shared.
pub async fn list(
    State(state): State<AppState>,
    user: AuthUser,
    Query(q): Query<ModuleQuery>,
) -> AppResult<Json<Vec<SavedFilter>>> {
    let filters = sqlx::query_as::<_, SavedFilter>(
        "select id, name, filters, is_shared, user_id = $2 as mine from public.saved_filters
         where module = $1 and (user_id = $2 or is_shared) order by lower(name)",
    )
    .bind(&q.module)
    .bind(user.id)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(filters))
}

#[derive(Deserialize)]
pub struct CreateFilter {
    module: String,
    name: String,
    filters: serde_json::Value,
    #[serde(default)]
    is_shared: bool,
}

pub async fn create(State(state): State<AppState>, user: AuthUser, Json(input): Json<CreateFilter>) -> AppResult<Json<SavedFilter>> {
    let mut v = Validator::new();
    v.text("name", &input.name, 80);
    v.one_of("module", &input.module, MODULES);
    if !input.filters.is_object() || input.filters.to_string().len() > 4000 {
        v.fail("filters", "Invalid filter.");
    }
    v.finish()?;
    let saved = sqlx::query_as::<_, SavedFilter>(
        "insert into public.saved_filters (user_id, module, name, filters, is_shared) values ($1, $2, $3, $4, $5)
         returning id, name, filters, is_shared, true as mine",
    )
    .bind(user.id)
    .bind(&input.module)
    .bind(input.name.trim())
    .bind(&input.filters)
    .bind(input.is_shared)
    .fetch_one(&state.db)
    .await?;
    Ok(Json(saved))
}

pub async fn remove(State(state): State<AppState>, user: AuthUser, Path(id): Path<Uuid>) -> AppResult<StatusCode> {
    let deleted = sqlx::query("delete from public.saved_filters where id = $1 and user_id = $2")
        .bind(id)
        .bind(user.id)
        .execute(&state.db)
        .await?;
    if deleted.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(StatusCode::NO_CONTENT)
}
