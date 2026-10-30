//! Website management: client sites, renewals, maintenance, uptime checks and the
//! encrypted credential vault.

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::{Postgres, QueryBuilder};
use uuid::Uuid;

use super::common::{like_pattern, non_empty};
use crate::{
    audit::{self, AuditEntry},
    auth::AuthUser,
    error::{AppError, AppResult},
    monitor,
    state::AppState,
    validate::{clean, Validator},
    vault::KEY_VERSION,
};

#[derive(Serialize, sqlx::FromRow)]
pub struct Website {
    id: Uuid,
    client_id: Uuid,
    client_name: String,
    name: String,
    domain: String,
    url: Option<String>,
    status: String,
    hosting_provider: Option<String>,
    tech_stack: Vec<String>,
    domain_registrar: Option<String>,
    domain_expires_on: Option<NaiveDate>,
    hosting_renews_on: Option<NaiveDate>,
    ssl_expires_on: Option<NaiveDate>,
    maintenance_frequency: String,
    developer_id: Option<Uuid>,
    developer_name: Option<String>,
    backup_notes: Option<String>,
    notes: Option<String>,
    last_checked_at: Option<DateTime<Utc>>,
    last_status_code: Option<i32>,
    is_up: Option<bool>,
    uptime_7d: Option<f64>,
    avg_response_ms: Option<f64>,
    open_maintenance: i64,
    last_maintenance_at: Option<DateTime<Utc>>,
    created_at: DateTime<Utc>,
}

const SELECT: &str = "select w.id, w.client_id, co.name as client_name, w.name, w.domain, w.url, w.status, w.hosting_provider,
    w.tech_stack, w.domain_registrar, w.domain_expires_on, w.hosting_renews_on, w.ssl_expires_on, w.maintenance_frequency,
    w.developer_id, d.full_name as developer_name, w.backup_notes, w.notes, w.last_checked_at, w.last_status_code,
    (select c.ok from public.website_checks c where c.website_id = w.id order by c.checked_at desc limit 1) as is_up,
    (select round(100.0 * avg(case when c.ok then 1 else 0 end), 2)::float8 from public.website_checks c
       where c.website_id = w.id and c.checked_at > now() - interval '7 days') as uptime_7d,
    (select avg(c.response_ms)::float8 from public.website_checks c where c.website_id = w.id and c.ok
       and c.checked_at > now() - interval '24 hours') as avg_response_ms,
    (select count(*) from public.website_maintenance m where m.website_id = w.id and m.status in ('scheduled','in_progress')) as open_maintenance,
    (select max(m.completed_at) from public.website_maintenance m where m.website_id = w.id) as last_maintenance_at,
    w.created_at
  from public.websites w
  join public.clients cl on cl.id = w.client_id
  join public.companies co on co.id = cl.company_id
  left join public.profiles d on d.id = w.developer_id";

#[derive(Deserialize, Default)]
pub struct WebsiteQuery {
    client_id: Option<Uuid>,
    status: Option<String>,
    search: Option<String>,
    /// Domain, hosting or SSL renewal within this many days.
    expiring_days: Option<i32>,
}

pub async fn list(State(state): State<AppState>, user: AuthUser, Query(q): Query<WebsiteQuery>) -> AppResult<Json<Vec<Website>>> {
    user.require("websites.view")?;
    let mut qb = QueryBuilder::<Postgres>::new(format!("{SELECT} where w.deleted_at is null and cl.deleted_at is null"));
    if let Some(v) = q.client_id {
        qb.push(" and w.client_id = ").push_bind(v);
    }
    match non_empty(&q.status) {
        Some("all") => {}
        Some(s) => {
            qb.push(" and w.status = ").push_bind(s.to_owned());
        }
        None => {
            qb.push(" and w.status <> 'archived'");
        }
    }
    if let Some(t) = non_empty(&q.search) {
        let p = like_pattern(t);
        qb.push(" and (w.name ilike ").push_bind(p.clone()).push(" or w.domain ilike ").push_bind(p.clone())
            .push(" or co.name ilike ").push_bind(p).push(")");
    }
    if let Some(days) = q.expiring_days {
        qb.push(" and least(w.domain_expires_on, w.hosting_renews_on, w.ssl_expires_on) <= current_date + ").push_bind(days);
    }
    qb.push(" order by lower(co.name), lower(w.name)");
    Ok(Json(qb.build_query_as::<Website>().fetch_all(&state.db).await?))
}

