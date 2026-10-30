//! Clients: the same company record a lead started with, plus services, contracts,
//! contacts, onboarding and history.

pub mod contracts;
pub mod services;

use std::collections::BTreeMap;

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::{Postgres, QueryBuilder};
use uuid::Uuid;

use super::{
    common::{like_pattern, non_empty, paging, Page},
    leads::{duplicates, LeadInput},
};
use crate::{
    audit::{self, AuditEntry},
    auth::AuthUser,
    error::{AppError, AppResult},
    state::AppState,
    validate::{clean, Validator},
};

pub const STATUSES: &[&str] = &["onboarding", "active", "awaiting_client", "needs_attention", "at_risk", "completed", "inactive"];
/// Statuses that count as a current client.
const CURRENT: &str = "('onboarding','active','awaiting_client','needs_attention','at_risk')";

#[derive(Serialize, sqlx::FromRow)]
pub struct ClientRow {
    id: Uuid,
    company_id: Uuid,
    name: String,
    industry: Option<String>,
    market: String,
    country: Option<String>,
    city: Option<String>,
    status: String,
    account_manager_id: Option<Uuid>,
    account_manager_name: Option<String>,
    client_since: NaiveDate,
    services_count: i64,
    /// Recurring revenue per month, per currency (quarterly/yearly normalized to monthly).
    monthly_value: serde_json::Value,
    open_tasks: i64,
    primary_contact: Option<String>,
    created_at: DateTime<Utc>,
}

const LIST_SELECT: &str = "select cl.id, cl.company_id, c.name, c.industry, c.market, c.country, c.city, cl.status,
    cl.account_manager_id, am.full_name as account_manager_name, cl.client_since,
    (select count(*) from public.client_services s where s.client_id = cl.id and s.status = 'active') as services_count,
    coalesce((select jsonb_object_agg(currency, amount) from (
        select s.currency, sum(case s.billing_type when 'monthly' then s.price when 'quarterly' then round(s.price / 3, 2)
                                                  when 'yearly' then round(s.price / 12, 2) else 0 end) as amount
        from public.client_services s where s.client_id = cl.id and s.status = 'active'
          and s.billing_type in ('monthly', 'quarterly', 'yearly')
        group by s.currency) m), '{}'::jsonb) as monthly_value,
    (select count(*) from public.tasks t where t.client_id = cl.id and t.deleted_at is null and t.status <> 'done') as open_tasks,
    (select ct.full_name from public.contacts ct where ct.company_id = c.id and ct.deleted_at is null
      order by ct.is_primary desc, ct.created_at limit 1) as primary_contact,
    cl.created_at
  from public.clients cl
  join public.companies c on c.id = cl.company_id
  left join public.profiles am on am.id = cl.account_manager_id";

#[derive(Deserialize, Default)]
pub struct ClientQuery {
    /// A status, `current` (default) or `all`.
    status: Option<String>,
    search: Option<String>,
    manager: Option<String>,
    market: Option<String>,
    sort: Option<String>,
    page: Option<i64>,
    per_page: Option<i64>,
}

fn push_filters(qb: &mut QueryBuilder<'_, Postgres>, q: &ClientQuery, user: &AuthUser) {
    qb.push(" where cl.deleted_at is null");
    match non_empty(&q.status) {
        Some("all") => {}
        Some(s) if s != "current" => {
            qb.push(" and cl.status = ").push_bind(s.to_owned());
        }
        _ => {
            qb.push(format!(" and cl.status in {CURRENT}"));
        }
    }
    if let Some(t) = non_empty(&q.search) {
        let p = like_pattern(t);
        qb.push(" and (c.name ilike ").push_bind(p.clone()).push(" or c.city ilike ").push_bind(p.clone())
            .push(" or c.industry ilike ").push_bind(p).push(")");
    }
    match non_empty(&q.manager) {
        Some("me") => {
            qb.push(" and cl.account_manager_id = ").push_bind(user.id);
        }
        Some(id) => {
            if let Ok(id) = id.parse::<Uuid>() {
                qb.push(" and cl.account_manager_id = ").push_bind(id);
            }
        }
        None => {}
    }
    if let Some(m) = non_empty(&q.market) {
        qb.push(" and c.market = ").push_bind(m.to_owned());
    }
}

