//! Kanban pipeline: leads grouped by stage, moving leads, and admin stage customization.

use std::collections::BTreeMap;

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::{Postgres, QueryBuilder};
use uuid::Uuid;

use crate::{
    audit::{self, AuditEntry},
    auth::AuthUser,
    error::{AppError, AppResult},
    routes::{
        common::{like_pattern, non_empty},
        leads::{ensure_visible, fetch_lead, push_scope, LeadRow},
    },
    state::AppState,
    validate::Validator,
};

const CARDS_PER_STAGE: i64 = 100;

#[derive(Deserialize, Default)]
pub struct BoardQuery {
    search: Option<String>,
    market: Option<String>,
    assigned: Option<String>,
}

#[derive(Serialize, sqlx::FromRow)]
pub struct Card {
    id: Uuid,
    stage_id: Uuid,
    business_name: String,
    city: Option<String>,
    market: String,
    contact_name: Option<String>,
    status: String,
    priority: String,
    assigned_to: Option<Uuid>,
    assigned_name: Option<String>,
    estimated_value: Option<Decimal>,
    currency: String,
    next_action: Option<String>,
    next_action_due_at: Option<DateTime<Utc>>,
    last_contacted_at: Option<DateTime<Utc>>,
}

#[derive(sqlx::FromRow)]
struct StageTotal {
    stage_id: Uuid,
    currency: String,
    count: i64,
    value: Option<Decimal>,
}

#[derive(Serialize, sqlx::FromRow)]
pub struct StageRow {
    id: Uuid,
    name: String,
    kind: String,
    color: String,
    position: i32,
}

#[derive(Serialize)]
pub struct Column {
    #[serde(flatten)]
    stage: StageRow,
    count: i64,
    /// Estimated pipeline value per currency (never summed across currencies).
    totals: BTreeMap<String, Decimal>,
    cards: Vec<Card>,
}

fn push_board_filters(qb: &mut QueryBuilder<'_, Postgres>, q: &BoardQuery, user: &AuthUser) {
    qb.push(" where lo.deleted_at is null and lo.status <> 'archived'");
    push_scope(qb, user, "lo");
    if let Some(term) = non_empty(&q.search) {
        let p = like_pattern(term);
        qb.push(" and (lo.business_name ilike ").push_bind(p.clone()).push(" or lo.contact_name ilike ").push_bind(p).push(")");
    }
    if let Some(m) = non_empty(&q.market) {
        qb.push(" and lo.market = ").push_bind(m.to_owned());
    }
    match non_empty(&q.assigned) {
        Some("me") => {
            qb.push(" and lo.assigned_to = ").push_bind(user.id);
        }
        Some(id) => {
            if let Ok(id) = id.parse::<Uuid>() {
                qb.push(" and lo.assigned_to = ").push_bind(id);
            }
        }
        None => {}
    }
}

pub async fn board(State(state): State<AppState>, user: AuthUser, Query(q): Query<BoardQuery>) -> AppResult<Json<Vec<Column>>> {
    user.require("sales.view")?;
    let db = &state.db;

    let mut cards_q = QueryBuilder::<Postgres>::new(
        "select * from (select lo.id, lo.stage_id, lo.business_name, lo.city, lo.market, lo.contact_name, lo.status,
           lo.priority, lo.assigned_to, lo.assigned_name, lo.estimated_value, lo.currency, lo.next_action,
           lo.next_action_due_at, lo.last_contacted_at,
           row_number() over (partition by lo.stage_id
             order by array_position(array['urgent','high','medium','low'], lo.priority), lo.updated_at desc) as rn
         from public.lead_overview lo",
    );
    push_board_filters(&mut cards_q, &q, &user);
    cards_q.push(") x where x.rn <= ").push_bind(CARDS_PER_STAGE).push(" order by x.rn");

    let mut totals_q = QueryBuilder::<Postgres>::new(
        "select lo.stage_id, lo.currency, count(*) as count, sum(lo.estimated_value) as value from public.lead_overview lo",
    );
    push_board_filters(&mut totals_q, &q, &user);
    totals_q.push(" group by lo.stage_id, lo.currency");

    let (stages, cards, totals) = tokio::try_join!(
        sqlx::query_as::<_, StageRow>(
            "select id, name, kind, color, position from public.pipeline_stages where archived_at is null order by position",
        )
        .fetch_all(db),
        cards_q.build_query_as::<Card>().fetch_all(db),
        totals_q.build_query_as::<StageTotal>().fetch_all(db),
    )?;

    let mut columns: Vec<Column> = stages
        .into_iter()
        .map(|stage| Column { stage, count: 0, totals: BTreeMap::new(), cards: Vec::new() })
        .collect();
    for t in totals {
        if let Some(c) = columns.iter_mut().find(|c| c.stage.id == t.stage_id) {
            c.count += t.count;
            if let Some(v) = t.value {
                *c.totals.entry(t.currency).or_default() += v;
            }
        }
    }
    for card in cards {
        if let Some(c) = columns.iter_mut().find(|c| c.stage.id == card.stage_id) {
            c.cards.push(card);
        }
    }
    Ok(Json(columns))
}

#[derive(Deserialize)]
pub struct MoveLead {
    stage_id: Uuid,
}

