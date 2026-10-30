//! Lead management: list/filter, detail, create, edit, delete, bulk actions, export.

pub mod duplicates;
pub mod import;
pub mod lists;
pub mod research;

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::{PgPool, Postgres, QueryBuilder};
use uuid::Uuid;

use super::common::{like_pattern, non_empty, paging, Page};
use crate::{
    audit::{self, AuditEntry},
    auth::AuthUser,
    error::{AppError, AppResult},
    state::AppState,
    validate::{clean, Validator},
};

pub const PRIORITIES: &[&str] = &["low", "medium", "high", "urgent"];
pub const STATUSES: &[&str] = &["active", "converted", "disqualified", "archived"];
pub const MARKETS: &[&str] = &["local", "international"];

/// Columns read from `public.lead_overview`.
pub const LEAD_COLUMNS: &str = "lo.id, lo.company_id, lo.primary_contact_id, lo.business_name, lo.industry, lo.category,
    lo.market, lo.country, lo.region, lo.city, lo.address, lo.website_url, lo.facebook_url, lo.instagram_url,
    lo.linkedin_url, lo.google_maps_url, lo.business_phone, lo.business_email, lo.contact_name, lo.contact_position,
    lo.contact_email, lo.contact_phone, lo.source_id, lo.source_name, lo.source_detail, lo.stage_id, lo.stage_name,
    lo.stage_color, lo.stage_kind, lo.status, lo.priority, lo.assigned_to, lo.assigned_name, lo.potential_services,
    lo.estimated_value, lo.currency, lo.research_notes, lo.next_action, lo.next_action_due_at, lo.last_contacted_at,
    lo.converted_at, lo.lost_reason, lo.created_at, lo.updated_at";