async fn fetch(state: &AppState, id: Uuid) -> AppResult<Website> {
    sqlx::query_as::<_, Website>(&format!("{SELECT} where w.id = $1 and w.deleted_at is null"))
        .bind(id)
        .fetch_optional(&state.db)
        .await?
        .ok_or(AppError::NotFound)
}

#[derive(Serialize, sqlx::FromRow)]
pub struct Check {
    checked_at: DateTime<Utc>,
    ok: bool,
    status_code: Option<i32>,
    response_ms: Option<i32>,
    error: Option<String>,
}

#[derive(Serialize)]
pub struct WebsiteDetail {
    #[serde(flatten)]
    website: Website,
    checks: Vec<Check>,
    secrets: Vec<SecretMeta>,
    vault_configured: bool,
}

async fn detail(state: &AppState, user: &AuthUser, id: Uuid) -> AppResult<WebsiteDetail> {
    let website = fetch(state, id).await?;
    let checks = sqlx::query_as::<_, Check>(
        "select checked_at, ok, status_code, response_ms, error from public.website_checks where website_id = $1 order by checked_at desc limit 100",
    )
    .bind(id)
    .fetch_all(&state.db)
    .await?;
    let secrets = if user.can("websites.secrets") { secret_list(state, id).await? } else { Vec::new() };
    Ok(WebsiteDetail { website, checks, secrets, vault_configured: state.vault.is_some() })
}

pub async fn get(State(state): State<AppState>, user: AuthUser, Path(id): Path<Uuid>) -> AppResult<Json<WebsiteDetail>> {
    user.require("websites.view")?;
    Ok(Json(detail(&state, &user, id).await?))
}

#[derive(Deserialize)]
pub struct WebsiteInput {
    client_id: Uuid,
    name: String,
    domain: String,
    url: Option<String>,
    status: Option<String>,
    hosting_provider: Option<String>,
    #[serde(default)]
    tech_stack: Vec<String>,
    domain_registrar: Option<String>,
    domain_expires_on: Option<NaiveDate>,
    hosting_renews_on: Option<NaiveDate>,
    ssl_expires_on: Option<NaiveDate>,
    maintenance_frequency: Option<String>,
    developer_id: Option<Uuid>,
    backup_notes: Option<String>,
    notes: Option<String>,
}

fn normalize_domain(d: &str) -> String {
    let d = d.trim().to_lowercase();
    let d = d.split_once("://").map_or(d.as_str(), |(_, r)| r).to_owned();
    d.trim_start_matches("www.").split(['/', '?', '#']).next().unwrap_or("").to_owned()
}

fn validate(i: &WebsiteInput) -> AppResult<String> {
    let mut v = Validator::new();
    v.text("name", &i.name, 200);
    let domain = normalize_domain(&i.domain);
    if domain.is_empty() || !domain.contains('.') || domain.len() > 253 {
        v.fail("domain", "Enter a domain like example.com.");
    }
    v.optional_text("url", i.url.as_deref(), 500);
    if let Some(s) = &i.status {
        v.one_of("status", s, &["in_development", "active", "paused", "archived"]);
    }
    if let Some(m) = &i.maintenance_frequency {
        v.one_of("maintenance_frequency", m, &["none", "weekly", "monthly", "quarterly"]);
    }
    v.optional_text("backup_notes", i.backup_notes.as_deref(), 5000);
    v.optional_text("notes", i.notes.as_deref(), 10_000);
    v.finish()?;
    Ok(domain)
}

