//! Proposal builder: line items, discounts, tax, validity, versions, status tracking and
//! templates. Totals are always computed here, never trusted from the client.

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use chrono::{DateTime, Duration, NaiveDate, Utc};
use rust_decimal::{Decimal, RoundingStrategy};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::{Postgres, QueryBuilder};
use uuid::Uuid;

use crate::{
    audit,
    auth::AuthUser,
    error::{AppError, AppResult},
    routes::common::{like_pattern, non_empty, paging, Page},
    state::AppState,
    validate::{clean, Validator},
};

pub const BILLING: &[&str] = &["one_time", "monthly", "quarterly", "yearly", "hourly"];

#[derive(Serialize, Deserialize, sqlx::FromRow, Clone)]
pub struct Summary {
    id: Uuid,
    number: String,
    title: String,
    status: String,
    is_template: bool,
    company_id: Option<Uuid>,
    company_name: Option<String>,
    lead_id: Option<Uuid>,
    deal_id: Option<Uuid>,
    total: Decimal,
    currency: String,
    valid_until: Option<NaiveDate>,
    sent_at: Option<DateTime<Utc>>,
    responded_at: Option<DateTime<Utc>>,
    current_version: i32,
    created_by_name: Option<String>,
    updated_at: DateTime<Utc>,
}

const SUMMARY_SELECT: &str = "select p.id, p.number, p.title,
    case when p.status = 'sent' and p.valid_until < current_date then 'expired' else p.status end as status,
    p.is_template, p.company_id, c.name as company_name, p.lead_id, p.deal_id, p.total, p.currency, p.valid_until,
    p.sent_at, p.responded_at, p.current_version, u.full_name as created_by_name, p.updated_at
  from public.proposals p
  left join public.companies c on c.id = p.company_id
  left join public.profiles u on u.id = p.created_by";

#[derive(Deserialize, Default)]
pub struct ProposalQuery {
    status: Option<String>,
    search: Option<String>,
    templates: Option<bool>,
    lead_id: Option<Uuid>,
    page: Option<i64>,
    per_page: Option<i64>,
}

fn push_filters(qb: &mut QueryBuilder<'_, Postgres>, q: &ProposalQuery) {
    qb.push(" where p.deleted_at is null and p.is_template = ").push_bind(q.templates.unwrap_or(false));
    if let Some(s) = non_empty(&q.status) {
        if s == "expired" {
            qb.push(" and (p.status = 'expired' or (p.status = 'sent' and p.valid_until < current_date))");
        } else {
            qb.push(" and p.status = ").push_bind(s.to_owned());
            if s == "sent" {
                qb.push(" and (p.valid_until is null or p.valid_until >= current_date)");
            }
        }
    }
    if let Some(t) = non_empty(&q.search) {
        let p = like_pattern(t);
        qb.push(" and (p.title ilike ").push_bind(p.clone()).push(" or p.number ilike ").push_bind(p.clone())
            .push(" or c.name ilike ").push_bind(p).push(")");
    }
    if let Some(l) = q.lead_id {
        qb.push(" and p.lead_id = ").push_bind(l);
    }
}

pub async fn list(State(state): State<AppState>, user: AuthUser, Query(q): Query<ProposalQuery>) -> AppResult<Json<Page<Summary>>> {
    user.require("proposals.view")?;
    let (page, per_page, offset) = paging(q.page, q.per_page, 200);
    let mut rows = QueryBuilder::<Postgres>::new(SUMMARY_SELECT);
    push_filters(&mut rows, &q);
    rows.push(" order by p.updated_at desc limit ").push_bind(per_page).push(" offset ").push_bind(offset);
    let mut count = QueryBuilder::<Postgres>::new("select count(*) from public.proposals p left join public.companies c on c.id = p.company_id");
    push_filters(&mut count, &q);
    let (items, total) = tokio::try_join!(
        rows.build_query_as::<Summary>().fetch_all(&state.db),
        count.build_query_scalar::<i64>().fetch_one(&state.db),
    )?;
    Ok(Json(Page { items, total, page, per_page }))
}