pub async fn list(State(state): State<AppState>, user: AuthUser, Query(q): Query<ClientQuery>) -> AppResult<Json<Page<ClientRow>>> {
    user.require("clients.view")?;
    let (page, per_page, offset) = paging(q.page, q.per_page, 200);
    let mut rows = QueryBuilder::<Postgres>::new(LIST_SELECT);
    push_filters(&mut rows, &q, &user);
    let order = match q.sort.as_deref() {
        Some("since") => "cl.client_since desc",
        Some("status") => "array_position(array['at_risk','needs_attention','awaiting_client','onboarding','active','completed','inactive'], cl.status)",
        _ => "lower(c.name)",
    };
    rows.push(format!(" order by {order}, cl.id limit ")).push_bind(per_page).push(" offset ").push_bind(offset);
    let mut count = QueryBuilder::<Postgres>::new("select count(*) from public.clients cl join public.companies c on c.id = cl.company_id");
    push_filters(&mut count, &q, &user);
    let (items, total) = tokio::try_join!(
        rows.build_query_as::<ClientRow>().fetch_all(&state.db),
        count.build_query_scalar::<i64>().fetch_one(&state.db),
    )?;
    Ok(Json(Page { items, total, page, per_page }))
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

#[derive(Serialize, sqlx::FromRow)]
pub struct Company {
    id: Uuid,
    name: String,
    industry: Option<String>,
    category: Option<String>,
    market: String,
    country: Option<String>,
    region: Option<String>,
    city: Option<String>,
    address: Option<String>,
    website_url: Option<String>,
    facebook_url: Option<String>,
    instagram_url: Option<String>,
    linkedin_url: Option<String>,
    google_maps_url: Option<String>,
    phone: Option<String>,
    email: Option<String>,
}

#[derive(Serialize, sqlx::FromRow)]
pub struct ClientCore {
    id: Uuid,
    status: String,
    account_manager_id: Option<Uuid>,
    account_manager_name: Option<String>,
    client_since: NaiveDate,
    billing_email: Option<String>,
    billing_address: Option<String>,
    billing_notes: Option<String>,
    notes: Option<String>,
    lead_id: Option<Uuid>,
    deal_id: Option<Uuid>,
    proposal_id: Option<Uuid>,
    proposal_number: Option<String>,
    created_at: DateTime<Utc>,
}

#[derive(Serialize, sqlx::FromRow)]
pub struct Contact {
    id: Uuid,
    full_name: String,
    position: Option<String>,
    email: Option<String>,
    phone: Option<String>,
    is_primary: bool,
    notes: Option<String>,
}

#[derive(Serialize, sqlx::FromRow)]
pub struct ClientService {
    id: Uuid,
    service_id: Option<Uuid>,
    name: String,
    price: Decimal,
    currency: String,
    billing_type: String,
    status: String,
    start_date: Option<NaiveDate>,
    end_date: Option<NaiveDate>,
    notes: Option<String>,
}

#[derive(Serialize, sqlx::FromRow)]
pub struct OnboardingItem {
    id: Uuid,
    title: String,
    status: String,
    assignee_name: Option<String>,
    due_at: Option<DateTime<Utc>>,
}

#[derive(Serialize)]
pub struct ClientDetail {
    #[serde(flatten)]
    client: ClientCore,
    company: Company,
    contacts: Vec<Contact>,
    services: Vec<ClientService>,
    onboarding: Vec<OnboardingItem>,
    monthly_value: BTreeMap<String, Decimal>,
    counts: Counts,
}

#[derive(Serialize, sqlx::FromRow, Default)]
pub struct Counts {
    contracts: i64,
    projects: i64,
    open_tasks: i64,
    websites: i64,
    files: i64,
    content_posts: i64,
}

pub async fn fetch(state: &AppState, id: Uuid) -> AppResult<ClientDetail> {
    let db = &state.db;
    let client = sqlx::query_as::<_, ClientCore>(
        "select cl.id, cl.status, cl.account_manager_id, am.full_name as account_manager_name, cl.client_since,
                cl.billing_email, cl.billing_address, cl.billing_notes, cl.notes, cl.lead_id, cl.deal_id, cl.proposal_id,
                p.number as proposal_number, cl.created_at
         from public.clients cl
         left join public.profiles am on am.id = cl.account_manager_id
         left join public.proposals p on p.id = cl.proposal_id
         where cl.id = $1 and cl.deleted_at is null",
    )
    .bind(id)
    .fetch_optional(db)
    .await?
    .ok_or(AppError::NotFound)?;

    let (company, contacts, services, onboarding, counts) = tokio::try_join!(
        sqlx::query_as::<_, Company>(
            "select c.id, c.name, c.industry, c.category, c.market, c.country, c.region, c.city, c.address, c.website_url,
                    c.facebook_url, c.instagram_url, c.linkedin_url, c.google_maps_url, c.phone, c.email
             from public.companies c join public.clients cl on cl.company_id = c.id where cl.id = $1",
        )
        .bind(id)
        .fetch_one(db),
        sqlx::query_as::<_, Contact>(
            "select ct.id, ct.full_name, ct.position, ct.email, ct.phone, ct.is_primary, ct.notes
             from public.contacts ct join public.clients cl on cl.company_id = ct.company_id
             where cl.id = $1 and ct.deleted_at is null order by ct.is_primary desc, ct.created_at",
        )
        .bind(id)
        .fetch_all(db),
        sqlx::query_as::<_, ClientService>(
            "select id, service_id, name, price, currency, billing_type, status, start_date, end_date, notes
             from public.client_services where client_id = $1
             order by case status when 'active' then 0 when 'paused' then 1 else 2 end, created_at",
        )
        .bind(id)
        .fetch_all(db),
        sqlx::query_as::<_, OnboardingItem>(
            "select t.id, t.title, t.status, p.full_name as assignee_name, t.due_at
             from public.tasks t left join public.profiles p on p.id = t.assignee_id
             where t.client_id = $1 and t.project_id is null and t.deleted_at is null and t.description = 'onboarding'
             order by t.position, t.created_at",
        )
        .bind(id)
        .fetch_all(db),
        sqlx::query_as::<_, Counts>(
            "select
               (select count(*) from public.contracts where client_id = $1 and deleted_at is null) as contracts,
               (select count(*) from public.projects where client_id = $1 and deleted_at is null) as projects,
               (select count(*) from public.tasks where client_id = $1 and deleted_at is null and status <> 'done') as open_tasks,
               (select count(*) from public.websites where client_id = $1 and deleted_at is null) as websites,
               (select count(*) from public.files where entity_type = 'client' and entity_id = $1 and deleted_at is null) as files,
               (select count(*) from public.content_posts where client_id = $1 and deleted_at is null) as content_posts",
        )
        .bind(id)
        .fetch_one(db),
    )?;

    let mut monthly_value = BTreeMap::new();
    for s in services.iter().filter(|s| s.status == "active") {
        let per_month = match s.billing_type.as_str() {
            "monthly" => s.price,
            "quarterly" => (s.price / Decimal::from(3)).round_dp(2),
            "yearly" => (s.price / Decimal::from(12)).round_dp(2),
            _ => continue,
        };
        *monthly_value.entry(s.currency.clone()).or_insert(Decimal::ZERO) += per_month;
    }
    Ok(ClientDetail { client, company, contacts, services, onboarding, monthly_value, counts })
}

pub async fn get(State(state): State<AppState>, user: AuthUser, Path(id): Path<Uuid>) -> AppResult<Json<ClientDetail>> {
    user.require("clients.view")?;
    Ok(Json(fetch(&state, id).await?))
}

// ---------------------------------------------------------------------------
// Create & update
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct ClientInput {
    /// Business details (same fields as a lead's business).
    #[serde(flatten)]
    business: LeadInput,
    status: Option<String>,
    account_manager_id: Option<Uuid>,
    client_since: Option<NaiveDate>,
    billing_email: Option<String>,
    billing_address: Option<String>,
    billing_notes: Option<String>,
    notes: Option<String>,
    #[serde(default)]
    force: bool,
}

fn validate(input: &ClientInput) -> AppResult<()> {
    let mut v = Validator::new();
    input.business.validate(&mut v);
    if let Some(s) = &input.status {
        v.one_of("status", s, STATUSES);
    }
    if let Some(e) = input.billing_email.as_deref().filter(|e| !e.trim().is_empty()) {
        v.email("billing_email", e);
    }
    v.optional_text("billing_address", input.billing_address.as_deref(), 500);
    v.optional_text("billing_notes", input.billing_notes.as_deref(), 2000);
    v.optional_text("notes", input.notes.as_deref(), 10_000);
    v.finish()
}

/// Adds a client that never went through the pipeline (e.g. an existing customer).
pub async fn create(State(state): State<AppState>, user: AuthUser, Json(input): Json<ClientInput>) -> AppResult<Json<ClientDetail>> {
    user.require("clients.manage")?;
    let input = ClientInput { business: input.business.normalized(), ..input };
    validate(&input)?;
    if !input.force {
        if let Some((_, m)) = duplicates::find_matches(&state.db, std::slice::from_ref(&input.business)).await?.into_iter().next() {
            return Err(AppError::Conflict(format!(
                "{} is already in ODDLY as a lead (same {}). Open it and use “Convert to client” to keep its history.",
                m.business_name, m.matched_by
            )));
        }
    }
    let b = &input.business;
    let mut tx = state.db.begin().await?;
    let company_id: Uuid = sqlx::query_scalar(
        "insert into public.companies (name, industry, category, market, country, region, city, address, website_url,
           facebook_url, instagram_url, linkedin_url, google_maps_url, phone, email, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) returning id",
    )
    .bind(&b.business_name).bind(&b.industry).bind(&b.category).bind(&b.market).bind(&b.country).bind(&b.region)
    .bind(&b.city).bind(&b.address).bind(&b.website_url).bind(&b.facebook_url).bind(&b.instagram_url)
    .bind(&b.linkedin_url).bind(&b.google_maps_url).bind(&b.business_phone).bind(&b.business_email).bind(user.id)
    .fetch_one(&mut *tx)
    .await?;
    if b.has_contact() {
        sqlx::query("insert into public.contacts (company_id, full_name, position, email, phone, is_primary) values ($1,$2,$3,$4,$5,true)")
            .bind(company_id)
            .bind(b.contact_name.clone().unwrap_or_else(|| "Unknown contact".into()))
            .bind(&b.contact_position)
            .bind(&b.contact_email)
            .bind(&b.contact_phone)
            .execute(&mut *tx)
            .await?;
    }
    let id: Uuid = sqlx::query_scalar(
        "insert into public.clients (company_id, status, account_manager_id, client_since, billing_email, billing_address,
           billing_notes, notes, created_by)
         values ($1, coalesce($2, 'onboarding'), coalesce($3, $9), coalesce($4, current_date), $5, $6, $7, $8, $9) returning id",
    )
    .bind(company_id)
    .bind(&input.status)
    .bind(input.account_manager_id)
    .bind(input.client_since)
    .bind(clean(input.billing_email.clone()))
    .bind(clean(input.billing_address.clone()))
    .bind(clean(input.billing_notes.clone()))
    .bind(clean(input.notes.clone()))
    .bind(user.id)
    .fetch_one(&mut *tx)
    .await?;
    audit::activity(&mut *tx, user.id, "client", id, "client.created", &format!("{} added {} as a client", user.full_name, b.business_name)).await?;
    tx.commit().await?;
    Ok(Json(fetch(&state, id).await?))
}