#[derive(Serialize, sqlx::FromRow, Clone)]
pub struct LeadRow {
    pub id: Uuid,
    pub company_id: Uuid,
    pub primary_contact_id: Option<Uuid>,
    pub business_name: String,
    pub industry: Option<String>,
    pub category: Option<String>,
    pub market: String,
    pub country: Option<String>,
    pub region: Option<String>,
    pub city: Option<String>,
    pub address: Option<String>,
    pub website_url: Option<String>,
    pub facebook_url: Option<String>,
    pub instagram_url: Option<String>,
    pub linkedin_url: Option<String>,
    pub google_maps_url: Option<String>,
    pub business_phone: Option<String>,
    pub business_email: Option<String>,
    pub contact_name: Option<String>,
    pub contact_position: Option<String>,
    pub contact_email: Option<String>,
    pub contact_phone: Option<String>,
    pub source_id: Option<Uuid>,
    pub source_name: Option<String>,
    pub source_detail: Option<String>,
    pub stage_id: Uuid,
    pub stage_name: String,
    pub stage_color: String,
    pub stage_kind: String,
    pub status: String,
    pub priority: String,
    pub assigned_to: Option<Uuid>,
    pub assigned_name: Option<String>,
    pub potential_services: Vec<String>,
    pub estimated_value: Option<Decimal>,
    pub currency: String,
    pub research_notes: Option<String>,
    pub next_action: Option<String>,
    pub next_action_due_at: Option<DateTime<Utc>>,
    pub last_contacted_at: Option<DateTime<Utc>>,
    pub converted_at: Option<DateTime<Utc>>,
    pub lost_reason: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

// ---------------------------------------------------------------------------
// Visibility & filters
// ---------------------------------------------------------------------------

/// Record-level access: without `leads.view_all`, a user sees leads assigned to them
/// and leads in lead lists they are assigned to.
pub fn push_scope(qb: &mut QueryBuilder<'_, Postgres>, user: &AuthUser, alias: &str) {
    if user.can("leads.view_all") {
        return;
    }
    qb.push(format!(" and ({alias}.assigned_to = "))
        .push_bind(user.id)
        .push(format!(
            " or exists (select 1 from public.lead_list_members m
                join public.lead_list_assignees a on a.list_id = m.list_id
                where m.lead_id = {alias}.id and a.user_id = "
        ))
        .push_bind(user.id)
        .push("))");
}

/// Fails with 404 unless the lead exists and the user may see it.
pub async fn ensure_visible(db: &PgPool, user: &AuthUser, lead_id: Uuid) -> AppResult<()> {
    let mut qb = QueryBuilder::<Postgres>::new("select exists (select 1 from public.leads l where l.deleted_at is null and l.id = ");
    qb.push_bind(lead_id);
    push_scope(&mut qb, user, "l");
    qb.push(")");
    let visible: bool = qb.build_query_scalar().fetch_one(db).await?;
    if visible {
        Ok(())
    } else {
        Err(AppError::NotFound)
    }
}

#[derive(Deserialize, Default, Clone)]
pub struct LeadFilters {
    pub search: Option<String>,
    pub market: Option<String>,
    pub status: Option<String>,
    pub stage_id: Option<Uuid>,
    pub source_id: Option<Uuid>,
    /// A member id, `me`, or `unassigned`.
    pub assigned: Option<String>,
    pub list_id: Option<Uuid>,
    pub priority: Option<String>,
    pub country: Option<String>,
    pub industry: Option<String>,
    /// Active leads not contacted in this many days (or never).
    pub stale_days: Option<i32>,
    /// `true` = has research, `false` = not researched yet.
    pub researched: Option<bool>,
    pub sort: Option<String>,
    pub dir: Option<String>,
    pub page: Option<i64>,
    pub per_page: Option<i64>,
}

fn push_filters(qb: &mut QueryBuilder<'_, Postgres>, f: &LeadFilters, user: &AuthUser) {
    qb.push(" where lo.deleted_at is null");
    push_scope(qb, user, "lo");

    if let Some(term) = non_empty(&f.search) {
        let pat = like_pattern(term);
        qb.push(" and (lo.business_name ilike ").push_bind(pat.clone());
        qb.push(" or lo.contact_name ilike ").push_bind(pat.clone());
        qb.push(" or lo.city ilike ").push_bind(pat.clone());
        qb.push(" or lo.contact_email ilike ").push_bind(pat.clone());
        qb.push(" or lo.business_email ilike ").push_bind(pat.clone());
        qb.push(" or lo.website_url ilike ").push_bind(pat.clone());
        qb.push(" or lo.industry ilike ").push_bind(pat);
        qb.push(")");
    }
    if let Some(v) = non_empty(&f.market) {
        qb.push(" and lo.market = ").push_bind(v.to_owned());
    }
    if let Some(v) = non_empty(&f.status) {
        qb.push(" and lo.status = ").push_bind(v.to_owned());
    }
    if let Some(v) = f.stage_id {
        qb.push(" and lo.stage_id = ").push_bind(v);
    }
    if let Some(v) = f.source_id {
        qb.push(" and lo.source_id = ").push_bind(v);
    }
    match non_empty(&f.assigned) {
        Some("me") => {
            qb.push(" and lo.assigned_to = ").push_bind(user.id);
        }
        Some("unassigned") => {
            qb.push(" and lo.assigned_to is null");
        }
        Some(id) => {
            if let Ok(id) = id.parse::<Uuid>() {
                qb.push(" and lo.assigned_to = ").push_bind(id);
            }
        }
        None => {}
    }
    if let Some(v) = f.list_id {
        qb.push(" and exists (select 1 from public.lead_list_members m where m.lead_id = lo.id and m.list_id = ")
            .push_bind(v)
            .push(")");
    }
    if let Some(v) = non_empty(&f.priority) {
        qb.push(" and lo.priority = ").push_bind(v.to_owned());
    }
    if let Some(v) = non_empty(&f.country) {
        qb.push(" and lower(lo.country) = lower(").push_bind(v.to_owned()).push(")");
    }
    if let Some(v) = non_empty(&f.industry) {
        qb.push(" and lower(lo.industry) = lower(").push_bind(v.to_owned()).push(")");
    }
    if let Some(days) = f.stale_days.filter(|d| *d > 0) {
        qb.push(" and lo.status = 'active' and (lo.last_contacted_at is null or lo.last_contacted_at < now() - make_interval(days => ")
            .push_bind(days)
            .push("))");
    }
    match f.researched {
        Some(true) => {
            qb.push(" and exists (select 1 from public.lead_research r where r.lead_id = lo.id)");
        }
        Some(false) => {
            qb.push(" and not exists (select 1 from public.lead_research r where r.lead_id = lo.id)");
        }
        None => {}
    }
}

fn push_order(qb: &mut QueryBuilder<'_, Postgres>, f: &LeadFilters) {
    let dir = if f.dir.as_deref() == Some("asc") { "asc" } else { "desc" };
    let column = match f.sort.as_deref() {
        Some("business_name") => "lower(lo.business_name)",
        Some("last_contacted_at") => "lo.last_contacted_at",
        Some("next_action_due_at") => "lo.next_action_due_at",
        Some("estimated_value") => "lo.estimated_value",
        Some("updated_at") => "lo.updated_at",
        Some("priority") => "array_position(array['low','medium','high','urgent'], lo.priority)",
        Some("stage") => "(select position from public.pipeline_stages s where s.id = lo.stage_id)",
        _ => "lo.created_at",
    };
    qb.push(format!(" order by {column} {dir} nulls last, lo.id"));
}

// ---------------------------------------------------------------------------
// List, detail, export
// ---------------------------------------------------------------------------

pub async fn list(
    State(state): State<AppState>,
    user: AuthUser,
    Query(f): Query<LeadFilters>,
) -> AppResult<Json<Page<LeadRow>>> {
    user.require("leads.view")?;
    let (page, per_page, offset) = paging(f.page, f.per_page, 200);

    let mut rows_q = QueryBuilder::<Postgres>::new(format!("select {LEAD_COLUMNS} from public.lead_overview lo"));
    push_filters(&mut rows_q, &f, &user);
    push_order(&mut rows_q, &f);
    rows_q.push(" limit ").push_bind(per_page).push(" offset ").push_bind(offset);

    let mut count_q = QueryBuilder::<Postgres>::new("select count(*) from public.lead_overview lo");
    push_filters(&mut count_q, &f, &user);

    let (items, total) = tokio::try_join!(
        rows_q.build_query_as::<LeadRow>().fetch_all(&state.db),
        count_q.build_query_scalar::<i64>().fetch_one(&state.db),
    )?;

    Ok(Json(Page { items, total, page, per_page }))
}

/// Every matching lead (up to 50,000) for spreadsheet export. The file is built client-side.
pub async fn export(
    State(state): State<AppState>,
    user: AuthUser,
    Query(f): Query<LeadFilters>,
) -> AppResult<Json<Vec<LeadRow>>> {
    user.require("leads.export")?;
    let mut qb = QueryBuilder::<Postgres>::new(format!("select {LEAD_COLUMNS} from public.lead_overview lo"));
    push_filters(&mut qb, &f, &user);
    push_order(&mut qb, &f);
    qb.push(" limit 50000");
    let rows = qb.build_query_as::<LeadRow>().fetch_all(&state.db).await?;

    audit::record(
        &state.db,
        AuditEntry {
            actor_id: Some(user.id),
            action: "leads.exported",
            entity_type: None,
            entity_id: None,
            changes: json!({ "rows": rows.len() }),
        },
    )
    .await?;
    Ok(Json(rows))
}

#[derive(Serialize, sqlx::FromRow)]
pub struct ListMembership {
    id: Uuid,
    name: String,
    color: String,
}

#[derive(Serialize, sqlx::FromRow)]
pub struct TimelineItem {
    id: Uuid,
    action: String,
    summary: String,
    actor_name: Option<String>,
    created_at: DateTime<Utc>,
}

#[derive(Serialize)]
pub struct LeadDetail {
    #[serde(flatten)]
    lead: LeadRow,
    lists: Vec<ListMembership>,
    timeline: Vec<TimelineItem>,
    client_id: Option<Uuid>,
}

pub async fn fetch_lead(db: &PgPool, id: Uuid) -> AppResult<LeadRow> {
    Ok(sqlx::query_as::<_, LeadRow>(&format!(
        "select {LEAD_COLUMNS} from public.lead_overview lo where lo.id = $1 and lo.deleted_at is null"
    ))
    .bind(id)
    .fetch_one(db)
    .await?)
}

pub async fn get(State(state): State<AppState>, user: AuthUser, Path(id): Path<Uuid>) -> AppResult<Json<LeadDetail>> {
    user.require("leads.view")?;
    ensure_visible(&state.db, &user, id).await?;
    let db = &state.db;

    let (lead, lists, timeline, client_id) = tokio::try_join!(
        fetch_lead(db, id),
        async {
            Ok::<_, AppError>(
                sqlx::query_as::<_, ListMembership>(
                    "select ll.id, ll.name, ll.color from public.lead_list_members m
                     join public.lead_lists ll on ll.id = m.list_id
                     where m.lead_id = $1 and ll.deleted_at is null order by ll.name",
                )
                .bind(id)
                .fetch_all(db)
                .await?,
            )
        },
        async {
            Ok::<_, AppError>(
                sqlx::query_as::<_, TimelineItem>(
                    "select a.id, a.action, a.summary, p.full_name as actor_name, a.created_at
                     from public.activities a left join public.profiles p on p.id = a.actor_id
                     where a.entity_type = 'lead' and a.entity_id = $1
                     order by a.created_at desc limit 50",
                )
                .bind(id)
                .fetch_all(db)
                .await?,
            )
        },
        async {
            Ok::<_, AppError>(
                sqlx::query_scalar::<_, Uuid>(
                    "select id from public.clients where lead_id = $1 and deleted_at is null",
                )
                .bind(id)
                .fetch_optional(db)
                .await?,
            )
        },
    )?;

    Ok(Json(LeadDetail { lead, lists, timeline, client_id }))
}

// ---------------------------------------------------------------------------
// Create & update
// ---------------------------------------------------------------------------

/// Everything a lead form (or an imported spreadsheet row) can set. Missing fields default
/// to empty so a bad spreadsheet row fails its own validation instead of the whole batch.
#[derive(Deserialize, Default, Clone, Debug)]
#[serde(default)]
pub struct LeadInput {
    pub business_name: String,
    pub industry: Option<String>,
    pub category: Option<String>,
    pub market: String,
    pub country: Option<String>,
    pub region: Option<String>,
    pub city: Option<String>,
    pub address: Option<String>,
    pub website_url: Option<String>,
    pub facebook_url: Option<String>,
    pub instagram_url: Option<String>,
    pub linkedin_url: Option<String>,
    pub google_maps_url: Option<String>,
    pub business_phone: Option<String>,
    pub business_email: Option<String>,
    pub contact_name: Option<String>,
    pub contact_position: Option<String>,
    pub contact_email: Option<String>,
    pub contact_phone: Option<String>,
    pub source_id: Option<Uuid>,
    pub source_detail: Option<String>,
    pub stage_id: Option<Uuid>,
    pub status: Option<String>,
    pub priority: Option<String>,
    pub assigned_to: Option<Uuid>,
    #[serde(default)]
    pub potential_services: Vec<String>,
    pub estimated_value: Option<Decimal>,
    pub currency: Option<String>,
    pub research_notes: Option<String>,
    pub next_action: Option<String>,
    pub next_action_due_at: Option<DateTime<Utc>>,
    pub lost_reason: Option<String>,
}

impl LeadInput {
    /// Trims text, blanks -> None, normalizes casing of codes.
    pub fn normalized(mut self) -> Self {
        self.business_name = self.business_name.trim().to_owned();
        self.market = self.market.trim().to_lowercase();
        for field in [
            &mut self.industry,
            &mut self.category,
            &mut self.country,
            &mut self.region,
            &mut self.city,
            &mut self.address,
            &mut self.website_url,
            &mut self.facebook_url,
            &mut self.instagram_url,
            &mut self.linkedin_url,
            &mut self.google_maps_url,
            &mut self.business_phone,
            &mut self.business_email,
            &mut self.contact_name,
            &mut self.contact_position,
            &mut self.contact_email,
            &mut self.contact_phone,
            &mut self.source_detail,
            &mut self.research_notes,
            &mut self.next_action,
            &mut self.lost_reason,
        ] {
            *field = clean(field.take());
        }
        self.business_email = self.business_email.map(|e| e.to_lowercase());
        self.contact_email = self.contact_email.map(|e| e.to_lowercase());
        self.currency = clean(self.currency).map(|c| c.to_uppercase());
        self.status = clean(self.status).map(|s| s.to_lowercase());
        self.priority = clean(self.priority).map(|s| s.to_lowercase());
        self.potential_services = self
            .potential_services
            .into_iter()
            .map(|s| s.trim().to_owned())
            .filter(|s| !s.is_empty())
            .collect();
        self
    }

