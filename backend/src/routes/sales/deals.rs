//! Deals: priced opportunities. Won deals drive revenue figures (per currency).

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use sqlx::{Postgres, QueryBuilder};
use uuid::Uuid;

use crate::{
    audit,
    auth::AuthUser,
    error::{AppError, AppResult},
    routes::{
        common::{like_pattern, non_empty, paging, Page},
        leads::ensure_visible,
    },
    state::AppState,
    validate::{clean, Validator},
};

#[derive(Serialize, sqlx::FromRow)]
pub struct Deal {
    id: Uuid,
    title: String,
    company_id: Uuid,
    company_name: String,
    lead_id: Option<Uuid>,
    client_id: Option<Uuid>,
    value: Decimal,
    currency: String,
    status: String,
    owner_id: Option<Uuid>,
    owner_name: Option<String>,
    expected_close_date: Option<NaiveDate>,
    won_at: Option<DateTime<Utc>>,
    lost_at: Option<DateTime<Utc>>,
    lost_reason: Option<String>,
    proposals: i64,
    created_at: DateTime<Utc>,
}

const SELECT: &str = "select d.id, d.title, d.company_id, c.name as company_name, d.lead_id,
    (select cl.id from public.clients cl where cl.company_id = d.company_id and cl.deleted_at is null) as client_id,
    d.value, d.currency, d.status, d.owner_id, o.full_name as owner_name, d.expected_close_date, d.won_at, d.lost_at,
    d.lost_reason, (select count(*) from public.proposals p where p.deal_id = d.id and p.deleted_at is null) as proposals,
    d.created_at
  from public.deals d
  join public.companies c on c.id = d.company_id
  left join public.profiles o on o.id = d.owner_id";

#[derive(Deserialize, Default)]
pub struct DealQuery {
    status: Option<String>,
    search: Option<String>,
    owner: Option<String>,
    lead_id: Option<Uuid>,
    page: Option<i64>,
    per_page: Option<i64>,
}

fn push_filters(qb: &mut QueryBuilder<'_, Postgres>, q: &DealQuery, user: &AuthUser) {
    qb.push(" where d.deleted_at is null");
    if !user.can("leads.view_all") {
        qb.push(" and d.owner_id = ").push_bind(user.id);
    }
    if let Some(s) = non_empty(&q.status) {
        qb.push(" and d.status = ").push_bind(s.to_owned());
    }
    if let Some(t) = non_empty(&q.search) {
        let p = like_pattern(t);
        qb.push(" and (d.title ilike ").push_bind(p.clone()).push(" or c.name ilike ").push_bind(p).push(")");
    }
    match non_empty(&q.owner) {
        Some("me") => {
            qb.push(" and d.owner_id = ").push_bind(user.id);
        }
        Some(id) => {
            if let Ok(id) = id.parse::<Uuid>() {
                qb.push(" and d.owner_id = ").push_bind(id);
            }
        }
        None => {}
    }
    if let Some(l) = q.lead_id {
        qb.push(" and d.lead_id = ").push_bind(l);
    }
}

pub async fn list(State(state): State<AppState>, user: AuthUser, Query(q): Query<DealQuery>) -> AppResult<Json<Page<Deal>>> {
    user.require("sales.view")?;
    let (page, per_page, offset) = paging(q.page, q.per_page, 200);
    let mut rows = QueryBuilder::<Postgres>::new(SELECT);
    push_filters(&mut rows, &q, &user);
    rows.push(" order by case d.status when 'open' then 0 else 1 end, coalesce(d.won_at, d.lost_at, d.created_at) desc limit ")
        .push_bind(per_page).push(" offset ").push_bind(offset);
    let mut count = QueryBuilder::<Postgres>::new(
        "select count(*) from public.deals d join public.companies c on c.id = d.company_id",
    );
    push_filters(&mut count, &q, &user);
    let (items, total) = tokio::try_join!(
        rows.build_query_as::<Deal>().fetch_all(&state.db),
        count.build_query_scalar::<i64>().fetch_one(&state.db),
    )?;
    Ok(Json(Page { items, total, page, per_page }))
}

pub async fn fetch(db: &sqlx::PgPool, id: Uuid) -> AppResult<Deal> {
    Ok(sqlx::query_as::<_, Deal>(&format!("{SELECT} where d.id = $1 and d.deleted_at is null")).bind(id).fetch_one(db).await?)
}

#[derive(Deserialize)]
pub struct DealInput {
    lead_id: Option<Uuid>,
    title: String,
    value: Decimal,
    currency: String,
    expected_close_date: Option<NaiveDate>,
    owner_id: Option<Uuid>,
}

fn validate(i: &DealInput) -> AppResult<()> {
    let mut v = Validator::new();
    v.text("title", &i.title, 200);
    if i.value.is_sign_negative() {
        v.fail("value", "Can't be negative.");
    }
    if i.currency.len() != 3 || !i.currency.chars().all(|c| c.is_ascii_uppercase()) {
        v.fail("currency", "Use a 3-letter currency code.");
    }
    v.finish()
}

