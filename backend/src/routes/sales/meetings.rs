//! Meetings with prospects and clients: schedule, participants, notes, outcome, next action.

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
    routes::leads::ensure_visible,
    state::AppState,
    validate::{clean, Validator},
};

#[derive(Serialize, sqlx::FromRow)]
pub struct Meeting {
    id: Uuid,
    title: String,
    starts_at: DateTime<Utc>,
    ends_at: Option<DateTime<Utc>>,
    location: Option<String>,
    meeting_url: Option<String>,
    status: String,
    notes: Option<String>,
    outcome: Option<String>,
    next_action: Option<String>,
    lead_id: Option<Uuid>,
    client_id: Option<Uuid>,
    deal_id: Option<Uuid>,
    related_name: Option<String>,
    organizer_id: Option<Uuid>,
    organizer_name: Option<String>,
    participants: serde_json::Value,
}

const SELECT: &str = "select m.id, m.title, m.starts_at, m.ends_at, m.location, m.meeting_url, m.status, m.notes,
    m.outcome, m.next_action, m.lead_id, m.client_id, m.deal_id, coalesce(lc.name, cc.name) as related_name,
    m.organizer_id, o.full_name as organizer_name,
    coalesce((select jsonb_agg(jsonb_build_object('user_id', mp.user_id, 'name', coalesce(p.full_name, ct.full_name, mp.name),
                'email', coalesce(mp.email, ct.email)))
              from public.meeting_participants mp
              left join public.profiles p on p.id = mp.user_id
              left join public.contacts ct on ct.id = mp.contact_id
              where mp.meeting_id = m.id), '[]'::jsonb) as participants
  from public.meetings m
  left join public.leads l on l.id = m.lead_id
  left join public.companies lc on lc.id = l.company_id
  left join public.clients cl on cl.id = m.client_id
  left join public.companies cc on cc.id = cl.company_id
  left join public.profiles o on o.id = m.organizer_id";

#[derive(Deserialize, Default)]
pub struct MeetingQuery {
    from: Option<DateTime<Utc>>,
    to: Option<DateTime<Utc>>,
    lead_id: Option<Uuid>,
    client_id: Option<Uuid>,
    /// mine (default) or team
    scope: Option<String>,
}

fn push_visibility(qb: &mut QueryBuilder<'_, Postgres>, user: &AuthUser) {
    qb.push(" and (m.organizer_id = ").push_bind(user.id)
        .push(" or exists (select 1 from public.meeting_participants mp where mp.meeting_id = m.id and mp.user_id = ")
        .push_bind(user.id)
        .push("))");
}

pub async fn list(State(state): State<AppState>, user: AuthUser, Query(q): Query<MeetingQuery>) -> AppResult<Json<Vec<Meeting>>> {
    user.require("sales.view")?;
    let mut qb = QueryBuilder::<Postgres>::new(format!("{SELECT} where m.deleted_at is null"));
    let for_record = q.lead_id.is_some() || q.client_id.is_some();
    if !(user.can("leads.view_all") && (q.scope.as_deref() == Some("team") || for_record)) && !for_record {
        push_visibility(&mut qb, &user);
    }
    if let Some(v) = q.lead_id {
        ensure_visible(&state.db, &user, v).await?;
        qb.push(" and m.lead_id = ").push_bind(v);
    }
    if let Some(v) = q.client_id {
        qb.push(" and m.client_id = ").push_bind(v);
    }
    if let Some(v) = q.from {
        qb.push(" and m.starts_at >= ").push_bind(v);
    }
    if let Some(v) = q.to {
        qb.push(" and m.starts_at < ").push_bind(v);
    }
    qb.push(" order by m.starts_at limit 500");
    Ok(Json(qb.build_query_as::<Meeting>().fetch_all(&state.db).await?))
}