#[derive(Serialize, Deserialize, sqlx::FromRow, Clone)]
pub struct Item {
    service_id: Option<Uuid>,
    name: String,
    description: Option<String>,
    deliverables: Vec<String>,
    quantity: Decimal,
    unit_price: Decimal,
    billing_type: String,
}

#[derive(Serialize, Deserialize, sqlx::FromRow, Clone)]
pub struct Recipient {
    company_name: Option<String>,
    address: Option<String>,
    city: Option<String>,
    region: Option<String>,
    country: Option<String>,
    contact_name: Option<String>,
    contact_position: Option<String>,
    contact_email: Option<String>,
    contact_phone: Option<String>,
}

#[derive(Serialize, sqlx::FromRow)]
pub struct Version {
    version: i32,
    created_at: DateTime<Utc>,
    created_by_name: Option<String>,
}

#[derive(Serialize, Deserialize, sqlx::FromRow, Clone)]
pub struct Pricing {
    subtotal: Decimal,
    discount_type: String,
    discount_value: Decimal,
    tax_rate: Decimal,
    introduction: Option<String>,
    terms: Option<String>,
}

#[derive(Serialize)]
pub struct Detail {
    #[serde(flatten)]
    summary: Summary,
    #[serde(flatten)]
    pricing: Pricing,
    discount_amount: Decimal,
    tax_amount: Decimal,
    items: Vec<Item>,
    recipient: Recipient,
    versions: Vec<Version>,
}

pub async fn fetch(state: &AppState, id: Uuid) -> AppResult<Detail> {
    let db = &state.db;
    let (summary, pricing, items, recipient, versions) = tokio::try_join!(
        async {
            sqlx::query_as::<_, Summary>(&format!("{SUMMARY_SELECT} where p.id = $1 and p.deleted_at is null"))
                .bind(id)
                .fetch_one(db)
                .await
        },
        sqlx::query_as::<_, Pricing>(
            "select subtotal, discount_type, discount_value, tax_rate, introduction, terms from public.proposals where id = $1",
        )
        .bind(id)
        .fetch_one(db),
        sqlx::query_as::<_, Item>(
            "select service_id, name, description, deliverables, quantity, unit_price, billing_type
             from public.proposal_items where proposal_id = $1 order by position",
        )
        .bind(id)
        .fetch_all(db),
        sqlx::query_as::<_, Recipient>(
            "select c.name as company_name, c.address, c.city, c.region, c.country, ct.full_name as contact_name,
                    ct.position as contact_position, coalesce(ct.email, c.email) as contact_email,
                    coalesce(ct.phone, c.phone) as contact_phone
             from public.proposals p
             left join public.companies c on c.id = p.company_id
             left join public.leads l on l.id = p.lead_id
             left join public.contacts ct on ct.id = coalesce(l.primary_contact_id,
               (select id from public.contacts where company_id = c.id and deleted_at is null order by is_primary desc, created_at limit 1))
             where p.id = $1",
        )
        .bind(id)
        .fetch_one(db),
        sqlx::query_as::<_, Version>(
            "select v.version, v.created_at, u.full_name as created_by_name from public.proposal_versions v
             left join public.profiles u on u.id = v.created_by where v.proposal_id = $1 order by v.version desc",
        )
        .bind(id)
        .fetch_all(db),
    )?;
    let t = totals(&items, &pricing.discount_type, pricing.discount_value, pricing.tax_rate);
    Ok(Detail { summary, pricing, discount_amount: t.discount, tax_amount: t.tax, items, recipient, versions })
}

pub async fn get(State(state): State<AppState>, user: AuthUser, Path(id): Path<Uuid>) -> AppResult<Json<Detail>> {
    user.require("proposals.view")?;
    Ok(Json(fetch(&state, id).await?))
}

struct Totals {
    subtotal: Decimal,
    discount: Decimal,
    tax: Decimal,
    total: Decimal,
}

fn money(d: Decimal) -> Decimal {
    d.round_dp_with_strategy(2, RoundingStrategy::MidpointAwayFromZero)
}