pub async fn create(State(state): State<AppState>, user: AuthUser, Json(input): Json<DealInput>) -> AppResult<Json<Deal>> {
    user.require("sales.manage")?;
    validate(&input)?;
    let lead_id = input.lead_id.ok_or_else(|| AppError::BadRequest("A deal must belong to a lead.".into()))?;
    ensure_visible(&state.db, &user, lead_id).await?;
    let id: Uuid = sqlx::query_scalar(
        "insert into public.deals (company_id, lead_id, title, value, currency, expected_close_date, owner_id)
         select l.company_id, l.id, $2, $3, $4, $5, coalesce($6, l.assigned_to, $7) from public.leads l where l.id = $1
         returning id",
    )
    .bind(lead_id)
    .bind(input.title.trim())
    .bind(input.value)
    .bind(&input.currency)
    .bind(input.expected_close_date)
    .bind(input.owner_id)
    .bind(user.id)
    .fetch_one(&state.db)
    .await?;
    audit::activity(&state.db, user.id, "lead", lead_id, "deal.created", &format!("{} opened a deal: {}", user.full_name, input.title.trim())).await?;
    Ok(Json(fetch(&state.db, id).await?))
}

async fn ensure_editable(state: &AppState, user: &AuthUser, id: Uuid) -> AppResult<()> {
    let owner: Option<Uuid> = sqlx::query_scalar("select owner_id from public.deals where id = $1 and deleted_at is null")
        .bind(id)
        .fetch_optional(&state.db)
        .await?
        .ok_or(AppError::NotFound)?;
    if owner == Some(user.id) || user.can("leads.view_all") {
        Ok(())
    } else {
        Err(AppError::forbidden("This deal belongs to someone else."))
    }
}

pub async fn update(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Json(input): Json<DealInput>,
) -> AppResult<Json<Deal>> {
    user.require("sales.manage")?;
    validate(&input)?;
    ensure_editable(&state, &user, id).await?;
    sqlx::query(
        "update public.deals set title = $2, value = $3, currency = $4, expected_close_date = $5,
           owner_id = coalesce($6, owner_id) where id = $1",
    )
    .bind(id)
    .bind(input.title.trim())
    .bind(input.value)
    .bind(&input.currency)
    .bind(input.expected_close_date)
    .bind(input.owner_id)
    .execute(&state.db)
    .await?;
    Ok(Json(fetch(&state.db, id).await?))
}

#[derive(Deserialize)]
pub struct CloseDeal {
    status: String,
    lost_reason: Option<String>,
}

/// Marks a deal won or lost (or reopens it). Won moves the lead to the first "won" stage.
pub async fn close(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Json(input): Json<CloseDeal>,
) -> AppResult<Json<Deal>> {
    user.require("sales.manage")?;
    ensure_editable(&state, &user, id).await?;
    let mut v = Validator::new();
    v.one_of("status", &input.status, &["open", "won", "lost"]);
    v.optional_text("lost_reason", input.lost_reason.as_deref(), 500);
    v.finish()?;

    let mut tx = state.db.begin().await?;
    let (lead_id, title): (Option<Uuid>, String) = sqlx::query_as(
        "update public.deals set status = $2,
           won_at = case when $2 = 'won' then coalesce(won_at, now()) else null end,
           lost_at = case when $2 = 'lost' then coalesce(lost_at, now()) else null end,
           lost_reason = case when $2 = 'lost' then $3 else null end
         where id = $1 returning lead_id, title",
    )
    .bind(id)
    .bind(&input.status)
    .bind(clean(input.lost_reason.clone()))
    .fetch_one(&mut *tx)
    .await?;

    if let Some(lead) = lead_id {
        if input.status == "won" || input.status == "lost" {
            sqlx::query(
                "update public.leads set stage_id = coalesce(
                   (select id from public.pipeline_stages where kind = $2 and archived_at is null order by position limit 1),
                   stage_id),
                   lost_reason = case when $2 = 'lost' then coalesce($3, lost_reason) else lost_reason end
                 where id = $1",
            )
            .bind(lead)
            .bind(&input.status)
            .bind(clean(input.lost_reason.clone()))
            .execute(&mut *tx)
            .await?;
        }
        let verb = match input.status.as_str() { "won" => "won", "lost" => "lost", _ => "reopened" };
        audit::activity(&mut *tx, user.id, "lead", lead, "deal.closed", &format!("{} {verb} the deal: {title}", user.full_name)).await?;
    }
    tx.commit().await?;
    Ok(Json(fetch(&state.db, id).await?))
}

pub async fn remove(State(state): State<AppState>, user: AuthUser, Path(id): Path<Uuid>) -> AppResult<StatusCode> {
    user.require("sales.manage")?;
    ensure_editable(&state, &user, id).await?;
    sqlx::query("update public.deals set deleted_at = now() where id = $1").bind(id).execute(&state.db).await?;
    Ok(StatusCode::NO_CONTENT)
}
