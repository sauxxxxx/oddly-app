//! Named lead lists / campaigns ("Barili Restaurants", "US Real Estate Agencies"),
//! each with its own assignees and progress.

use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use uuid::Uuid;

use crate::{
    audit::{self, AuditEntry},
    auth::AuthUser,
    error::{AppError, AppResult},
    state::AppState,
    validate::{clean, Validator},
};

#[derive(Serialize, sqlx::FromRow)]
pub struct LeadList {
    id: Uuid,
    name: String,
    description: Option<String>,
    market: Option<String>,
    color: String,
    owner_id: Option<Uuid>,
    owner_name: Option<String>,
    total: i64,
    contacted: i64,
    interested: i64,
    won: i64,
    assignees: serde_json::Value,
    created_at: DateTime<Utc>,
    archived_at: Option<DateTime<Utc>>,
}

const LIST_SELECT: &str = r#"
    select ll.id, ll.name, ll.description, ll.market, ll.color, ll.owner_id, o.full_name as owner_name,
      count(l.id) as total,
      count(l.id) filter (where l.last_contacted_at is not null) as contacted,
      count(l.id) filter (where s.position >= (select position from public.pipeline_stages where name = 'Interested' limit 1)
                            and s.kind = 'open') as interested,
      count(l.id) filter (where s.kind = 'won' or l.status = 'converted') as won,
      coalesce((select json_agg(json_build_object('id', p.id, 'name', p.full_name) order by p.full_name)
                from public.lead_list_assignees a join public.profiles p on p.id = a.user_id
                where a.list_id = ll.id), '[]'::json)::jsonb as assignees,
      ll.created_at, ll.archived_at
    from public.lead_lists ll
    left join public.profiles o on o.id = ll.owner_id
    left join public.lead_list_members m on m.list_id = ll.id
    left join public.leads l on l.id = m.lead_id and l.deleted_at is null
    left join public.pipeline_stages s on s.id = l.stage_id
    where ll.deleted_at is null
"#;

/// Lists visible to the user: all with leads.view_all, otherwise ones they own or are assigned to.
pub async fn list(State(state): State<AppState>, user: AuthUser) -> AppResult<Json<Vec<LeadList>>> {
    user.require("leads.view")?;
    let lists = sqlx::query_as::<_, LeadList>(&format!(
        "{LIST_SELECT}
           and ($1 or ll.owner_id = $2 or exists (select 1 from public.lead_list_assignees a where a.list_id = ll.id and a.user_id = $2))
         group by ll.id, o.full_name
         order by ll.archived_at nulls first, lower(ll.name)"
    ))
    .bind(user.can("leads.view_all"))
    .bind(user.id)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(lists))
}

async fn fetch(state: &AppState, user: &AuthUser, id: Uuid) -> AppResult<LeadList> {
    sqlx::query_as::<_, LeadList>(&format!(
        "{LIST_SELECT}
           and ll.id = $3
           and ($1 or ll.owner_id = $2 or exists (select 1 from public.lead_list_assignees a where a.list_id = ll.id and a.user_id = $2))
         group by ll.id, o.full_name"
    ))
    .bind(user.can("leads.view_all"))
    .bind(user.id)
    .bind(id)
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::NotFound)
}

pub async fn get(State(state): State<AppState>, user: AuthUser, Path(id): Path<Uuid>) -> AppResult<Json<LeadList>> {
    user.require("leads.view")?;
    Ok(Json(fetch(&state, &user, id).await?))
}

#[derive(Deserialize)]
pub struct ListInput {
    name: String,
    description: Option<String>,
    market: Option<String>,
    color: Option<String>,
    #[serde(default)]
    assignee_ids: Vec<Uuid>,
    archived: Option<bool>,
}

fn validate(input: &ListInput) -> AppResult<()> {
    let mut v = Validator::new();
    v.text("name", &input.name, 80);
    v.optional_text("description", input.description.as_deref(), 1000);
    if let Some(m) = input.market.as_deref().filter(|m| !m.is_empty()) {
        v.one_of("market", m, super::MARKETS);
    }
    if let Some(c) = &input.color {
        if !(c.len() == 7 && c.starts_with('#') && c[1..].chars().all(|ch| ch.is_ascii_hexdigit())) {
            v.fail("color", "Use a hex color like #A855F7.");
        }
    }
    v.finish()
}

async fn set_assignees(tx: &mut sqlx::Transaction<'_, sqlx::Postgres>, list_id: Uuid, ids: &[Uuid]) -> AppResult<()> {
    sqlx::query("delete from public.lead_list_assignees where list_id = $1")
        .bind(list_id)
        .execute(&mut **tx)
        .await?;
    sqlx::query(
        "insert into public.lead_list_assignees (list_id, user_id) select $1, unnest($2::uuid[]) on conflict do nothing",
    )
    .bind(list_id)
    .bind(ids)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

pub async fn create(State(state): State<AppState>, user: AuthUser, Json(input): Json<ListInput>) -> AppResult<Json<LeadList>> {
    user.require("leads.create")?;
    validate(&input)?;
    let mut tx = state.db.begin().await?;
    let id: Uuid = sqlx::query_scalar(
        "insert into public.lead_lists (name, description, market, color, owner_id, created_by)
         values ($1, $2, $3, coalesce($4, '#A855F7'), $5, $5) returning id",
    )
    .bind(input.name.trim())
    .bind(clean(input.description.clone()))
    .bind(clean(input.market.clone()))
    .bind(&input.color)
    .bind(user.id)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| match AppError::from(e) {
        AppError::Conflict(_) => AppError::Conflict("A lead list with this name already exists.".into()),
        other => other,
    })?;
    set_assignees(&mut tx, id, &input.assignee_ids).await?;
    tx.commit().await?;
    Ok(Json(fetch(&state, &user, id).await?))
}

pub async fn update(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Json(input): Json<ListInput>,
) -> AppResult<Json<LeadList>> {
    user.require("leads.edit")?;
    validate(&input)?;
    fetch(&state, &user, id).await?;
    let mut tx = state.db.begin().await?;
    sqlx::query(
        "update public.lead_lists set name = $2, description = $3, market = $4, color = coalesce($5, color),
           archived_at = case when $6 then coalesce(archived_at, now()) when not $6 then null else archived_at end
         where id = $1",
    )
    .bind(id)
    .bind(input.name.trim())
    .bind(clean(input.description.clone()))
    .bind(clean(input.market.clone()))
    .bind(&input.color)
    .bind(input.archived)
    .execute(&mut *tx)
    .await
    .map_err(|e| match AppError::from(e) {
        AppError::Conflict(_) => AppError::Conflict("A lead list with this name already exists.".into()),
        other => other,
    })?;
    set_assignees(&mut tx, id, &input.assignee_ids).await?;
    tx.commit().await?;
    Ok(Json(fetch(&state, &user, id).await?))
}

/// Deletes the list only; its leads stay in the workspace.
pub async fn remove(State(state): State<AppState>, user: AuthUser, Path(id): Path<Uuid>) -> AppResult<StatusCode> {
    user.require("leads.delete")?;
    fetch(&state, &user, id).await?;
    sqlx::query("update public.lead_lists set deleted_at = now() where id = $1")
        .bind(id)
        .execute(&state.db)
        .await?;
    audit::record(
        &state.db,
        AuditEntry { actor_id: Some(user.id), action: "lead_list.deleted", entity_type: Some("lead_list"), entity_id: Some(id), changes: json!({}) },
    )
    .await?;
    Ok(StatusCode::NO_CONTENT)
}
