//! Outreach log: calls, emails, Facebook/Instagram messages, visits, meetings, notes.

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{Postgres, QueryBuilder};
use uuid::Uuid;

use crate::{
    audit,
    auth::AuthUser,
    error::{AppError, AppResult},
    routes::{
        common::{like_pattern, non_empty, paging, Page},
        leads::{ensure_visible, push_scope},
    },
    state::AppState,
    validate::{clean, Validator},
};

pub const CHANNELS: &[&str] = &[
    "phone", "email", "facebook", "instagram", "linkedin", "whatsapp", "sms", "in_person", "online_meeting", "note", "other",
];

#[derive(Serialize, sqlx::FromRow)]
pub struct Interaction {
    id: Uuid,
    lead_id: Uuid,
    business_name: String,
    channel: String,
    direction: String,
    subject: Option<String>,
    body: Option<String>,
    outcome: Option<String>,
    occurred_at: DateTime<Utc>,
    user_id: Option<Uuid>,
    user_name: Option<String>,
}

#[derive(Deserialize, Default)]
pub struct InteractionQuery {
    lead_id: Option<Uuid>,
    user_id: Option<Uuid>,
    channel: Option<String>,
    search: Option<String>,
    from: Option<DateTime<Utc>>,
    to: Option<DateTime<Utc>>,
    page: Option<i64>,
    per_page: Option<i64>,
}

fn push_filters(qb: &mut QueryBuilder<'_, Postgres>, q: &InteractionQuery, user: &AuthUser) {
    qb.push(" where l.deleted_at is null");
    push_scope(qb, user, "l");
    if let Some(v) = q.lead_id {
        qb.push(" and i.lead_id = ").push_bind(v);
    }
    if let Some(v) = q.user_id {
        qb.push(" and i.user_id = ").push_bind(v);
    }
    if let Some(v) = non_empty(&q.channel) {
        qb.push(" and i.channel = ").push_bind(v.to_owned());
    }
    if let Some(v) = q.from {
        qb.push(" and i.occurred_at >= ").push_bind(v);
    }
    if let Some(v) = q.to {
        qb.push(" and i.occurred_at < ").push_bind(v);
    }
    if let Some(term) = non_empty(&q.search) {
        let p = like_pattern(term);
        qb.push(" and (c.name ilike ").push_bind(p.clone()).push(" or i.subject ilike ").push_bind(p.clone())
            .push(" or i.body ilike ").push_bind(p).push(")");
    }
}

const FROM: &str = " from public.lead_interactions i
    join public.leads l on l.id = i.lead_id
    join public.companies c on c.id = l.company_id
    left join public.profiles p on p.id = i.user_id";

pub async fn list(State(state): State<AppState>, user: AuthUser, Query(q): Query<InteractionQuery>) -> AppResult<Json<Page<Interaction>>> {
    user.require("sales.view")?;
    let (page, per_page, offset) = paging(q.page, q.per_page, 200);
    let mut rows = QueryBuilder::<Postgres>::new(format!(
        "select i.id, i.lead_id, c.name as business_name, i.channel, i.direction, i.subject, i.body, i.outcome,
                i.occurred_at, i.user_id, p.full_name as user_name {FROM}"
    ));
    push_filters(&mut rows, &q, &user);
    rows.push(" order by i.occurred_at desc limit ").push_bind(per_page).push(" offset ").push_bind(offset);
    let mut count = QueryBuilder::<Postgres>::new(format!("select count(*) {FROM}"));
    push_filters(&mut count, &q, &user);
    let (items, total) = tokio::try_join!(
        rows.build_query_as::<Interaction>().fetch_all(&state.db),
        count.build_query_scalar::<i64>().fetch_one(&state.db),
    )?;
    Ok(Json(Page { items, total, page, per_page }))
}

#[derive(Deserialize)]
pub struct FollowUpInput {
    pub title: String,
    pub due_at: DateTime<Utc>,
    pub priority: Option<String>,
}

#[derive(Deserialize)]
pub struct LogInteraction {
    channel: String,
    direction: Option<String>,
    subject: Option<String>,
    body: Option<String>,
    outcome: Option<String>,
    occurred_at: Option<DateTime<Utc>>,
    /// Updates the lead's next action at the same time (keeps active leads moving).
    next_action: Option<String>,
    next_action_due_at: Option<DateTime<Utc>>,
    /// Optionally schedule a follow-up in the same step.
    follow_up: Option<FollowUpInput>,
}

