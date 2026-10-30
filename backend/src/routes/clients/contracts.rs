//! Client contracts with terms, value, dates and attached documents (files on the contract).

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    audit,
    auth::AuthUser,
    error::{AppError, AppResult},
    state::AppState,
    validate::{clean, Validator},
};

#[derive(Serialize, sqlx::FromRow)]
pub struct Contract {
    id: Uuid,
    client_id: Uuid,
    client_name: String,
    title: String,
    status: String,
    start_date: Option<NaiveDate>,
    end_date: Option<NaiveDate>,
    value: Option<Decimal>,
    currency: String,
    billing_cycle: Option<String>,
    signed_at: Option<DateTime<Utc>>,
    notes: Option<String>,
    proposal_id: Option<Uuid>,
    documents: i64,
    /// Days until end_date (negative once expired).
    days_left: Option<i32>,
    created_at: DateTime<Utc>,
}

const SELECT: &str = "select k.id, k.client_id, c.name as client_name, k.title,
    case when k.status in ('signed','active') and k.end_date < current_date then 'expired' else k.status end as status,
    k.start_date, k.end_date, k.value, k.currency, k.billing_cycle, k.signed_at, k.notes, k.proposal_id,
    (select count(*) from public.files f where f.entity_type = 'contract' and f.entity_id = k.id and f.deleted_at is null) as documents,
    (k.end_date - current_date) as days_left, k.created_at
  from public.contracts k
  join public.clients cl on cl.id = k.client_id
  join public.companies c on c.id = cl.company_id";

#[derive(Deserialize, Default)]
pub struct ContractQuery {
    client_id: Option<Uuid>,
    status: Option<String>,
    /// Active contracts ending within this many days.
    expiring_days: Option<i32>,
}

pub async fn list(State(state): State<AppState>, user: AuthUser, Query(q): Query<ContractQuery>) -> AppResult<Json<Vec<Contract>>> {
    user.require("clients.view")?;
    let rows = sqlx::query_as::<_, Contract>(&format!(
        "{SELECT} where k.deleted_at is null and cl.deleted_at is null
           and ($1::uuid is null or k.client_id = $1)
           and ($2::text is null or (case when k.status in ('signed','active') and k.end_date < current_date then 'expired' else k.status end) = $2)
           and ($3::int is null or (k.status in ('signed','active') and k.end_date between current_date and current_date + $3))
         order by k.end_date nulls last, k.created_at desc limit 500"
    ))
    .bind(q.client_id)
    .bind(q.status.as_deref().filter(|s| !s.is_empty()))
    .bind(q.expiring_days)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(rows))
}

#[derive(Deserialize)]
pub struct ContractInput {
    title: String,
    status: Option<String>,
    start_date: Option<NaiveDate>,
    end_date: Option<NaiveDate>,
    value: Option<Decimal>,
    currency: Option<String>,
    billing_cycle: Option<String>,
    signed_at: Option<DateTime<Utc>>,
    notes: Option<String>,
    proposal_id: Option<Uuid>,
}

fn validate(i: &ContractInput) -> AppResult<()> {
    let mut v = Validator::new();
    v.text("title", &i.title, 200);
    if let Some(s) = &i.status {
        v.one_of("status", s, &["draft", "sent", "signed", "active", "expired", "terminated"]);
    }
    if let Some(b) = i.billing_cycle.as_deref().filter(|b| !b.is_empty()) {
        v.one_of("billing_cycle", b, &["one_time", "monthly", "quarterly", "yearly"]);
    }
    if i.value.is_some_and(|d| d.is_sign_negative()) {
        v.fail("value", "Can't be negative.");
    }
    if let (Some(a), Some(b)) = (i.start_date, i.end_date) {
        if b < a {
            v.fail("end_date", "End date is before the start date.");
        }
    }
    v.optional_text("notes", i.notes.as_deref(), 10_000);
    v.finish()
}

async fn fetch(state: &AppState, id: Uuid) -> AppResult<Contract> {
    Ok(sqlx::query_as::<_, Contract>(&format!("{SELECT} where k.id = $1 and k.deleted_at is null")).bind(id).fetch_one(&state.db).await?)
}

pub async fn create(State(state): State<AppState>, user: AuthUser, Path(client_id): Path<Uuid>, Json(i): Json<ContractInput>) -> AppResult<Json<Contract>> {
    user.require("clients.manage")?;
    validate(&i)?;
    let id: Uuid = sqlx::query_scalar(
        "insert into public.contracts (client_id, title, status, start_date, end_date, value, currency, billing_cycle, signed_at, notes, proposal_id)
         select $1, $2, coalesce($3, 'draft'), $4, $5, $6, coalesce($7, 'PHP'), $8, $9, $10, $11
         from public.clients where id = $1 and deleted_at is null returning id",
    )
    .bind(client_id).bind(i.title.trim()).bind(&i.status).bind(i.start_date).bind(i.end_date).bind(i.value)
    .bind(&i.currency).bind(clean(i.billing_cycle.clone())).bind(i.signed_at).bind(clean(i.notes.clone())).bind(i.proposal_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::NotFound)?;
    audit::activity(&state.db, user.id, "client", client_id, "contract.created", &format!("{} added the contract {}", user.full_name, i.title.trim())).await?;
    Ok(Json(fetch(&state, id).await?))
}

pub async fn update(State(state): State<AppState>, user: AuthUser, Path(id): Path<Uuid>, Json(i): Json<ContractInput>) -> AppResult<Json<Contract>> {
    user.require("clients.manage")?;
    validate(&i)?;
    let updated = sqlx::query(
        "update public.contracts set title=$2, status=coalesce($3, status), start_date=$4, end_date=$5, value=$6,
           currency=coalesce($7, currency), billing_cycle=$8,
           signed_at = coalesce($9, case when $3 in ('signed','active') then coalesce(signed_at, now()) else signed_at end),
           notes=$10, proposal_id=$11
         where id = $1 and deleted_at is null",
    )
    .bind(id).bind(i.title.trim()).bind(&i.status).bind(i.start_date).bind(i.end_date).bind(i.value).bind(&i.currency)
    .bind(clean(i.billing_cycle.clone())).bind(i.signed_at).bind(clean(i.notes.clone())).bind(i.proposal_id)
    .execute(&state.db)
    .await?;
    if updated.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(Json(fetch(&state, id).await?))
}

pub async fn remove(State(state): State<AppState>, user: AuthUser, Path(id): Path<Uuid>) -> AppResult<StatusCode> {
    user.require("clients.manage")?;
    sqlx::query("update public.contracts set deleted_at = now() where id = $1").bind(id).execute(&state.db).await?;
    Ok(StatusCode::NO_CONTENT)
}