async fn fetch(state: &AppState, id: Uuid) -> AppResult<Meeting> {
    Ok(sqlx::query_as::<_, Meeting>(&format!("{SELECT} where m.id = $1 and m.deleted_at is null"))
        .bind(id)
        .fetch_one(&state.db)
        .await?)
}

#[derive(Deserialize)]
pub struct External {
    name: String,
    email: Option<String>,
}

#[derive(Deserialize)]
pub struct MeetingInput {
    title: String,
    starts_at: DateTime<Utc>,
    ends_at: Option<DateTime<Utc>>,
    location: Option<String>,
    meeting_url: Option<String>,
    lead_id: Option<Uuid>,
    client_id: Option<Uuid>,
    deal_id: Option<Uuid>,
    notes: Option<String>,
    outcome: Option<String>,
    next_action: Option<String>,
    status: Option<String>,
    #[serde(default)]
    participant_ids: Vec<Uuid>,
    #[serde(default)]
    external: Vec<External>,
}

fn validate(i: &MeetingInput) -> AppResult<()> {
    let mut v = Validator::new();
    v.text("title", &i.title, 200);
    v.optional_text("location", i.location.as_deref(), 300);
    v.optional_text("meeting_url", i.meeting_url.as_deref(), 1000);
    v.optional_text("notes", i.notes.as_deref(), 20_000);
    v.optional_text("outcome", i.outcome.as_deref(), 2000);
    v.optional_text("next_action", i.next_action.as_deref(), 300);
    if let Some(s) = &i.status {
        v.one_of("status", s, &["scheduled", "completed", "cancelled", "no_show"]);
    }
    if i.ends_at.is_some_and(|e| e < i.starts_at) {
        v.fail("ends_at", "The meeting can't end before it starts.");
    }
    for e in &i.external {
        if e.name.trim().is_empty() {
            v.fail("external", "Every external participant needs a name.");
        }
    }
    v.finish()
}

async fn set_participants(tx: &mut sqlx::Transaction<'_, Postgres>, id: Uuid, input: &MeetingInput) -> AppResult<()> {
    sqlx::query("delete from public.meeting_participants where meeting_id = $1").bind(id).execute(&mut **tx).await?;
    sqlx::query("insert into public.meeting_participants (meeting_id, user_id) select $1, unnest($2::uuid[])")
        .bind(id)
        .bind(&input.participant_ids)
        .execute(&mut **tx)
        .await?;
    let names: Vec<String> = input.external.iter().map(|e| e.name.trim().to_owned()).collect();
    let emails: Vec<Option<String>> = input.external.iter().map(|e| clean(e.email.clone())).collect();
    sqlx::query("insert into public.meeting_participants (meeting_id, name, email) select $1, n, e from unnest($2::text[], $3::text[]) as t(n, e)")
        .bind(id)
        .bind(&names)
        .bind(&emails)
        .execute(&mut **tx)
        .await?;
    Ok(())
}

pub async fn create(State(state): State<AppState>, user: AuthUser, Json(input): Json<MeetingInput>) -> AppResult<Json<Meeting>> {
    user.require("sales.manage")?;
    validate(&input)?;
    if let Some(lead) = input.lead_id {
        ensure_visible(&state.db, &user, lead).await?;
    }
    let mut tx = state.db.begin().await?;
    let id: Uuid = sqlx::query_scalar(
        "insert into public.meetings (title, starts_at, ends_at, location, meeting_url, lead_id, client_id, deal_id,
           organizer_id, notes) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id",
    )
    .bind(input.title.trim())
    .bind(input.starts_at)
    .bind(input.ends_at)
    .bind(clean(input.location.clone()))
    .bind(clean(input.meeting_url.clone()))
    .bind(input.lead_id)
    .bind(input.client_id)
    .bind(input.deal_id)
    .bind(user.id)
    .bind(clean(input.notes.clone()))
    .fetch_one(&mut *tx)
    .await?;
    set_participants(&mut tx, id, &input).await?;
    if let Some(lead) = input.lead_id {
        audit::activity(&mut *tx, user.id, "lead", lead, "meeting.scheduled", &format!("{} scheduled a meeting: {}", user.full_name, input.title.trim())).await?;
    }
    // Let participants know.
    sqlx::query(
        "insert into public.notifications (user_id, kind, title, body, entity_type, entity_id)
         select u, 'meeting_invite', $2, $3, 'meeting', $1 from unnest($4::uuid[]) u where u <> $5",
    )
    .bind(id)
    .bind(format!("{} added you to a meeting", user.full_name))
    .bind(input.title.trim())
    .bind(&input.participant_ids)
    .bind(user.id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(fetch(&state, id).await?))
}