pub async fn create(State(state): State<AppState>, user: AuthUser, Json(i): Json<WebsiteInput>) -> AppResult<Json<WebsiteDetail>> {
    user.require("websites.manage")?;
    let domain = validate(&i)?;
    let id: Uuid = sqlx::query_scalar(
        "insert into public.websites (client_id, name, domain, url, status, hosting_provider, tech_stack, domain_registrar,
           domain_expires_on, hosting_renews_on, ssl_expires_on, maintenance_frequency, developer_id, backup_notes, notes)
         values ($1,$2,$3,coalesce($4, 'https://' || $3),coalesce($5,'active'),$6,$7,$8,$9,$10,$11,coalesce($12,'monthly'),$13,$14,$15)
         returning id",
    )
    .bind(i.client_id).bind(i.name.trim()).bind(&domain).bind(clean(i.url.clone())).bind(&i.status)
    .bind(clean(i.hosting_provider.clone())).bind(&i.tech_stack).bind(clean(i.domain_registrar.clone()))
    .bind(i.domain_expires_on).bind(i.hosting_renews_on).bind(i.ssl_expires_on).bind(&i.maintenance_frequency)
    .bind(i.developer_id).bind(clean(i.backup_notes.clone())).bind(clean(i.notes.clone()))
    .fetch_one(&state.db)
    .await
    .map_err(|e| match AppError::from(e) {
        AppError::Conflict(_) => AppError::Conflict(format!("{domain} is already in ODDLY.")),
        other => other,
    })?;
    audit::activity(&state.db, user.id, "client", i.client_id, "website.added", &format!("{} added the website {domain}", user.full_name)).await?;
    Ok(Json(detail(&state, &user, id).await?))
}

pub async fn update(State(state): State<AppState>, user: AuthUser, Path(id): Path<Uuid>, Json(i): Json<WebsiteInput>) -> AppResult<Json<WebsiteDetail>> {
    user.require("websites.manage")?;
    let domain = validate(&i)?;
    let updated = sqlx::query(
        "update public.websites set client_id=$2, name=$3, domain=$4, url=coalesce($5, 'https://' || $4), status=coalesce($6,status),
           hosting_provider=$7, tech_stack=$8, domain_registrar=$9, domain_expires_on=$10, hosting_renews_on=$11,
           ssl_expires_on=$12, maintenance_frequency=coalesce($13, maintenance_frequency), developer_id=$14,
           backup_notes=$15, notes=$16
         where id = $1 and deleted_at is null",
    )
    .bind(id).bind(i.client_id).bind(i.name.trim()).bind(&domain).bind(clean(i.url.clone())).bind(&i.status)
    .bind(clean(i.hosting_provider.clone())).bind(&i.tech_stack).bind(clean(i.domain_registrar.clone()))
    .bind(i.domain_expires_on).bind(i.hosting_renews_on).bind(i.ssl_expires_on).bind(&i.maintenance_frequency)
    .bind(i.developer_id).bind(clean(i.backup_notes.clone())).bind(clean(i.notes.clone()))
    .execute(&state.db)
    .await?;
    if updated.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(Json(detail(&state, &user, id).await?))
}