pub async fn update(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Json(input): Json<ClientInput>,
) -> AppResult<Json<ClientDetail>> {
    user.require("clients.manage")?;
    let input = ClientInput { business: input.business.normalized(), ..input };
    validate(&input)?;
    let before = fetch(&state, id).await?;
    let b = &input.business;
    let mut tx = state.db.begin().await?;
    sqlx::query(
        "update public.companies set name=$2, industry=$3, category=$4, market=$5, country=$6, region=$7, city=$8, address=$9,
           website_url=$10, facebook_url=$11, instagram_url=$12, linkedin_url=$13, google_maps_url=$14, phone=$15, email=$16
         where id = $1",
    )
    .bind(before.company.id).bind(&b.business_name).bind(&b.industry).bind(&b.category).bind(&b.market).bind(&b.country)
    .bind(&b.region).bind(&b.city).bind(&b.address).bind(&b.website_url).bind(&b.facebook_url).bind(&b.instagram_url)
    .bind(&b.linkedin_url).bind(&b.google_maps_url).bind(&b.business_phone).bind(&b.business_email)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "update public.clients set status = coalesce($2, status), account_manager_id = $3, client_since = coalesce($4, client_since),
           billing_email = $5, billing_address = $6, billing_notes = $7, notes = $8 where id = $1",
    )
    .bind(id)
    .bind(&input.status)
    .bind(input.account_manager_id)
    .bind(input.client_since)
    .bind(clean(input.billing_email.clone()))
    .bind(clean(input.billing_address.clone()))
    .bind(clean(input.billing_notes.clone()))
    .bind(clean(input.notes.clone()))
    .execute(&mut *tx)
    .await?;
    if let Some(s) = &input.status {
        if *s != before.client.status {
            audit::activity(&mut *tx, user.id, "client", id, "client.status", &format!("{} set {} to {}", user.full_name, b.business_name, s.replace('_', " "))).await?;
        }
    }
    if input.account_manager_id != before.client.account_manager_id {
        audit::activity(&mut *tx, user.id, "client", id, "client.manager", &format!("{} changed the account manager", user.full_name)).await?;
    }
    tx.commit().await?;
    Ok(Json(fetch(&state, id).await?))
}