async fn ensure_editable(state: &AppState, user: &AuthUser, id: Uuid) -> AppResult<()> {
    let organizer: Option<Uuid> = sqlx::query_scalar("select organizer_id from public.meetings where id = $1 and deleted_at is null")
        .bind(id)
        .fetch_optional(&state.db)
        .await?
        .ok_or(AppError::NotFound)?;
    let participant: bool = sqlx::query_scalar("select exists (select 1 from public.meeting_participants where meeting_id = $1 and user_id = $2)")
        .bind(id)
        .bind(user.id)
        .fetch_one(&state.db)
        .await?;
    if organizer == Some(user.id) || participant || user.can("leads.view_all") {
        Ok(())
    } else {
        Err(AppError::forbidden("Only the organizer and participants can edit this meeting."))
    }
}

pub async fn update(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Json(input): Json<MeetingInput>,
) -> AppResult<Json<Meeting>> {
    user.require("sales.manage")?;
    validate(&input)?;
    ensure_editable(&state, &user, id).await?;
    let mut tx = state.db.begin().await?;
    sqlx::query(
        "update public.meetings set title=$2, starts_at=$3, ends_at=$4, location=$5, meeting_url=$6, lead_id=$7,
           client_id=$8, deal_id=$9, notes=$10, outcome=$11, next_action=$12, status=coalesce($13, status),
           notified_at = case when starts_at <> $3 then null else notified_at end
         where id = $1",
    )
    .bind(id)
    .bind(input.title.trim())
    .bind(input.starts_at)
    .bind(input.ends_at)
    .bind(clean(input.location.clone()))
    .bind(clean(input.meeting_url.clone()))
    .bind(input.lead_id)
    .bind(input.client_id)
    .bind(input.deal_id)
    .bind(clean(input.notes.clone()))
    .bind(clean(input.outcome.clone()))
    .bind(clean(input.next_action.clone()))
    .bind(&input.status)
    .execute(&mut *tx)
    .await?;
    set_participants(&mut tx, id, &input).await?;
    // A completed meeting with a lead counts as contact and can set the lead's next action.
    if let (Some(lead), Some("completed")) = (input.lead_id, input.status.as_deref()) {
        sqlx::query(
            "update public.leads set last_contacted_at = greatest(coalesce(last_contacted_at, $2), $2),
               next_action = coalesce($3, next_action) where id = $1",
        )
        .bind(lead)
        .bind(input.starts_at)
        .bind(clean(input.next_action.clone()))
        .execute(&mut *tx)
        .await?;
        audit::activity(&mut *tx, user.id, "lead", lead, "meeting.completed", &format!("{} completed the meeting: {}", user.full_name, input.title.trim())).await?;
    }
    tx.commit().await?;
    Ok(Json(fetch(&state, id).await?))
}

pub async fn remove(State(state): State<AppState>, user: AuthUser, Path(id): Path<Uuid>) -> AppResult<StatusCode> {
    user.require("sales.manage")?;
    ensure_editable(&state, &user, id).await?;
    sqlx::query("update public.meetings set deleted_at = now() where id = $1").bind(id).execute(&state.db).await?;
    Ok(StatusCode::NO_CONTENT)
}