    pub fn has_contact(&self) -> bool {
        self.contact_name.is_some() || self.contact_email.is_some() || self.contact_phone.is_some()
    }

    pub fn validate(&self, v: &mut Validator) {
        v.text("business_name", &self.business_name, 200);
        v.one_of("market", &self.market, MARKETS);
        for (field, value, max) in [
            ("industry", &self.industry, 120),
            ("category", &self.category, 120),
            ("country", &self.country, 80),
            ("region", &self.region, 120),
            ("city", &self.city, 120),
            ("address", &self.address, 400),
            ("website_url", &self.website_url, 500),
            ("facebook_url", &self.facebook_url, 500),
            ("instagram_url", &self.instagram_url, 500),
            ("linkedin_url", &self.linkedin_url, 500),
            ("google_maps_url", &self.google_maps_url, 1000),
            ("business_phone", &self.business_phone, 60),
            ("contact_name", &self.contact_name, 160),
            ("contact_position", &self.contact_position, 120),
            ("contact_phone", &self.contact_phone, 60),
            ("source_detail", &self.source_detail, 200),
            ("research_notes", &self.research_notes, 10_000),
            ("next_action", &self.next_action, 300),
            ("lost_reason", &self.lost_reason, 500),
        ] {
            v.optional_text(field, value.as_deref(), max);
        }
        if let Some(e) = &self.business_email {
            v.email("business_email", e);
        }
        if let Some(e) = &self.contact_email {
            v.email("contact_email", e);
        }
        if let Some(c) = &self.currency {
            if c.len() != 3 || !c.chars().all(|ch| ch.is_ascii_uppercase()) {
                v.fail("currency", "Use a 3-letter currency code such as PHP or USD.");
            }
        }
        if let Some(s) = &self.status {
            v.one_of("status", s, STATUSES);
        }
        if let Some(p) = &self.priority {
            v.one_of("priority", p, PRIORITIES);
        }
        if self.estimated_value.is_some_and(|d| d.is_sign_negative()) {
            v.fail("estimated_value", "Can't be negative.");
        }
        if self.potential_services.len() > 20 || self.potential_services.iter().any(|s| s.chars().count() > 80) {
            v.fail("potential_services", "Up to 20 services, 80 characters each.");
        }
    }
}

/// Active leads must always say what happens next, so none silently go cold.
fn require_next_action(v: &mut Validator, status: &str, input: &LeadInput) {
    if status == "active" && input.next_action.is_none() {
        v.fail("next_action", "Active leads need a next action.");
    }
}

/// Used when a spreadsheet row has no next action.
pub const DEFAULT_NEXT_ACTION: &str = "Research and qualify this lead";

async fn default_stage(db: &PgPool) -> AppResult<Uuid> {
    sqlx::query_scalar(
        "select id from public.pipeline_stages where archived_at is null
         order by is_default desc, position limit 1",
    )
    .fetch_optional(db)
    .await?
    .ok_or_else(|| AppError::BadRequest("No pipeline stages are configured.".into()))
}

#[derive(Deserialize)]
pub struct CreateLead {
    #[serde(flatten)]
    input: LeadInput,
    /// Create even if possible duplicates were found.
    #[serde(default)]
    force: bool,
}

#[derive(Serialize)]
#[serde(tag = "result", rename_all = "snake_case")]
pub enum CreateResult {
    Created { lead: LeadRow },
    PossibleDuplicates { duplicates: Vec<duplicates::Match> },
}

pub async fn create(
    State(state): State<AppState>,
    user: AuthUser,
    Json(body): Json<CreateLead>,
) -> AppResult<Json<CreateResult>> {
    user.require("leads.create")?;
    let input = body.input.normalized();
    let mut v = Validator::new();
    input.validate(&mut v);
    require_next_action(&mut v, input.status.as_deref().unwrap_or("active"), &input);
    v.finish()?;

    if !body.force {
        let matches = duplicates::find_matches(&state.db, std::slice::from_ref(&input)).await?;
        let found: Vec<_> = matches.into_iter().map(|(_, m)| m).collect();
        if !found.is_empty() {
            return Ok(Json(CreateResult::PossibleDuplicates { duplicates: found }));
        }
    }

    let stage_id = match input.stage_id {
        Some(id) => id,
        None => default_stage(&state.db).await?,
    };
    // Unassigned leads would be invisible to a creator without leads.view_all.
    let assigned_to = input.assigned_to.or(Some(user.id));

    let mut tx = state.db.begin().await?;
    let company_id: Uuid = sqlx::query_scalar(
        "insert into public.companies (name, industry, category, market, country, region, city, address,
           website_url, facebook_url, instagram_url, linkedin_url, google_maps_url, phone, email, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) returning id",
    )
    .bind(&input.business_name)
    .bind(&input.industry)
    .bind(&input.category)
    .bind(&input.market)
    .bind(&input.country)
    .bind(&input.region)
    .bind(&input.city)
    .bind(&input.address)
    .bind(&input.website_url)
    .bind(&input.facebook_url)
    .bind(&input.instagram_url)
    .bind(&input.linkedin_url)
    .bind(&input.google_maps_url)
    .bind(&input.business_phone)
    .bind(&input.business_email)
    .bind(user.id)
    .fetch_one(&mut *tx)
    .await?;