fn totals(items: &[Item], discount_type: &str, discount_value: Decimal, tax_rate: Decimal) -> Totals {
    let subtotal: Decimal = items.iter().map(|i| money(i.quantity * i.unit_price)).sum();
    let discount = match discount_type {
        "percent" => money(subtotal * discount_value.min(Decimal::ONE_HUNDRED) / Decimal::ONE_HUNDRED),
        "fixed" => discount_value.min(subtotal),
        _ => Decimal::ZERO,
    };
    let taxable = subtotal - discount;
    let tax = money(taxable * tax_rate / Decimal::ONE_HUNDRED);
    Totals { subtotal, discount, tax, total: taxable + tax }
}

// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct CreateProposal {
    lead_id: Option<Uuid>,
    deal_id: Option<Uuid>,
    template_id: Option<Uuid>,
    title: Option<String>,
    #[serde(default)]
    is_template: bool,
}

pub async fn create(State(state): State<AppState>, user: AuthUser, Json(input): Json<CreateProposal>) -> AppResult<Json<Detail>> {
    user.require("proposals.manage")?;
    let db = &state.db;

    // Company, lead and default currency come from the deal or the lead.
    let (company_id, lead_id, company_name, currency): (Option<Uuid>, Option<Uuid>, Option<String>, Option<String>) =
        if let Some(deal) = input.deal_id {
            sqlx::query_as(
                "select d.company_id, d.lead_id, c.name, d.currency from public.deals d
                 join public.companies c on c.id = d.company_id where d.id = $1 and d.deleted_at is null",
            )
            .bind(deal)
            .fetch_optional(db)
            .await?
            .ok_or(AppError::NotFound)?
        } else if let Some(lead) = input.lead_id {
            crate::routes::leads::ensure_visible(db, &user, lead).await?;
            sqlx::query_as(
                "select l.company_id, l.id, c.name, l.currency from public.leads l
                 join public.companies c on c.id = l.company_id where l.id = $1",
            )
            .bind(lead)
            .fetch_one(db)
            .await?
        } else if input.is_template {
            (None, None, None, None)
        } else {
            return Err(AppError::BadRequest("Create the proposal from a lead or a deal.".into()));
        };

    let title = clean(input.title.clone()).unwrap_or_else(|| match &company_name {
        Some(name) => format!("Proposal for {name}"),
        None => "New proposal template".into(),
    });
    let valid_until = (Utc::now() + Duration::days(30)).date_naive();

    let mut tx = db.begin().await?;
    let id: Uuid = sqlx::query_scalar(
        "insert into public.proposals (company_id, lead_id, deal_id, title, currency, valid_until, is_template, created_by,
           introduction, terms, discount_type, discount_value, tax_rate)
         select $1, $2, $3, $4, coalesce(t.currency, $5, 'PHP'), $6, $7, $8, t.introduction, t.terms,
                coalesce(t.discount_type, 'none'), coalesce(t.discount_value, 0), coalesce(t.tax_rate, 0)
         from (select 1) one
         left join public.proposals t on t.id = $9 and t.deleted_at is null
         returning id",
    )
    .bind(company_id)
    .bind(lead_id)
    .bind(input.deal_id)
    .bind(&title)
    .bind(&currency)
    .bind(if input.is_template { None } else { Some(valid_until) })
    .bind(input.is_template)
    .bind(user.id)
    .bind(input.template_id)
    .fetch_one(&mut *tx)
    .await?;
    if let Some(t) = input.template_id {
        sqlx::query(
            "insert into public.proposal_items (proposal_id, service_id, name, description, deliverables, quantity, unit_price, billing_type, position)
             select $1, service_id, name, description, deliverables, quantity, unit_price, billing_type, position
             from public.proposal_items where proposal_id = $2",
        )
        .bind(id)
        .bind(t)
        .execute(&mut *tx)
        .await?;
        recompute(&mut tx, id).await?;
    }
    if let Some(lead) = lead_id {
        audit::activity(&mut *tx, user.id, "lead", lead, "proposal.created", &format!("{} started a proposal: {title}", user.full_name)).await?;
    }
    tx.commit().await?;
    Ok(Json(fetch(&state, id).await?))
}

