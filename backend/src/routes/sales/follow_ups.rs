//! Follow-up reminders on leads, deals and clients, with recurrence and overdue tracking.

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
        common::{paging, Page},
        leads::ensure_visible,
    },
    state::AppState,
    validate::{clean, Validator},
};

#[derive(Serialize, sqlx::FromRow)]
pub struct FollowUp {
    id: Uuid,
    title: String,
    notes: Option<String>,
    due_at: DateTime<Utc>,
    priority: String,
    status: String,
    recurrence: Option<String>,
    overdue: bool,
    lead_id: Option<Uuid>,
    deal_id: Option<Uuid>,
    client_id: Option<Uuid>,
    related_name: Option<String>,
    assigned_to: Option<Uuid>,
    assigned_name: Option<String>,
    completed_at: Option<DateTime<Utc>>,
    created_at: DateTime<Utc>,
}

const SELECT: &str = "select f.id, f.title, f.notes, f.due_at, f.priority, f.status, f.recurrence,
    (f.status = 'pending' and f.due_at < now()) as overdue, f.lead_id, f.deal_id, f.client_id,
    coalesce(lc.name, dc.name, cc.name) as related_name, f.assigned_to, a.full_name as assigned_name,
    f.completed_at, f.created_at
  from public.follow_ups f
  left join public.leads l on l.id = f.lead_id
  left join public.companies lc on lc.id = l.company_id
  left join public.deals d on d.id = f.deal_id
  left join public.companies dc on dc.id = d.company_id
  left join public.clients cl on cl.id = f.client_id
  left join public.companies cc on cc.id = cl.company_id
  left join public.profiles a on a.id = f.assigned_to";

#[derive(Deserialize, Default)]
pub struct FollowUpQuery {
    /// mine (default) or team
    scope: Option<String>,
    /// pending (default), done, all
    status: Option<String>,
    /// overdue | today | week
    due: Option<String>,
    lead_id: Option<Uuid>,
    client_id: Option<Uuid>,
    deal_id: Option<Uuid>,
    page: Option<i64>,
    per_page: Option<i64>,
}

fn push_filters(qb: &mut QueryBuilder<'_, Postgres>, q: &FollowUpQuery, user: &AuthUser) {
    qb.push(" where (l.id is null or l.deleted_at is null)");
    let team = q.scope.as_deref() == Some("team") && user.can("leads.view_all");
    let for_record = q.lead_id.is_some() || q.client_id.is_some() || q.deal_id.is_some();
    if !team && !(for_record && user.can("leads.view_all")) {
        qb.push(" and (f.assigned_to = ").push_bind(user.id).push(" or f.created_by = ").push_bind(user.id);
        if for_record {
            // Anyone who can see the lead sees its follow-ups.
            qb.push(" or f.lead_id is not null");
        }
        qb.push(")");
    }
    match q.status.as_deref() {
        Some("done") => {
            qb.push(" and f.status = 'done'");
        }
        Some("all") => {}
        _ => {
            qb.push(" and f.status = 'pending'");
        }
    }
    match q.due.as_deref() {
        Some("overdue") => {
            qb.push(" and f.due_at < now()");
        }
        Some("today") => {
            qb.push(" and f.due_at < date_trunc('day', now() at time zone ")
                .push_bind(user.timezone.clone())
                .push(") at time zone ")
                .push_bind(user.timezone.clone())
                .push(" + interval '1 day'");
        }
        Some("week") => {
            qb.push(" and f.due_at < now() + interval '7 days'");
        }
        _ => {}
    }
    if let Some(v) = q.lead_id {
        qb.push(" and f.lead_id = ").push_bind(v);
    }
    if let Some(v) = q.client_id {
        qb.push(" and f.client_id = ").push_bind(v);
    }
    if let Some(v) = q.deal_id {
        qb.push(" and f.deal_id = ").push_bind(v);
    }
}

pub async fn list(State(state): State<AppState>, user: AuthUser, Query(q): Query<FollowUpQuery>) -> AppResult<Json<Page<FollowUp>>> {
    user.require("sales.view")?;
    if let Some(lead) = q.lead_id {
        ensure_visible(&state.db, &user, lead).await?;
    }
    let (page, per_page, offset) = paging(q.page, q.per_page, 200);
    let mut rows = QueryBuilder::<Postgres>::new(SELECT);
    push_filters(&mut rows, &q, &user);
    let order = if q.status.as_deref() == Some("done") { "f.completed_at desc" } else { "f.due_at" };
    rows.push(format!(" order by {order} limit ")).push_bind(per_page).push(" offset ").push_bind(offset);
    let mut count = QueryBuilder::<Postgres>::new(
        "select count(*) from public.follow_ups f left join public.leads l on l.id = f.lead_id",
    );
    push_filters(&mut count, &q, &user);
    let (items, total) = tokio::try_join!(
        rows.build_query_as::<FollowUp>().fetch_all(&state.db),
        count.build_query_scalar::<i64>().fetch_one(&state.db),
    )?;
    Ok(Json(Page { items, total, page, per_page }))
}

async fn fetch(state: &AppState, id: Uuid) -> AppResult<FollowUp> {
    Ok(sqlx::query_as::<_, FollowUp>(&format!("{SELECT} where f.id = $1")).bind(id).fetch_one(&state.db).await?)
}

#[derive(Deserialize)]
pub struct FollowUpInput {
    lead_id: Option<Uuid>,
    deal_id: Option<Uuid>,
    client_id: Option<Uuid>,
    title: String,
    notes: Option<String>,
    due_at: DateTime<Utc>,
    priority: Option<String>,
    recurrence: Option<String>,
    assigned_to: Option<Uuid>,
}

