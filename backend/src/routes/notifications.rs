use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use chrono::{DateTime, Utc};
use serde::Serialize;
use uuid::Uuid;

use crate::{
    auth::AuthUser,
    error::{AppError, AppResult},
    state::AppState,
};

#[derive(Serialize, sqlx::FromRow)]
pub struct Notification {
    id: Uuid,
    kind: String,
    title: String,
    body: Option<String>,
    entity_type: Option<String>,
    entity_id: Option<Uuid>,
    read_at: Option<DateTime<Utc>>,
    created_at: DateTime<Utc>,
}

#[derive(Serialize)]
pub struct NotificationList {
    items: Vec<Notification>,
    unread_count: i64,
}

pub async fn list(State(state): State<AppState>, user: AuthUser) -> AppResult<Json<NotificationList>> {
    let items = sqlx::query_as::<_, Notification>(
        "select id, kind, title, body, entity_type::text as entity_type, entity_id, read_at, created_at
         from public.notifications
         where user_id = $1
         order by created_at desc
         limit 30",
    )
    .bind(user.id)
    .fetch_all(&state.db)
    .await?;

    let unread_count: i64 =
        sqlx::query_scalar("select count(*) from public.notifications where user_id = $1 and read_at is null")
            .bind(user.id)
            .fetch_one(&state.db)
            .await?;

    Ok(Json(NotificationList { items, unread_count }))
}

pub async fn mark_read(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<StatusCode> {
    let result = sqlx::query(
        "update public.notifications set read_at = coalesce(read_at, now())
         where id = $1 and user_id = $2",
    )
    .bind(id)
    .bind(user.id)
    .execute(&state.db)
    .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(StatusCode::NO_CONTENT)
}

pub async fn mark_all_read(State(state): State<AppState>, user: AuthUser) -> AppResult<StatusCode> {
    sqlx::query("update public.notifications set read_at = now() where user_id = $1 and read_at is null")
        .bind(user.id)
        .execute(&state.db)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