/// Logs a touchpoint. Real contact (not internal notes) updates "last contacted" and moves
/// leads that were still before "Contacted" in the pipeline forward to it.
pub async fn log(
    State(state): State<AppState>,
    user: AuthUser,
    Path(lead_id): Path<Uuid>,
    Json(input): Json<LogInteraction>,
) -> AppResult<Json<serde_json::Value>> {
    user.require("sales.manage")?;
    ensure_visible(&state.db, &user, lead_id).await?;

    let direction = input.direction.clone().unwrap_or_else(|| if input.channel == "note" { "internal".into() } else { "outbound".into() });
    let mut v = Validator::new();
    v.one_of("channel", &input.channel, CHANNELS);
    v.one_of("direction", &direction, &["outbound", "inbound", "internal"]);
    v.optional_text("subject", input.subject.as_deref(), 200);
    v.optional_text("body", input.body.as_deref(), 20_000);
    v.optional_text("outcome", input.outcome.as_deref(), 500);
    v.optional_text("next_action", input.next_action.as_deref(), 300);
    if let Some(f) = &input.follow_up {
        v.text("follow_up.title", &f.title, 200);
    }
    if input.subject.as_deref().unwrap_or("").trim().is_empty() && input.body.as_deref().unwrap_or("").trim().is_empty() {
        v.fail("body", "Write what happened.");
    }
    v.finish()?;

    let occurred_at = input.occurred_at.unwrap_or_else(Utc::now);
    let is_contact = direction != "internal" && input.channel != "note";

    let mut tx = state.db.begin().await?;
    let id: Uuid = sqlx::query_scalar(
        "insert into public.lead_interactions (lead_id, user_id, channel, direction, subject, body, outcome, occurred_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8) returning id",
    )
    .bind(lead_id)
    .bind(user.id)
    .bind(&input.channel)
    .bind(&direction)
    .bind(clean(input.subject.clone()))
    .bind(clean(input.body.clone()))
    .bind(clean(input.outcome.clone()))
    .bind(occurred_at)
    .fetch_one(&mut *tx)
    .await?;

    if is_contact {
        sqlx::query(
            "update public.leads l set last_contacted_at = greatest(coalesce(l.last_contacted_at, $2), $2),
               stage_id = coalesce((
                 select c.id from public.pipeline_stages c, public.pipeline_stages cur
                 where cur.id = l.stage_id and cur.kind = 'open' and c.archived_at is null
                   and lower(c.name) = 'contacted' and cur.position < c.position
               ), l.stage_id)
             where l.id = $1",
        )
        .bind(lead_id)
        .bind(occurred_at)
        .execute(&mut *tx)
        .await?;
    }
    if let Some(next) = clean(input.next_action.clone()) {
        sqlx::query("update public.leads set next_action = $2, next_action_due_at = $3 where id = $1")
            .bind(lead_id)
            .bind(next)
            .bind(input.next_action_due_at)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(f) = &input.follow_up {
        sqlx::query(
            "insert into public.follow_ups (lead_id, title, due_at, priority, assigned_to, created_by)
             values ($1, $2, $3, coalesce($4, 'medium'), $5, $5)",
        )
        .bind(lead_id)
        .bind(f.title.trim())
        .bind(f.due_at)
        .bind(&f.priority)
        .bind(user.id)
        .execute(&mut *tx)
        .await?;
    }

    let channel_label = input.channel.replace('_', " ");
    let summary = match direction.as_str() {
        "internal" => format!("{} added a note", user.full_name),
        "inbound" => format!("{} logged an incoming {channel_label}", user.full_name),
        _ => format!("{} logged outreach by {channel_label}", user.full_name),
    };
    audit::activity(&mut *tx, user.id, "lead", lead_id, "lead.interaction", &summary).await?;
    tx.commit().await?;
    Ok(Json(serde_json::json!({ "id": id })))
}

pub async fn remove(State(state): State<AppState>, user: AuthUser, Path(id): Path<Uuid>) -> AppResult<StatusCode> {
    user.require("sales.manage")?;
    let author: Option<Uuid> = sqlx::query_scalar("select user_id from public.lead_interactions where id = $1")
        .bind(id)
        .fetch_optional(&state.db)
        .await?
        .ok_or(AppError::NotFound)?;
    if author != Some(user.id) && !user.can("leads.view_all") {
        return Err(AppError::forbidden("You can only delete your own entries."));
    }
    sqlx::query("delete from public.lead_interactions where id = $1").bind(id).execute(&state.db).await?;
    Ok(StatusCode::NO_CONTENT)
}