/// Recomputes stored totals from the items (used after copying items).
async fn recompute(tx: &mut sqlx::Transaction<'_, Postgres>, id: Uuid) -> AppResult<()> {
    let items = sqlx::query_as::<_, Item>(
        "select service_id, name, description, deliverables, quantity, unit_price, billing_type from public.proposal_items where proposal_id = $1",
    )
    .bind(id)
    .fetch_all(&mut **tx)
    .await?;
    let (dt, dv, tr): (String, Decimal, Decimal) =
        sqlx::query_as("select discount_type, discount_value, tax_rate from public.proposals where id = $1")
            .bind(id)
            .fetch_one(&mut **tx)
            .await?;
    let t = totals(&items, &dt, dv, tr);
    sqlx::query("update public.proposals set subtotal = $2, total = $3 where id = $1")
        .bind(id)
        .bind(t.subtotal)
        .bind(t.total)
        .execute(&mut **tx)
        .await?;
    Ok(())
}

#[derive(Deserialize)]
pub struct SaveProposal {
    title: String,
    currency: String,
    discount_type: String,
    discount_value: Decimal,
    tax_rate: Decimal,
    valid_until: Option<NaiveDate>,
    introduction: Option<String>,
    terms: Option<String>,
    items: Vec<Item>,
}