#[derive(Deserialize)]
pub struct StatusOnly {
    status: String,
}

pub async fn set_status(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Json(input): Json<StatusOnly>,
) -> AppResult<Json<ClientDetail>> {
    user.require("clients.manage")?;
    let mut v = Validator::new();
    v.one_of("status", &input.status, STATUSES);
    v.finish()?;
    let name: String = sqlx::query_scalar(
        "update public.clients cl set status = $2 from public.companies c where cl.id = $1 and c.id = cl.company_id and cl.deleted_at is null returning c.name",
    )
    .bind(id)
    .bind(&input.status)
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::NotFound)?;
    audit::activity(&state.db, user.id, "client", id, "client.status", &format!("{} set {name} to {}", user.full_name, input.status.replace('_', " "))).await?;
    Ok(Json(fetch(&state, id).await?))
}

pub async fn remove(State(state): State<AppState>, user: AuthUser, Path(id): Path<Uuid>) -> AppResult<StatusCode> {
    user.require("clients.manage")?;
    sqlx::query("update public.clients set deleted_at = now() where id = $1").bind(id).execute(&state.db).await?;
    audit::record(&state.db, AuditEntry { actor_id: Some(user.id), action: "client.deleted", entity_type: Some("client"), entity_id: Some(id), changes: json!({}) }).await?;
    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct ContactInput {
    full_name: String,
    position: Option<String>,
    email: Option<String>,
    phone: Option<String>,
    #[serde(default)]
    is_primary: bool,
    notes: Option<String>,
}

fn validate_contact(c: &ContactInput) -> AppResult<()> {
    let mut v = Validator::new();
    v.text("full_name", &c.full_name, 160);
    v.optional_text("position", c.position.as_deref(), 120);
    v.optional_text("phone", c.phone.as_deref(), 60);
    v.optional_text("notes", c.notes.as_deref(), 2000);
    if let Some(e) = c.email.as_deref().filter(|e| !e.trim().is_empty()) {
        v.email("email", e);
    }
    v.finish()
}

pub async fn add_contact(State(state): State<AppState>, user: AuthUser, Path(id): Path<Uuid>, Json(c): Json<ContactInput>) -> AppResult<Json<ClientDetail>> {
    user.require("clients.manage")?;
    validate_contact(&c)?;
    let mut tx = state.db.begin().await?;
    let company: Uuid = sqlx::query_scalar("select company_id from public.clients where id = $1 and deleted_at is null")
        .bind(id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or(AppError::NotFound)?;
    if c.is_primary {
        sqlx::query("update public.contacts set is_primary = false where company_id = $1").bind(company).execute(&mut *tx).await?;
    }
    sqlx::query("insert into public.contacts (company_id, full_name, position, email, phone, is_primary, notes) values ($1,$2,$3,$4,$5,$6,$7)")
        .bind(company)
        .bind(c.full_name.trim())
        .bind(clean(c.position))
        .bind(clean(c.email).map(|e| e.to_lowercase()))
        .bind(clean(c.phone))
        .bind(c.is_primary)
        .bind(clean(c.notes))
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Json(fetch(&state, id).await?))
}

pub async fn update_contact(
    State(state): State<AppState>,
    user: AuthUser,
    Path((id, contact_id)): Path<(Uuid, Uuid)>,
    Json(c): Json<ContactInput>,
) -> AppResult<Json<ClientDetail>> {
    user.require("clients.manage")?;
    validate_contact(&c)?;
    let mut tx = state.db.begin().await?;
    let company: Uuid = sqlx::query_scalar(
        "select ct.company_id from public.contacts ct join public.clients cl on cl.company_id = ct.company_id
         where ct.id = $1 and cl.id = $2",
    )
    .bind(contact_id)
    .bind(id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(AppError::NotFound)?;
    if c.is_primary {
        sqlx::query("update public.contacts set is_primary = false where company_id = $1").bind(company).execute(&mut *tx).await?;
    }
    sqlx::query("update public.contacts set full_name=$2, position=$3, email=$4, phone=$5, is_primary=$6, notes=$7 where id = $1")
        .bind(contact_id)
        .bind(c.full_name.trim())
        .bind(clean(c.position))
        .bind(clean(c.email).map(|e| e.to_lowercase()))
        .bind(clean(c.phone))
        .bind(c.is_primary)
        .bind(clean(c.notes))
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Json(fetch(&state, id).await?))
}

pub async fn remove_contact(State(state): State<AppState>, user: AuthUser, Path((id, contact_id)): Path<(Uuid, Uuid)>) -> AppResult<Json<ClientDetail>> {
    user.require("clients.manage")?;
    sqlx::query(
        "update public.contacts ct set deleted_at = now() from public.clients cl
         where ct.id = $1 and cl.id = $2 and cl.company_id = ct.company_id",
    )
    .bind(contact_id)
    .bind(id)
    .execute(&state.db)
    .await?;
    Ok(Json(fetch(&state, id).await?))
}

// ---------------------------------------------------------------------------
// Services purchased
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct ServiceInput {
    service_id: Option<Uuid>,
    name: String,
    price: Decimal,
    currency: String,
    billing_type: String,
    status: Option<String>,
    start_date: Option<NaiveDate>,
    end_date: Option<NaiveDate>,
    notes: Option<String>,
}

fn validate_service(s: &ServiceInput) -> AppResult<()> {
    let mut v = Validator::new();
    v.text("name", &s.name, 200);
    if s.price.is_sign_negative() {
        v.fail("price", "Price can't be negative.");
    }
    if s.currency.len() != 3 || !s.currency.chars().all(|c| c.is_ascii_uppercase()) {
        v.fail("currency", "Use a 3-letter currency code.");
    }
    v.one_of("billing_type", &s.billing_type, crate::routes::sales::proposals::BILLING);
    if let Some(st) = &s.status {
        v.one_of("status", st, &["active", "paused", "cancelled", "completed"]);
    }
    if let (Some(a), Some(b)) = (s.start_date, s.end_date) {
        if b < a {
            v.fail("end_date", "End date is before the start date.");
        }
    }
    v.finish()
}

pub async fn add_service(State(state): State<AppState>, user: AuthUser, Path(id): Path<Uuid>, Json(s): Json<ServiceInput>) -> AppResult<Json<ClientDetail>> {
    user.require("clients.manage")?;
    validate_service(&s)?;
    sqlx::query(
        "insert into public.client_services (client_id, service_id, name, price, currency, billing_type, status, start_date, end_date, notes)
         select $1, $2, $3, $4, $5, $6, coalesce($7, 'active'), coalesce($8, current_date), $9, $10
         where exists (select 1 from public.clients where id = $1 and deleted_at is null)",
    )
    .bind(id).bind(s.service_id).bind(s.name.trim()).bind(s.price).bind(&s.currency).bind(&s.billing_type)
    .bind(&s.status).bind(s.start_date).bind(s.end_date).bind(clean(s.notes.clone()))
    .execute(&state.db)
    .await?;
    audit::activity(&state.db, user.id, "client", id, "client.service_added", &format!("{} added the service {}", user.full_name, s.name.trim())).await?;
    Ok(Json(fetch(&state, id).await?))
}

pub async fn update_service(
    State(state): State<AppState>,
    user: AuthUser,
    Path((id, service_id)): Path<(Uuid, Uuid)>,
    Json(s): Json<ServiceInput>,
) -> AppResult<Json<ClientDetail>> {
    user.require("clients.manage")?;
    validate_service(&s)?;
    let updated = sqlx::query(
        "update public.client_services set service_id=$3, name=$4, price=$5, currency=$6, billing_type=$7,
           status=coalesce($8, status), start_date=$9, end_date=$10, notes=$11
         where id = $1 and client_id = $2",
    )
    .bind(service_id).bind(id).bind(s.service_id).bind(s.name.trim()).bind(s.price).bind(&s.currency)
    .bind(&s.billing_type).bind(&s.status).bind(s.start_date).bind(s.end_date).bind(clean(s.notes.clone()))
    .execute(&state.db)
    .await?;
    if updated.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(Json(fetch(&state, id).await?))
}

pub async fn remove_service(State(state): State<AppState>, user: AuthUser, Path((id, service_id)): Path<(Uuid, Uuid)>) -> AppResult<Json<ClientDetail>> {
    user.require("clients.manage")?;
    sqlx::query("delete from public.client_services where id = $1 and client_id = $2").bind(service_id).bind(id).execute(&state.db).await?;
    Ok(Json(fetch(&state, id).await?))
}

// ---------------------------------------------------------------------------
// Onboarding checklist (tasks without a project, tagged 'onboarding')
// ---------------------------------------------------------------------------

const ONBOARDING: &[&str] = &[
    "Kickoff meeting with the client",
    "Collect logo, brand colors and fonts",
    "Get access to Facebook / Instagram pages",
    "Get website, domain and hosting access",
    "Confirm billing details and first invoice",
    "Set up the shared folder and communication channel",
    "Agree on the content calendar and approval process",
];

pub async fn start_onboarding(State(state): State<AppState>, user: AuthUser, Path(id): Path<Uuid>) -> AppResult<Json<ClientDetail>> {
    user.require("clients.manage")?;
    let manager: Option<Uuid> = sqlx::query_scalar("select account_manager_id from public.clients where id = $1 and deleted_at is null")
        .bind(id)
        .fetch_optional(&state.db)
        .await?
        .ok_or(AppError::NotFound)?;
    let items: Vec<String> = ONBOARDING.iter().map(|s| (*s).to_owned()).collect();
    sqlx::query(
        "insert into public.tasks (client_id, title, description, status, priority, assignee_id, reporter_id, position)
         select $1, t.title, 'onboarding', 'todo', 'medium', $2, $3, t.ord
         from unnest($4::text[]) with ordinality as t(title, ord)
         where not exists (select 1 from public.tasks where client_id = $1 and description = 'onboarding' and deleted_at is null)",
    )
    .bind(id)
    .bind(manager.unwrap_or(user.id))
    .bind(user.id)
    .bind(&items)
    .execute(&state.db)
    .await?;
    Ok(Json(fetch(&state, id).await?))
}

#[derive(Deserialize)]
pub struct ToggleItem {
    done: bool,
}

pub async fn toggle_onboarding(
    State(state): State<AppState>,
    user: AuthUser,
    Path((id, task_id)): Path<(Uuid, Uuid)>,
    Json(input): Json<ToggleItem>,
) -> AppResult<Json<ClientDetail>> {
    user.require("clients.view")?;
    sqlx::query(
        "update public.tasks set status = case when $3 then 'done' else 'todo' end,
           completed_at = case when $3 then now() else null end
         where id = $1 and client_id = $2 and description = 'onboarding'",
    )
    .bind(task_id)
    .bind(id)
    .bind(input.done)
    .execute(&state.db)
    .await?;
    // When every onboarding item is done, an onboarding client becomes active.
    sqlx::query(
        "update public.clients set status = 'active' where id = $1 and status = 'onboarding'
           and not exists (select 1 from public.tasks where client_id = $1 and description = 'onboarding'
                           and deleted_at is null and status <> 'done')",
    )
    .bind(id)
    .execute(&state.db)
    .await?;
    Ok(Json(fetch(&state, id).await?))
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

#[derive(Serialize, sqlx::FromRow)]
pub struct HistoryItem {
    id: Uuid,
    kind: String,
    summary: String,
    detail: Option<String>,
    actor_name: Option<String>,
    client_id: Option<Uuid>,
    client_name: Option<String>,
    occurred_at: DateTime<Utc>,
}

/// Everything that happened with a client — including its time as a lead.
pub async fn history(State(state): State<AppState>, user: AuthUser, Path(id): Path<Uuid>) -> AppResult<Json<Vec<HistoryItem>>> {
    user.require("clients.view")?;
    let rows = sqlx::query_as::<_, HistoryItem>(
        "with cl as (select id, lead_id, company_id from public.clients where id = $1)
         select a.id, 'activity' as kind, a.summary, null::text as detail, p.full_name as actor_name,
                (select id from cl) as client_id, null::text as client_name, a.created_at as occurred_at
         from public.activities a left join public.profiles p on p.id = a.actor_id
         where (a.entity_type = 'client' and a.entity_id = $1)
            or (a.entity_type = 'lead' and a.entity_id = (select lead_id from cl))
         union all
         select i.id, 'interaction', initcap(replace(i.channel, '_', ' ')) || case i.direction when 'inbound' then ' (incoming)' else '' end,
                coalesce(i.subject || ': ', '') || coalesce(i.body, ''), p.full_name, (select id from cl), null, i.occurred_at
         from public.lead_interactions i left join public.profiles p on p.id = i.user_id
         where i.lead_id = (select lead_id from cl)
         order by occurred_at desc
         limit 200",
    )
    .bind(id)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(rows))
}

#[derive(Deserialize)]
pub struct FeedQuery {
    client_id: Option<Uuid>,
    page: Option<i64>,
}

/// Recent client activity across the agency.
pub async fn feed(State(state): State<AppState>, user: AuthUser, Query(q): Query<FeedQuery>) -> AppResult<Json<Page<HistoryItem>>> {
    user.require("clients.view")?;
    let (page, per_page, offset) = paging(q.page, Some(50), 50);
    let (items, total) = tokio::try_join!(
        sqlx::query_as::<_, HistoryItem>(
            "select a.id, 'activity' as kind, a.summary, null::text as detail, p.full_name as actor_name,
                    cl.id as client_id, c.name as client_name, a.created_at as occurred_at
             from public.activities a
             join public.clients cl on cl.id = a.entity_id and a.entity_type = 'client'
             join public.companies c on c.id = cl.company_id
             left join public.profiles p on p.id = a.actor_id
             where cl.deleted_at is null and ($1::uuid is null or cl.id = $1)
             order by a.created_at desc limit $2 offset $3",
        )
        .bind(q.client_id)
        .bind(per_page)
        .bind(offset)
        .fetch_all(&state.db),
        sqlx::query_scalar::<_, i64>(
            "select count(*) from public.activities a join public.clients cl on cl.id = a.entity_id and a.entity_type = 'client'
             where cl.deleted_at is null and ($1::uuid is null or cl.id = $1)",
        )
        .bind(q.client_id)
        .fetch_one(&state.db),
    )?;
    Ok(Json(Page { items, total, page, per_page }))
}