    let contact_id: Option<Uuid> = if input.has_contact() {
        Some(
            sqlx::query_scalar(
                "insert into public.contacts (company_id, full_name, position, email, phone, is_primary)
                 values ($1, $2, $3, $4, $5, true) returning id",
            )
            .bind(company_id)
            .bind(input.contact_name.clone().unwrap_or_else(|| "Unknown contact".into()))
            .bind(&input.contact_position)
            .bind(&input.contact_email)
            .bind(&input.contact_phone)
            .fetch_one(&mut *tx)
            .await?,
        )
    } else {
        None
    };

    let lead_id: Uuid = sqlx::query_scalar(
        "insert into public.leads (company_id, primary_contact_id, source_id, source_detail, stage_id, status,
           priority, assigned_to, potential_services, estimated_value, currency, research_notes, next_action,
           next_action_due_at, lost_reason, created_by)
         values ($1,$2,$3,$4,$5,coalesce($6,'active'),coalesce($7,'medium'),$8,$9,$10,coalesce($11,'PHP'),$12,$13,$14,$15,$16)
         returning id",
    )
    .bind(company_id)
    .bind(contact_id)
    .bind(input.source_id)
    .bind(&input.source_detail)
    .bind(stage_id)
    .bind(&input.status)
    .bind(&input.priority)
    .bind(assigned_to)
    .bind(&input.potential_services)
    .bind(input.estimated_value)
    .bind(&input.currency)
    .bind(&input.research_notes)
    .bind(&input.next_action)
    .bind(input.next_action_due_at)
    .bind(&input.lost_reason)
    .bind(user.id)
    .fetch_one(&mut *tx)
    .await?;

    audit::activity(&mut *tx, user.id, "lead", lead_id, "lead.created", &format!("{} added {}", user.full_name, input.business_name)).await?;
    tx.commit().await?;

    Ok(Json(CreateResult::Created { lead: fetch_lead(&state.db, lead_id).await? }))
}