pub async fn save(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Json(input): Json<SaveProposal>,
) -> AppResult<Json<Detail>> {
    user.require("proposals.manage")?;
    let (status, is_template): (String, bool) =
        sqlx::query_as("select status, is_template from public.proposals where id = $1 and deleted_at is null")
            .bind(id)
            .fetch_optional(&state.db)
            .await?
            .ok_or(AppError::NotFound)?;
    if !is_template && !["draft", "ready"].contains(&status.as_str()) {
        return Err(AppError::Conflict("This proposal was already sent. Create a revision to change it.".into()));
    }

    let mut v = Validator::new();
    v.text("title", &input.title, 200);
    v.one_of("discount_type", &input.discount_type, &["none", "percent", "fixed"]);
    if input.currency.len() != 3 || !input.currency.chars().all(|c| c.is_ascii_uppercase()) {
        v.fail("currency", "Use a 3-letter currency code.");
    }
    if input.discount_value.is_sign_negative() || (input.discount_type == "percent" && input.discount_value > Decimal::ONE_HUNDRED) {
        v.fail("discount_value", "Enter a valid discount.");
    }
    if input.tax_rate.is_sign_negative() || input.tax_rate > Decimal::ONE_HUNDRED {
        v.fail("tax_rate", "Tax rate must be between 0 and 100.");
    }
    v.optional_text("introduction", input.introduction.as_deref(), 20_000);
    v.optional_text("terms", input.terms.as_deref(), 20_000);
    if input.items.len() > 100 {
        v.fail("items", "Up to 100 line items.");
    }
    for (i, item) in input.items.iter().enumerate() {
        if item.name.trim().is_empty() {
            v.fail(&format!("items.{i}.name"), "Name every line item.");
        }
        if item.quantity <= Decimal::ZERO {
            v.fail(&format!("items.{i}.quantity"), "Quantity must be more than 0.");
        }
        if item.unit_price.is_sign_negative() {
            v.fail(&format!("items.{i}.unit_price"), "Price can't be negative.");
        }
        if !BILLING.contains(&item.billing_type.as_str()) {
            v.fail(&format!("items.{i}.billing_type"), "Unknown billing type.");
        }
    }
    v.finish()?;

    let t = totals(&input.items, &input.discount_type, input.discount_value, input.tax_rate);
    let mut tx = state.db.begin().await?;
    sqlx::query(
        "update public.proposals set title=$2, currency=$3, discount_type=$4, discount_value=$5, tax_rate=$6,
           valid_until=$7, introduction=$8, terms=$9, subtotal=$10, total=$11 where id = $1",
    )
    .bind(id)
    .bind(input.title.trim())
    .bind(&input.currency)
    .bind(&input.discount_type)
    .bind(input.discount_value)
    .bind(input.tax_rate)
    .bind(input.valid_until)
    .bind(clean(input.introduction.clone()))
    .bind(clean(input.terms.clone()))
    .bind(t.subtotal)
    .bind(t.total)
    .execute(&mut *tx)
    .await?;
    sqlx::query("delete from public.proposal_items where proposal_id = $1").bind(id).execute(&mut *tx).await?;
    for (pos, item) in input.items.iter().enumerate() {
        sqlx::query(
            "insert into public.proposal_items (proposal_id, service_id, name, description, deliverables, quantity, unit_price, billing_type, position)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        )
        .bind(id)
        .bind(item.service_id)
        .bind(item.name.trim())
        .bind(clean(item.description.clone()))
        .bind(item.deliverables.iter().map(|d| d.trim().to_owned()).filter(|d| !d.is_empty()).collect::<Vec<_>>())
        .bind(item.quantity)
        .bind(item.unit_price)
        .bind(&item.billing_type)
        .bind(pos as i32)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(Json(fetch(&state, id).await?))
}

#[derive(Deserialize)]
pub struct StatusChange {
    status: String,
}

/// draft -> ready -> sent -> accepted | rejected | expired. "revise" reopens a sent proposal
/// as a new version. Sending snapshots the proposal; accepting wins the deal.
pub async fn set_status(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Json(input): Json<StatusChange>,
) -> AppResult<Json<Detail>> {
    user.require("proposals.manage")?;
    let current = fetch(&state, id).await?;
    if current.summary.is_template {
        return Err(AppError::BadRequest("Templates aren't sent.".into()));
    }
    let from = current.summary.status.as_str();
    let to = input.status.as_str();
    let allowed = matches!(
        (from, to),
        ("draft", "ready") | ("ready", "draft") | ("draft" | "ready", "sent")
            | ("sent" | "expired", "accepted" | "rejected" | "expired")
            | ("sent" | "rejected" | "expired" | "accepted", "revise")
    );
    if !allowed {
        return Err(AppError::Conflict(format!("A {from} proposal can't be marked {to}.")));
    }
    if to == "sent" && current.items.is_empty() {
        return Err(AppError::BadRequest("Add at least one line item before sending.".into()));
    }

    let mut tx = state.db.begin().await?;
    match to {
        "sent" => {
            let snapshot = serde_json::to_value(&json!({
                "summary": &current.summary, "pricing": &current.pricing, "items": &current.items, "recipient": &current.recipient,
            }))
            .map_err(anyhow::Error::from)?;
            sqlx::query(
                "insert into public.proposal_versions (proposal_id, version, snapshot, created_by) values ($1, $2, $3, $4)
                 on conflict (proposal_id, version) do update set snapshot = excluded.snapshot, created_at = now()",
            )
            .bind(id)
            .bind(current.summary.current_version)
            .bind(snapshot)
            .bind(user.id)
            .execute(&mut *tx)
            .await?;
            sqlx::query("update public.proposals set status = 'sent', sent_at = now() where id = $1").bind(id).execute(&mut *tx).await?;
            sqlx::query(
                "update public.leads set stage_id = coalesce((select id from public.pipeline_stages
                   where lower(name) = 'proposal sent' and archived_at is null limit 1), stage_id),
                   last_contacted_at = now()
                 where id = $1 and status = 'active'",
            )
            .bind(current.summary.lead_id)
            .execute(&mut *tx)
            .await?;
        }
        "revise" => {
            sqlx::query("update public.proposals set status = 'draft', current_version = current_version + 1, responded_at = null where id = $1")
                .bind(id)
                .execute(&mut *tx)
                .await?;
        }
        "accepted" => {
            sqlx::query("update public.proposals set status = 'accepted', responded_at = now() where id = $1").bind(id).execute(&mut *tx).await?;
            // Win the linked deal, or record one, valued at the accepted total.
            match current.summary.deal_id {
                Some(d) => {
                    sqlx::query(
                        "update public.deals set status = 'won', won_at = coalesce(won_at, now()), value = $2, currency = $3,
                           lost_at = null, lost_reason = null where id = $1",
                    )
                    .bind(d)
                    .bind(current.summary.total)
                    .bind(&current.summary.currency)
                    .execute(&mut *tx)
                    .await?;
                }
                None => {
                    let d: Uuid = sqlx::query_scalar(
                        "insert into public.deals (company_id, lead_id, title, value, currency, status, won_at, owner_id)
                         values ($1, $2, $3, $4, $5, 'won', now(), $6) returning id",
                    )
                    .bind(current.summary.company_id)
                    .bind(current.summary.lead_id)
                    .bind(&current.summary.title)
                    .bind(current.summary.total)
                    .bind(&current.summary.currency)
                    .bind(user.id)
                    .fetch_one(&mut *tx)
                    .await?;
                    sqlx::query("update public.proposals set deal_id = $2 where id = $1").bind(id).bind(d).execute(&mut *tx).await?;
                }
            }
            sqlx::query(
                "update public.leads set stage_id = coalesce((select id from public.pipeline_stages where kind = 'won'
                   and archived_at is null order by position limit 1), stage_id) where id = $1",
            )
            .bind(current.summary.lead_id)
            .execute(&mut *tx)
            .await?;
        }
        other => {
            sqlx::query("update public.proposals set status = $2, responded_at = case when $2 in ('rejected','expired') then now() else responded_at end where id = $1")
                .bind(id)
                .bind(other)
                .execute(&mut *tx)
                .await?;
        }
    }
    if let Some(lead) = current.summary.lead_id {
        let verb = match to { "sent" => "sent", "accepted" => "marked accepted", "rejected" => "marked rejected", "revise" => "started a revision of", "ready" => "marked ready", _ => "updated" };
        audit::activity(&mut *tx, user.id, "lead", lead, "proposal.status", &format!("{} {verb} proposal {}", user.full_name, current.summary.number)).await?;
    }
    tx.commit().await?;
    Ok(Json(fetch(&state, id).await?))
}