/// Moves a lead to another stage (drag and drop on the board).
pub async fn move_lead(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Json(body): Json<MoveLead>,
) -> AppResult<Json<LeadRow>> {
    user.require("leads.edit")?;
    ensure_visible(&state.db, &user, id).await?;
    let mut tx = state.db.begin().await?;
    let (stage_name, kind): (String, String) =
        sqlx::query_as("select name, kind from public.pipeline_stages where id = $1 and archived_at is null")
            .bind(body.stage_id)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or(AppError::NotFound)?;
    let name: String = sqlx::query_scalar(
        "update public.leads l set stage_id = $2,
           status = case when $3 = 'lost' and l.status = 'active' then 'disqualified'
                         when $3 = 'open' and l.status = 'disqualified' then 'active'
                         else l.status end,
           next_action = case when $3 = 'open' and l.next_action is null then 'Decide the next step' else l.next_action end
         from public.companies c where l.id = $1 and c.id = l.company_id returning c.name",
    )
    .bind(id)
    .bind(body.stage_id)
    .bind(&kind)
    .fetch_one(&mut *tx)
    .await?;
    audit::activity(&mut *tx, user.id, "lead", id, "lead.stage_changed", &format!("{} moved {name} to {stage_name}", user.full_name)).await?;
    tx.commit().await?;
    Ok(Json(fetch_lead(&state.db, id).await?))
}

// ---------------------------------------------------------------------------
// Stage customization (pipeline.manage)
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct StageInput {
    name: String,
    kind: Option<String>,
    color: Option<String>,
}

fn validate_stage(input: &StageInput) -> AppResult<()> {
    let mut v = Validator::new();
    v.text("name", &input.name, 40);
    if let Some(k) = &input.kind {
        v.one_of("kind", k, &["open", "won", "lost"]);
    }
    if let Some(c) = &input.color {
        if !(c.len() == 7 && c.starts_with('#') && c[1..].chars().all(|ch| ch.is_ascii_hexdigit())) {
            v.fail("color", "Use a hex color like #A855F7.");
        }
    }
    v.finish()
}

pub async fn create_stage(State(state): State<AppState>, user: AuthUser, Json(input): Json<StageInput>) -> AppResult<Json<StageRow>> {
    user.require("pipeline.manage")?;
    validate_stage(&input)?;
    let stage = sqlx::query_as::<_, StageRow>(
        "insert into public.pipeline_stages (name, kind, color, position)
         values ($1, coalesce($2, 'open'), coalesce($3, '#A855F7'),
                 (select coalesce(max(position), 0) + 10 from public.pipeline_stages))
         returning id, name, kind, color, position",
    )
    .bind(input.name.trim())
    .bind(&input.kind)
    .bind(&input.color)
    .fetch_one(&state.db)
    .await?;
    audit_stage(&state, &user, "pipeline.stage_created", stage.id, json!({ "name": stage.name })).await?;
    Ok(Json(stage))
}

pub async fn update_stage(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Json(input): Json<StageInput>,
) -> AppResult<Json<StageRow>> {
    user.require("pipeline.manage")?;
    validate_stage(&input)?;
    let stage = sqlx::query_as::<_, StageRow>(
        "update public.pipeline_stages set name = $2, kind = coalesce($3, kind), color = coalesce($4, color)
         where id = $1 and archived_at is null returning id, name, kind, color, position",
    )
    .bind(id)
    .bind(input.name.trim())
    .bind(&input.kind)
    .bind(&input.color)
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::NotFound)?;
    audit_stage(&state, &user, "pipeline.stage_updated", id, json!({ "name": stage.name })).await?;
    Ok(Json(stage))
}

#[derive(Deserialize)]
pub struct Reorder {
    ids: Vec<Uuid>,
}

pub async fn reorder_stages(State(state): State<AppState>, user: AuthUser, Json(body): Json<Reorder>) -> AppResult<StatusCode> {
    user.require("pipeline.manage")?;
    sqlx::query(
        "update public.pipeline_stages s set position = t.ord * 10
         from unnest($1::uuid[]) with ordinality as t(id, ord) where s.id = t.id",
    )
    .bind(&body.ids)
    .execute(&state.db)
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
pub struct RemoveStage {
    move_to: Uuid,
}

/// Archives a stage after moving its leads to another stage.
pub async fn remove_stage(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Query(q): Query<RemoveStage>,
) -> AppResult<StatusCode> {
    user.require("pipeline.manage")?;
    if q.move_to == id {
        return Err(AppError::BadRequest("Choose a different stage to move its leads to.".into()));
    }
    let mut tx = state.db.begin().await?;
    let remaining: i64 = sqlx::query_scalar("select count(*) from public.pipeline_stages where archived_at is null and id <> $1")
        .bind(id)
        .fetch_one(&mut *tx)
        .await?;
    if remaining == 0 {
        return Err(AppError::BadRequest("The pipeline needs at least one stage.".into()));
    }
    sqlx::query("update public.leads set stage_id = $2 where stage_id = $1")
        .bind(id)
        .bind(q.move_to)
        .execute(&mut *tx)
        .await?;
    sqlx::query("update public.pipeline_stages set archived_at = now(), is_default = false where id = $1")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    // Keep a default stage for new leads.
    sqlx::query(
        "update public.pipeline_stages set is_default = true
         where id = (select id from public.pipeline_stages where archived_at is null order by position limit 1)
           and not exists (select 1 from public.pipeline_stages where archived_at is null and is_default)",
    )
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    audit_stage(&state, &user, "pipeline.stage_removed", id, json!({ "moved_to": q.move_to })).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn audit_stage(state: &AppState, user: &AuthUser, action: &str, id: Uuid, changes: serde_json::Value) -> AppResult<()> {
    audit::record(&state.db, AuditEntry { actor_id: Some(user.id), action, entity_type: Some("pipeline_stage"), entity_id: Some(id), changes })
        .await?;
    Ok(())
}