pub async fn update(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Json(input): Json<LeadInput>,
) -> AppResult<Json<LeadRow>> {
    user.require("leads.edit")?;
    ensure_visible(&state.db, &user, id).await?;
    let input = input.normalized();
    let before = fetch_lead(&state.db, id).await?;
    let mut v = Validator::new();
    input.validate(&mut v);
    require_next_action(&mut v, input.status.as_deref().unwrap_or(&before.status), &input);
    v.finish()?;
    let stage_id = input.stage_id.unwrap_or(before.stage_id);

    let mut tx = state.db.begin().await?;
    sqlx::query(
        "update public.companies set name=$2, industry=$3, category=$4, market=$5, country=$6, region=$7, city=$8,
           address=$9, website_url=$10, facebook_url=$11, instagram_url=$12, linkedin_url=$13, google_maps_url=$14,
           phone=$15, email=$16
         where id = $1",
    )
    .bind(before.company_id)
    .bind(&input.business_name)
    .bind(&input.industry)
    .bind(&input.category)
    .bind(&input.market)
    .bind(&input.country)
    .bind(&input.region)
    .bind(&input.city)
    .bind(&input.address)
    .bind(&input.website_url)
    .bind(&input.facebook_url)
    .bind(&input.instagram_url)
    .bind(&input.linkedin_url)
    .bind(&input.google_maps_url)
    .bind(&input.business_phone)
    .bind(&input.business_email)
    .execute(&mut *tx)
    .await?;

    let contact_id = upsert_primary_contact(&mut tx, before.company_id, before.primary_contact_id, &input).await?;

    sqlx::query(
        "update public.leads set primary_contact_id=$2, source_id=$3, source_detail=$4, stage_id=$5,
           status=coalesce($6, status), priority=coalesce($7, priority), assigned_to=$8, potential_services=$9,
           estimated_value=$10, currency=coalesce($11, currency), research_notes=$12, next_action=$13,
           next_action_due_at=$14, lost_reason=$15,
           converted_at = case when coalesce($6, status) = 'converted' then coalesce(converted_at, now()) else converted_at end
         where id = $1",
    )
    .bind(id)
    .bind(contact_id)
    .bind(input.source_id)
    .bind(&input.source_detail)
    .bind(stage_id)
    .bind(&input.status)
    .bind(&input.priority)
    .bind(input.assigned_to)
    .bind(&input.potential_services)
    .bind(input.estimated_value)
    .bind(&input.currency)
    .bind(&input.research_notes)
    .bind(&input.next_action)
    .bind(input.next_action_due_at)
    .bind(&input.lost_reason)
    .execute(&mut *tx)
    .await?;

    if stage_id != before.stage_id {
        let stage_name: String = sqlx::query_scalar("select name from public.pipeline_stages where id = $1")
            .bind(stage_id)
            .fetch_one(&mut *tx)
            .await?;
        audit::activity(&mut *tx, user.id, "lead", id, "lead.stage_changed",
            &format!("{} moved {} to {}", user.full_name, input.business_name, stage_name)).await?;
    }
    if input.assigned_to != before.assigned_to {
        audit::activity(&mut *tx, user.id, "lead", id, "lead.assigned",
            &format!("{} reassigned {}", user.full_name, input.business_name)).await?;
    }
    audit::activity(&mut *tx, user.id, "lead", id, "lead.updated", &format!("{} updated {}", user.full_name, input.business_name)).await?;
    tx.commit().await?;

    Ok(Json(fetch_lead(&state.db, id).await?))
}