fn validate(input: &FollowUpInput) -> AppResult<()> {
    let mut v = Validator::new();
    v.text("title", &input.title, 200);
    v.optional_text("notes", input.notes.as_deref(), 5000);
    if let Some(p) = &input.priority {
        v.one_of("priority", p, &["low", "medium", "high", "urgent"]);
    }
    if let Some(r) = input.recurrence.as_deref().filter(|r| !r.is_empty()) {
        v.one_of("recurrence", r, &["daily", "weekly", "biweekly", "monthly"]);
    }
    v.finish()
}

pub async fn create(State(state): State<AppState>, user: AuthUser, Json(input): Json<FollowUpInput>) -> AppResult<Json<FollowUp>> {
    user.require("sales.manage")?;
    validate(&input)?;
    if let Some(lead) = input.lead_id {
        ensure_visible(&state.db, &user, lead).await?;
    }
    let id: Uuid = sqlx::query_scalar(
        "insert into public.follow_ups (lead_id, deal_id, client_id, title, notes, due_at, priority, recurrence, assigned_to, created_by)
         values ($1, $2, $3, $4, $5, $6, coalesce($7, 'medium'), $8, coalesce($9, $10), $10) returning id",
    )
    .bind(input.lead_id)
    .bind(input.deal_id)
    .bind(input.client_id)
    .bind(input.title.trim())
    .bind(clean(input.notes.clone()))
    .bind(input.due_at)
    .bind(&input.priority)
    .bind(clean(input.recurrence.clone()))
    .bind(input.assigned_to)
    .bind(user.id)
    .fetch_one(&state.db)
    .await?;
    if let Some(lead) = input.lead_id {
        audit::activity(&state.db, user.id, "lead", lead, "follow_up.created", &format!("{} scheduled a follow-up: {}", user.full_name, input.title.trim())).await?;
    }
    Ok(Json(fetch(&state, id).await?))
}

async fn ensure_editable(state: &AppState, user: &AuthUser, id: Uuid) -> AppResult<()> {
    let (assigned, created): (Option<Uuid>, Option<Uuid>) =
        sqlx::query_as("select assigned_to, created_by from public.follow_ups where id = $1")
            .bind(id)
            .fetch_optional(&state.db)
            .await?
            .ok_or(AppError::NotFound)?;
    if assigned == Some(user.id) || created == Some(user.id) || user.can("leads.view_all") {
        Ok(())
    } else {
        Err(AppError::forbidden("This follow-up belongs to someone else."))
    }
}

pub async fn update(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Json(input): Json<FollowUpInput>,
) -> AppResult<Json<FollowUp>> {
    user.require("sales.manage")?;
    validate(&input)?;
    ensure_editable(&state, &user, id).await?;
    sqlx::query(
        "update public.follow_ups set title = $2, notes = $3, due_at = $4, priority = coalesce($5, priority),
           recurrence = $6, assigned_to = coalesce($7, assigned_to),
           notified_at = case when due_at <> $4 then null else notified_at end
         where id = $1",
    )
    .bind(id)
    .bind(input.title.trim())
    .bind(clean(input.notes))
    .bind(input.due_at)
    .bind(&input.priority)
    .bind(clean(input.recurrence))
    .bind(input.assigned_to)
    .execute(&state.db)
    .await?;
    Ok(Json(fetch(&state, id).await?))
}

/// Marks done; recurring follow-ups schedule their next occurrence.
pub async fn complete(State(state): State<AppState>, user: AuthUser, Path(id): Path<Uuid>) -> AppResult<Json<FollowUp>> {
    user.require("sales.manage")?;
    ensure_editable(&state, &user, id).await?;
    let mut tx = state.db.begin().await?;
    let (title, lead_id, recurrence): (String, Option<Uuid>, Option<String>) = sqlx::query_as(
        "update public.follow_ups set status = 'done', completed_at = now(), completed_by = $2
         where id = $1 and status = 'pending' returning title, lead_id, recurrence",
    )
    .bind(id)
    .bind(user.id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::Conflict("This follow-up is already done.".into()))?;

    if let Some(r) = recurrence {
        let interval = match r.as_str() {
            "daily" => "1 day",
            "weekly" => "7 days",
            "biweekly" => "14 days",
            _ => "1 month",
        };
        sqlx::query(&format!(
            "insert into public.follow_ups (lead_id, deal_id, client_id, title, notes, due_at, priority, recurrence, assigned_to, created_by)
             select lead_id, deal_id, client_id, title, notes,
                    greatest(due_at + interval '{interval}', now() + interval '1 hour'),
                    priority, recurrence, assigned_to, created_by
             from public.follow_ups where id = $1"
        ))
        .bind(id)
        .execute(&mut *tx)
        .await?;
    }
    if let Some(lead) = lead_id {
        audit::activity(&mut *tx, user.id, "lead", lead, "follow_up.completed", &format!("{} completed: {title}", user.full_name)).await?;
    }
    tx.commit().await?;
    Ok(Json(fetch(&state, id).await?))
}

pub async fn remove(State(state): State<AppState>, user: AuthUser, Path(id): Path<Uuid>) -> AppResult<StatusCode> {
    user.require("sales.manage")?;
    ensure_editable(&state, &user, id).await?;
    sqlx::query("update public.follow_ups set status = 'cancelled' where id = $1").bind(id).execute(&state.db).await?;
    Ok(StatusCode::NO_CONTENT)
}
