//! Reference data every form needs (stages, sources, team, lists, services) in one call.

use axum::{extract::State, Json};
use serde::Serialize;
use uuid::Uuid;

use crate::{auth::AuthUser, error::AppResult, state::AppState};

#[derive(Serialize, sqlx::FromRow)]
pub struct Stage {
    id: Uuid,
    name: String,
    kind: String,
    color: String,
    position: i32,
}

#[derive(Serialize, sqlx::FromRow)]
pub struct NamedOption {
    id: Uuid,
    name: String,
}

#[derive(Serialize, sqlx::FromRow)]
pub struct ContentStage {
    id: Uuid,
    key: String,
    name: String,
    color: String,
    position: i32,
}

#[derive(Serialize)]
pub struct Lookups {
    pipeline_stages: Vec<Stage>,
    lead_sources: Vec<NamedOption>,
    members: Vec<NamedOption>,
    lead_lists: Vec<NamedOption>,
    services: Vec<NamedOption>,
    content_stages: Vec<ContentStage>,
    clients: Vec<NamedOption>,
}

pub async fn lookups(State(state): State<AppState>, _user: AuthUser) -> AppResult<Json<Lookups>> {
    let db = &state.db;
    let (pipeline_stages, lead_sources, members, lead_lists, services, content_stages, clients) = tokio::try_join!(
        sqlx::query_as::<_, Stage>(
            "select id, name, kind, color, position from public.pipeline_stages
             where archived_at is null order by position",
        )
        .fetch_all(db),
        sqlx::query_as::<_, NamedOption>(
            "select id, name from public.lead_sources where is_active order by sort_order, name",
        )
        .fetch_all(db),
        sqlx::query_as::<_, NamedOption>(
            "select id, full_name as name from public.profiles where status = 'active' order by lower(full_name)",
        )
        .fetch_all(db),
        sqlx::query_as::<_, NamedOption>(
            "select id, name from public.lead_lists
             where deleted_at is null and archived_at is null order by lower(name)",
        )
        .fetch_all(db),
        sqlx::query_as::<_, NamedOption>(
            "select id, name from public.services where is_active order by lower(name)",
        )
        .fetch_all(db),
        sqlx::query_as::<_, ContentStage>(
            "select id, key, name, color, position from public.content_workflow_stages
             where archived_at is null order by position",
        )
        .fetch_all(db),
        sqlx::query_as::<_, NamedOption>(
            "select cl.id, co.name from public.clients cl
             join public.companies co on co.id = cl.company_id
             where cl.deleted_at is null order by lower(co.name)",
        )
        .fetch_all(db),
    )?;

    Ok(Json(Lookups { pipeline_stages, lead_sources, members, lead_lists, services, content_stages, clients }))
}