/// Updates the lead's primary contact, creating one if the form now has contact details.
pub async fn upsert_primary_contact(
    tx: &mut sqlx::Transaction<'_, Postgres>,
    company_id: Uuid,
    existing: Option<Uuid>,
    input: &LeadInput,
) -> AppResult<Option<Uuid>> {
    match existing {
        Some(contact_id) => {
            sqlx::query(
                "update public.contacts set full_name = coalesce($2, full_name), position = $3, email = $4, phone = $5
                 where id = $1",
            )
            .bind(contact_id)
            .bind(&input.contact_name)
            .bind(&input.contact_position)
            .bind(&input.contact_email)
            .bind(&input.contact_phone)
            .execute(&mut **tx)
            .await?;
            Ok(Some(contact_id))
        }
        None if input.has_contact() => Ok(Some(
            sqlx::query_scalar(
                "insert into public.contacts (company_id, full_name, position, email, phone, is_primary)
                 values ($1, $2, $3, $4, $5, true) returning id",
            )
            .bind(company_id)
            .bind(input.contact_name.clone().unwrap_or_else(|| "Unknown contact".into()))
            .bind(&input.contact_position)
            .bind(&input.contact_email)
            .bind(&input.contact_phone)
            .fetch_one(&mut **tx)
            .await?,
        )),
        None => Ok(None),
    }
}