#[derive(Deserialize)]
pub struct Duplicate {
    #[serde(default)]
    as_template: bool,
}

/// Copies a proposal (e.g. to save it as a reusable template).
pub async fn duplicate(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Json(input): Json<Duplicate>,
) -> AppResult<Json<Detail>> {
    user.require("proposals.manage")?;
    let mut tx = state.db.begin().await?;
    let new_id: Uuid = sqlx::query_scalar(
        "insert into public.proposals (company_id, lead_id, deal_id, title, currency, discount_type, discount_value, tax_rate,
           valid_until, introduction, terms, subtotal, total, is_template, created_by)
         select case when $2 then null else company_id end, case when $2 then null else lead_id end,
                case when $2 then null else deal_id end,
                case when $2 then title || ' (template)' else title || ' (copy)' end,
                currency, discount_type, discount_value, tax_rate,
                case when $2 then null else current_date + 30 end, introduction, terms, subtotal, total, $2, $3
         from public.proposals where id = $1 and deleted_at is null returning id",
    )
    .bind(id)
    .bind(input.as_template)
    .bind(user.id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(AppError::NotFound)?;
    sqlx::query(
        "insert into public.proposal_items (proposal_id, service_id, name, description, deliverables, quantity, unit_price, billing_type, position)
         select $1, service_id, name, description, deliverables, quantity, unit_price, billing_type, position
         from public.proposal_items where proposal_id = $2",
    )
    .bind(new_id)
    .bind(id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(fetch(&state, new_id).await?))
}

pub async fn remove(State(state): State<AppState>, user: AuthUser, Path(id): Path<Uuid>) -> AppResult<StatusCode> {
    user.require("proposals.manage")?;
    let status: String = sqlx::query_scalar("select status from public.proposals where id = $1 and deleted_at is null")
        .bind(id)
        .fetch_optional(&state.db)
        .await?
        .ok_or(AppError::NotFound)?;
    if status == "accepted" {
        return Err(AppError::Conflict("Accepted proposals are kept for the record.".into()));
    }
    sqlx::query("update public.proposals set deleted_at = now() where id = $1").bind(id).execute(&state.db).await?;
    Ok(StatusCode::NO_CONTENT)
}