pub async fn remove(State(state): State<AppState>, user: AuthUser, Path(id): Path<Uuid>) -> AppResult<StatusCode> {
    user.require("websites.manage")?;
    sqlx::query("update public.websites set deleted_at = now() where id = $1").bind(id).execute(&state.db).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Runs an uptime check right now.
pub async fn check_now(State(state): State<AppState>, user: AuthUser, Path(id): Path<Uuid>) -> AppResult<Json<WebsiteDetail>> {
    user.require("websites.view")?;
    let w = fetch(&state, id).await?;
    let url = w.url.clone().unwrap_or_else(|| format!("https://{}", w.domain));
    monitor::check_one(&state.db, &state.monitor_http, id, &url).await?;
    Ok(Json(detail(&state, &user, id).await?))
}

// ---------------------------------------------------------------------------
// Maintenance
// ---------------------------------------------------------------------------

pub const TASK_TYPES: &[&str] = &[
    "content_update", "plugin_update", "security_check", "backup", "performance_check", "uptime_check",
    "ssl_renewal", "domain_renewal", "hosting_renewal", "other",
];

#[derive(Serialize, sqlx::FromRow)]
pub struct Maintenance {
    id: Uuid,
    website_id: Uuid,
    website_name: String,
    domain: String,
    client_name: String,
    task_type: String,
    title: String,
    notes: Option<String>,
    status: String,
    scheduled_for: Option<NaiveDate>,
    assigned_to: Option<Uuid>,
    assigned_name: Option<String>,
    completed_at: Option<DateTime<Utc>>,
    completed_by_name: Option<String>,
    overdue: bool,
    created_at: DateTime<Utc>,
}

const M_SELECT: &str = "select m.id, m.website_id, w.name as website_name, w.domain, co.name as client_name, m.task_type, m.title,
    m.notes, m.status, m.scheduled_for, m.assigned_to, a.full_name as assigned_name, m.completed_at, cb.full_name as completed_by_name,
    (m.status in ('scheduled','in_progress') and coalesce(m.scheduled_for < current_date, false)) as overdue, m.created_at
  from public.website_maintenance m
  join public.websites w on w.id = m.website_id
  join public.clients cl on cl.id = w.client_id
  join public.companies co on co.id = cl.company_id
  left join public.profiles a on a.id = m.assigned_to
  left join public.profiles cb on cb.id = m.completed_by";

#[derive(Deserialize, Default)]
pub struct MaintenanceQuery {
    website_id: Option<Uuid>,
    /// `open` (default), `done` or `all`.
    status: Option<String>,
    assignee: Option<String>,
}

pub async fn maintenance(State(state): State<AppState>, user: AuthUser, Query(q): Query<MaintenanceQuery>) -> AppResult<Json<Vec<Maintenance>>> {
    user.require("websites.view")?;
    let mut qb = QueryBuilder::<Postgres>::new(format!("{M_SELECT} where w.deleted_at is null"));
    if let Some(v) = q.website_id {
        qb.push(" and m.website_id = ").push_bind(v);
    }
    match non_empty(&q.status) {
        Some("all") => {}
        Some("done") => {
            qb.push(" and m.status in ('done','skipped')");
        }
        _ => {
            qb.push(" and m.status in ('scheduled','in_progress')");
        }
    }
    if non_empty(&q.assignee) == Some("me") {
        qb.push(" and m.assigned_to = ").push_bind(user.id);
    }
    qb.push(" order by case when m.status in ('scheduled','in_progress') then 0 else 1 end, m.scheduled_for nulls last, m.completed_at desc nulls last limit 500");
    Ok(Json(qb.build_query_as::<Maintenance>().fetch_all(&state.db).await?))
}

#[derive(Deserialize)]
pub struct MaintenanceInput {
    task_type: String,
    title: String,
    notes: Option<String>,
    status: Option<String>,
    scheduled_for: Option<NaiveDate>,
    assigned_to: Option<Uuid>,
}

fn validate_m(i: &MaintenanceInput) -> AppResult<()> {
    let mut v = Validator::new();
    v.one_of("task_type", &i.task_type, TASK_TYPES);
    v.text("title", &i.title, 200);
    v.optional_text("notes", i.notes.as_deref(), 5000);
    if let Some(s) = &i.status {
        v.one_of("status", s, &["scheduled", "in_progress", "done", "skipped"]);
    }
    v.finish()
}

pub async fn add_maintenance(State(state): State<AppState>, user: AuthUser, Path(id): Path<Uuid>, Json(i): Json<MaintenanceInput>) -> AppResult<StatusCode> {
    user.require("websites.manage")?;
    validate_m(&i)?;
    sqlx::query(
        "insert into public.website_maintenance (website_id, task_type, title, notes, status, scheduled_for, assigned_to,
           completed_at, completed_by)
         select $1,$2,$3,$4,coalesce($5,'scheduled'),$6,coalesce($7, w.developer_id),
           case when $5 = 'done' then now() end, case when $5 = 'done' then $8 end
         from public.websites w where w.id = $1 and w.deleted_at is null",
    )
    .bind(id).bind(&i.task_type).bind(i.title.trim()).bind(clean(i.notes.clone())).bind(&i.status)
    .bind(i.scheduled_for).bind(i.assigned_to).bind(user.id)
    .execute(&state.db)
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn update_maintenance(State(state): State<AppState>, user: AuthUser, Path(id): Path<Uuid>, Json(i): Json<MaintenanceInput>) -> AppResult<StatusCode> {
    user.require("websites.manage")?;
    validate_m(&i)?;
    sqlx::query(
        "update public.website_maintenance set task_type=$2, title=$3, notes=$4, status=coalesce($5,status), scheduled_for=$6,
           assigned_to=$7,
           completed_at = case when coalesce($5,status) in ('done','skipped') then coalesce(completed_at, now()) else null end,
           completed_by = case when coalesce($5,status) in ('done','skipped') then coalesce(completed_by, $8) else null end
         where id = $1",
    )
    .bind(id).bind(&i.task_type).bind(i.title.trim()).bind(clean(i.notes.clone())).bind(&i.status)
    .bind(i.scheduled_for).bind(i.assigned_to).bind(user.id)
    .execute(&state.db)
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn remove_maintenance(State(state): State<AppState>, user: AuthUser, Path(id): Path<Uuid>) -> AppResult<StatusCode> {
    user.require("websites.manage")?;
    sqlx::query("delete from public.website_maintenance where id = $1").bind(id).execute(&state.db).await?;
    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------------------
// Credential vault (websites.secrets)
// ---------------------------------------------------------------------------

#[derive(Serialize, sqlx::FromRow)]
pub struct SecretMeta {
    id: Uuid,
    label: String,
    login_url: Option<String>,
    username: Option<String>,
    created_by_name: Option<String>,
    updated_at: DateTime<Utc>,
}

async fn secret_list(state: &AppState, website_id: Uuid) -> AppResult<Vec<SecretMeta>> {
    Ok(sqlx::query_as::<_, SecretMeta>(
        "select s.id, s.label, s.login_url, s.username, p.full_name as created_by_name, s.updated_at
         from public.website_secrets s left join public.profiles p on p.id = s.created_by
         where s.website_id = $1 order by lower(s.label)",
    )
    .bind(website_id)
    .fetch_all(&state.db)
    .await?)
}

#[derive(Deserialize)]
pub struct SecretInput {
    label: String,
    login_url: Option<String>,
    username: Option<String>,
    /// Required when creating; omit to keep the stored secret when editing.
    secret: Option<String>,
}

fn vault(state: &AppState) -> AppResult<&crate::vault::Vault> {
    state.vault.as_deref().ok_or_else(|| AppError::BadRequest("The credential vault isn't configured: set SECRETS_KEY on the server.".into()))
}

fn validate_secret(i: &SecretInput, creating: bool) -> AppResult<()> {
    let mut v = Validator::new();
    v.text("label", &i.label, 120);
    v.optional_text("login_url", i.login_url.as_deref(), 1000);
    v.optional_text("username", i.username.as_deref(), 300);
    match i.secret.as_deref() {
        Some(s) if s.chars().count() > 4000 => v.fail("secret", "Too long."),
        None | Some("") if creating => v.fail("secret", "Enter the password or key to store."),
        _ => {}
    }
    v.finish()
}

pub async fn add_secret(State(state): State<AppState>, user: AuthUser, Path(id): Path<Uuid>, Json(i): Json<SecretInput>) -> AppResult<Json<Vec<SecretMeta>>> {
    user.require("websites.secrets")?;
    user.require("websites.manage")?;
    validate_secret(&i, true)?;
    let (ct, nonce) = vault(&state)?.encrypt(i.secret.as_deref().unwrap_or_default())?;
    let secret_id: Uuid = sqlx::query_scalar(
        "insert into public.website_secrets (website_id, label, login_url, username, secret_ciphertext, secret_nonce, key_version, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8) returning id",
    )
    .bind(id).bind(i.label.trim()).bind(clean(i.login_url.clone())).bind(clean(i.username.clone()))
    .bind(&ct).bind(&nonce).bind(KEY_VERSION).bind(user.id)
    .fetch_one(&state.db)
    .await?;
    audit::record(&state.db, AuditEntry { actor_id: Some(user.id), action: "secret.created", entity_type: Some("website_secret"), entity_id: Some(secret_id), changes: json!({ "website_id": id, "label": i.label.trim() }) }).await?;
    Ok(Json(secret_list(&state, id).await?))
}

pub async fn update_secret(State(state): State<AppState>, user: AuthUser, Path(secret_id): Path<Uuid>, Json(i): Json<SecretInput>) -> AppResult<Json<Vec<SecretMeta>>> {
    user.require("websites.secrets")?;
    user.require("websites.manage")?;
    validate_secret(&i, false)?;
    let encrypted = match i.secret.as_deref().filter(|s| !s.is_empty()) {
        Some(s) => Some(vault(&state)?.encrypt(s)?),
        None => None,
    };
    let website_id: Uuid = sqlx::query_scalar(
        "update public.website_secrets set label=$2, login_url=$3, username=$4,
           secret_ciphertext = coalesce($5, secret_ciphertext), secret_nonce = coalesce($6, secret_nonce),
           key_version = case when $5 is null then key_version else $7 end
         where id = $1 returning website_id",
    )
    .bind(secret_id).bind(i.label.trim()).bind(clean(i.login_url.clone())).bind(clean(i.username.clone()))
    .bind(encrypted.as_ref().map(|e| e.0.clone())).bind(encrypted.as_ref().map(|e| e.1.clone())).bind(KEY_VERSION)
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::NotFound)?;
    audit::record(&state.db, AuditEntry { actor_id: Some(user.id), action: "secret.updated", entity_type: Some("website_secret"), entity_id: Some(secret_id), changes: json!({ "secret_changed": encrypted.is_some() }) }).await?;
    Ok(Json(secret_list(&state, website_id).await?))
}

#[derive(Serialize)]
pub struct Revealed {
    secret: String,
}

/// Decrypts one credential for the requester. Every reveal is audited.
pub async fn reveal_secret(State(state): State<AppState>, user: AuthUser, Path(secret_id): Path<Uuid>) -> AppResult<Json<Revealed>> {
    user.require("websites.secrets")?;
    let (ct, nonce, website_id): (Vec<u8>, Vec<u8>, Uuid) =
        sqlx::query_as("select secret_ciphertext, secret_nonce, website_id from public.website_secrets where id = $1")
            .bind(secret_id)
            .fetch_optional(&state.db)
            .await?
            .ok_or(AppError::NotFound)?;
    let secret = vault(&state)?.decrypt(&ct, &nonce)?;
    audit::record(&state.db, AuditEntry { actor_id: Some(user.id), action: "secret.revealed", entity_type: Some("website_secret"), entity_id: Some(secret_id), changes: json!({ "website_id": website_id }) }).await?;
    Ok(Json(Revealed { secret }))
}

pub async fn remove_secret(State(state): State<AppState>, user: AuthUser, Path(secret_id): Path<Uuid>) -> AppResult<StatusCode> {
    user.require("websites.secrets")?;
    user.require("websites.manage")?;
    sqlx::query("delete from public.website_secrets where id = $1").bind(secret_id).execute(&state.db).await?;
    audit::record(&state.db, AuditEntry { actor_id: Some(user.id), action: "secret.deleted", entity_type: Some("website_secret"), entity_id: Some(secret_id), changes: json!({}) }).await?;
    Ok(StatusCode::NO_CONTENT)
}