pub async fn remove(State(state): State<AppState>, user: AuthUser, Path(id): Path<Uuid>) -> AppResult<StatusCode> {
    user.require("leads.delete")?;
    ensure_visible(&state.db, &user, id).await?;
    let mut tx = state.db.begin().await?;
    sqlx::query("update public.leads set deleted_at = now() where id = $1")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    audit::record(
        &mut *tx,
        AuditEntry { actor_id: Some(user.id), action: "lead.deleted", entity_type: Some("lead"), entity_id: Some(id), changes: json!({}) },
    )
    .await?;
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------------------
// Bulk actions
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum BulkAction {
    Assign { user_id: Option<Uuid> },
    Stage { stage_id: Uuid },
    Priority { priority: String },
    Status { status: String },
    AddToList { list_id: Uuid },
    RemoveFromList { list_id: Uuid },
    Delete,
}

#[derive(Deserialize)]
pub struct BulkRequest {
    ids: Vec<Uuid>,
    #[serde(flatten)]
    action: BulkAction,
}

#[derive(Serialize)]
pub struct BulkResult {
    affected: u64,
}

pub async fn bulk(
    State(state): State<AppState>,
    user: AuthUser,
    Json(req): Json<BulkRequest>,
) -> AppResult<Json<BulkResult>> {
    user.require("leads.edit")?;
    if req.ids.is_empty() || req.ids.len() > 5000 {
        return Err(AppError::BadRequest("Select between 1 and 5,000 leads.".into()));
    }

    // Keep only leads this user can see.
    let mut qb = QueryBuilder::<Postgres>::new("select l.id from public.leads l where l.deleted_at is null and l.id = any(");
    qb.push_bind(req.ids.clone()).push(")");
    push_scope(&mut qb, &user, "l");
    let ids: Vec<Uuid> = qb.build_query_scalar().fetch_all(&state.db).await?;

    let mut tx = state.db.begin().await?;
    let (affected, label) = match &req.action {
        BulkAction::Assign { user_id } => (
            sqlx::query("update public.leads set assigned_to = $2 where id = any($1)")
                .bind(&ids).bind(user_id).execute(&mut *tx).await?.rows_affected(),
            "assigned",
        ),
        BulkAction::Stage { stage_id } => (
            sqlx::query("update public.leads set stage_id = $2 where id = any($1)")
                .bind(&ids).bind(stage_id).execute(&mut *tx).await?.rows_affected(),
            "moved",
        ),
        BulkAction::Priority { priority } => {
            if !PRIORITIES.contains(&priority.as_str()) {
                return Err(AppError::BadRequest("Unknown priority.".into()));
            }
            (
                sqlx::query("update public.leads set priority = $2 where id = any($1)")
                    .bind(&ids).bind(priority).execute(&mut *tx).await?.rows_affected(),
                "reprioritized",
            )
        }
        BulkAction::Status { status } => {
            if !STATUSES.contains(&status.as_str()) {
                return Err(AppError::BadRequest("Unknown status.".into()));
            }
            (
                sqlx::query("update public.leads set status = $2 where id = any($1)")
                    .bind(&ids).bind(status).execute(&mut *tx).await?.rows_affected(),
                "updated",
            )
        }
        BulkAction::AddToList { list_id } => (
            sqlx::query(
                "insert into public.lead_list_members (list_id, lead_id, added_by)
                 select $2, unnest($1::uuid[]), $3 on conflict do nothing",
            )
            .bind(&ids).bind(list_id).bind(user.id).execute(&mut *tx).await?.rows_affected(),
            "added to a list",
        ),
        BulkAction::RemoveFromList { list_id } => (
            sqlx::query("delete from public.lead_list_members where list_id = $2 and lead_id = any($1)")
                .bind(&ids).bind(list_id).execute(&mut *tx).await?.rows_affected(),
            "removed from a list",
        ),
        BulkAction::Delete => {
            user.require("leads.delete")?;
            (
                sqlx::query("update public.leads set deleted_at = now() where id = any($1)")
                    .bind(&ids).execute(&mut *tx).await?.rows_affected(),
                "deleted",
            )
        }
    };

    audit::record(
        &mut *tx,
        AuditEntry {
            actor_id: Some(user.id),
            action: "leads.bulk_updated",
            entity_type: Some("lead"),
            entity_id: None,
            changes: json!({ "label": label, "count": affected, "ids": ids }),
        },
    )
    .await?;
    tx.commit().await?;
    Ok(Json(BulkResult { affected }))
}

/// Distinct values for filter dropdowns (countries and industries actually in use).
#[derive(Serialize)]
pub struct FacetValues {
    countries: Vec<String>,
    industries: Vec<String>,
}

pub async fn facets(State(state): State<AppState>, user: AuthUser) -> AppResult<Json<FacetValues>> {
    user.require("leads.view")?;
    let (countries, industries) = tokio::try_join!(
        sqlx::query_scalar::<_, String>(
            "select distinct c.country from public.companies c join public.leads l on l.company_id = c.id
             where l.deleted_at is null and c.country is not null order by 1 limit 300",
        )
        .fetch_all(&state.db),
        sqlx::query_scalar::<_, String>(
            "select distinct c.industry from public.companies c join public.leads l on l.company_id = c.id
             where l.deleted_at is null and c.industry is not null order by 1 limit 300",
        )
        .fetch_all(&state.db),
    )?;
    Ok(Json(FacetValues { countries, industries }))
}
