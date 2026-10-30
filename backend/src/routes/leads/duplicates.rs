//! Duplicate detection (website domain, email, phone, name + city) and merging.

use axum::{extract::State, Json};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

use super::LeadInput;
use crate::{
    audit::{self, AuditEntry},
    auth::AuthUser,
    error::{AppError, AppResult},
    state::AppState,
};

#[derive(Serialize, sqlx::FromRow, Clone, Debug)]
pub struct Match {
    pub lead_id: Uuid,
    pub business_name: String,
    pub city: Option<String>,
    pub matched_by: String,
}

#[derive(sqlx::FromRow)]
struct MatchRow {
    idx: i32,
    lead_id: Uuid,
    business_name: String,
    city: Option<String>,
    matched_by: String,
}

fn norm_domain(url: &Option<String>) -> Option<String> {
    let u = url.as_deref()?.trim().to_lowercase();
    let u = u.split_once("://").map_or(u.as_str(), |(_, rest)| rest).to_owned();
    let u = u.strip_prefix("www.").unwrap_or(&u);
    let host = u.split(['/', '?', '#', ':']).next().unwrap_or("").to_owned();
    (!host.is_empty()).then_some(host)
}

fn norm_phone(p: &Option<String>) -> Option<String> {
    let digits: String = p.as_deref()?.chars().filter(char::is_ascii_digit).collect();
    let tail = &digits[digits.len().saturating_sub(10)..];
    (tail.len() >= 7).then(|| tail.to_owned())
}

fn norm_name(n: &str) -> Option<String> {
    let s: String = n
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    (!s.is_empty()).then_some(s)
}

/// Keys used to compare a candidate row with existing leads (and with other rows in a batch).
pub fn keys(input: &LeadInput) -> Vec<String> {
    let mut k = Vec::new();
    if let Some(d) = norm_domain(&input.website_url) {
        k.push(format!("d:{d}"));
    }
    for e in [&input.business_email, &input.contact_email].into_iter().flatten() {
        k.push(format!("e:{}", e.to_lowercase()));
    }
    for p in [&input.business_phone, &input.contact_phone] {
        if let Some(p) = norm_phone(p) {
            k.push(format!("p:{p}"));
        }
    }
    if let Some(n) = norm_name(&input.business_name) {
        k.push(format!("n:{n}|{}", input.city.as_deref().unwrap_or("").to_lowercase()));
    }
    k
}

/// Finds the best existing match for each input row in one round trip.
/// Returns `(row index, match)` for rows that match an existing, non-deleted lead.
pub async fn find_matches(db: &PgPool, rows: &[LeadInput]) -> Result<Vec<(usize, Match)>, sqlx::Error> {
    if rows.is_empty() {
        return Ok(Vec::new());
    }
    let mut idx = Vec::with_capacity(rows.len());
    let mut domain = Vec::with_capacity(rows.len());
    let mut email = Vec::with_capacity(rows.len());
    let mut email2 = Vec::with_capacity(rows.len());
    let mut phone = Vec::with_capacity(rows.len());
    let mut phone2 = Vec::with_capacity(rows.len());
    let mut name = Vec::with_capacity(rows.len());
    let mut city = Vec::with_capacity(rows.len());
    for (i, r) in rows.iter().enumerate() {
        idx.push(i as i32);
        domain.push(norm_domain(&r.website_url));
        email.push(r.business_email.as_ref().map(|e| e.to_lowercase()));
        email2.push(r.contact_email.as_ref().map(|e| e.to_lowercase()));
        phone.push(norm_phone(&r.business_phone));
        phone2.push(norm_phone(&r.contact_phone));
        name.push(norm_name(&r.business_name));
        city.push(r.city.as_ref().map(|c| c.to_lowercase()).unwrap_or_default());
    }

    let rows = sqlx::query_as::<_, MatchRow>(
        r#"
        with input as (
          select * from unnest($1::int[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[])
            as t(idx, domain, email, email2, phone, phone2, name, city)
        ),
        live as (
          select l.id, l.created_at, l.company_id, l.primary_contact_id from public.leads l where l.deleted_at is null
        ),
        m as (
          select i.idx, l.id, l.created_at, 1 as rank, 'website' as matched_by
          from input i
          join public.companies c on i.domain is not null and public.normalize_domain(c.website_url) = i.domain
                                  and c.website_url is not null and c.deleted_at is null
          join live l on l.company_id = c.id
          union all
          select i.idx, l.id, l.created_at, 2, 'email'
          from input i
          join public.companies c on lower(c.email) in (i.email, i.email2) and c.deleted_at is null
          join live l on l.company_id = c.id
          union all
          select i.idx, l.id, l.created_at, 2, 'email'
          from input i
          join public.contacts ct on lower(ct.email) in (i.email, i.email2) and ct.deleted_at is null and ct.email is not null
          join live l on l.company_id = ct.company_id
          union all
          select i.idx, l.id, l.created_at, 3, 'phone'
          from input i
          join public.companies c on public.normalize_phone(c.phone) in (i.phone, i.phone2)
                                  and c.phone is not null and c.deleted_at is null
          join live l on l.company_id = c.id
          union all
          select i.idx, l.id, l.created_at, 3, 'phone'
          from input i
          join public.contacts ct on public.normalize_phone(ct.phone) in (i.phone, i.phone2)
                                 and ct.phone is not null and ct.deleted_at is null
          join live l on l.company_id = ct.company_id
          union all
          select i.idx, l.id, l.created_at, 4, 'name and city'
          from input i
          join public.companies c on i.name is not null and public.normalize_name(c.name) = i.name
                                  and lower(coalesce(c.city, '')) = i.city and c.deleted_at is null
          join live l on l.company_id = c.id
        )
        select distinct on (m.idx) m.idx, m.id as lead_id, c.name as business_name, c.city, m.matched_by
        from m
        join public.leads l on l.id = m.id
        join public.companies c on c.id = l.company_id
        order by m.idx, m.rank, m.created_at
        "#,
    )
    .bind(&idx)
    .bind(&domain)
    .bind(&email)
    .bind(&email2)
    .bind(&phone)
    .bind(&phone2)
    .bind(&name)
    .bind(&city)
    .fetch_all(db)
    .await?;

    Ok(rows
        .into_iter()
        .map(|r| {
            (
                r.idx as usize,
                Match { lead_id: r.lead_id, business_name: r.business_name, city: r.city, matched_by: r.matched_by },
            )
        })
        .collect())
}

// ---------------------------------------------------------------------------
// Duplicate groups across the whole lead base
// ---------------------------------------------------------------------------

#[derive(Serialize, sqlx::FromRow)]
pub struct GroupMember {
    id: Uuid,
    business_name: String,
    city: Option<String>,
    market: String,
    website_url: Option<String>,
    contact_name: Option<String>,
    contact_email: Option<String>,
    stage_name: String,
    status: String,
    assigned_name: Option<String>,
    created_at: DateTime<Utc>,
}

#[derive(Serialize)]
pub struct DuplicateGroup {
    matched_by: String,
    value: String,
    leads: Vec<GroupMember>,
}

#[derive(sqlx::FromRow)]
struct GroupKey {
    matched_by: String,
    value: String,
    ids: Vec<Uuid>,
}

pub async fn groups(State(state): State<AppState>, user: AuthUser) -> AppResult<Json<Vec<DuplicateGroup>>> {
    user.require("leads.edit")?;
    if !user.can("leads.view_all") {
        return Err(AppError::forbidden("Finding duplicates needs access to all leads."));
    }
    let db = &state.db;

    let keys = sqlx::query_as::<_, GroupKey>(
        r#"
        with live as (
          select l.id, l.created_at, c.website_url, c.email, c.phone, c.name, c.city, ct.email as contact_email
          from public.leads l
          join public.companies c on c.id = l.company_id
          left join public.contacts ct on ct.id = l.primary_contact_id
          where l.deleted_at is null
        ),
        k as (
          select 'website' as matched_by, public.normalize_domain(website_url) as value, id, created_at from live
          union all
          select 'email', lower(coalesce(contact_email, email)), id, created_at from live
          union all
          select 'phone', public.normalize_phone(phone), id, created_at from live
          union all
          select 'name and city', public.normalize_name(name) || coalesce(' · ' || lower(city), ''), id, created_at from live
        )
        select matched_by, value, array_agg(id order by created_at) as ids
        from k
        where value is not null
        group by matched_by, value
        having count(distinct id) > 1
        order by count(*) desc, value
        limit 200
        "#,
    )
    .fetch_all(db)
    .await?;

    // A pair that matches on several keys is shown once, under its strongest key.
    let mut seen = std::collections::HashSet::new();
    let keys: Vec<GroupKey> = keys
        .into_iter()
        .filter(|k| {
            let mut ids = k.ids.clone();
            ids.sort();
            seen.insert(ids)
        })
        .collect();

    let all_ids: Vec<Uuid> = keys.iter().flat_map(|k| k.ids.iter().copied()).collect();
    let members = sqlx::query_as::<_, GroupMember>(
        "select id, business_name, city, market, website_url, contact_name, contact_email, stage_name, status,
                assigned_name, created_at
         from public.lead_overview where id = any($1)",
    )
    .bind(&all_ids)
    .fetch_all(db)
    .await?;
    let by_id: std::collections::HashMap<Uuid, GroupMember> = members.into_iter().map(|m| (m.id, m)).collect();

    let groups = keys
        .into_iter()
        .map(|k| DuplicateGroup {
            matched_by: k.matched_by,
            value: k.value,
            leads: k
                .ids
                .iter()
                .filter_map(|id| by_id.get(id))
                .map(|m| GroupMember {
                    id: m.id,
                    business_name: m.business_name.clone(),
                    city: m.city.clone(),
                    market: m.market.clone(),
                    website_url: m.website_url.clone(),
                    contact_name: m.contact_name.clone(),
                    contact_email: m.contact_email.clone(),
                    stage_name: m.stage_name.clone(),
                    status: m.status.clone(),
                    assigned_name: m.assigned_name.clone(),
                    created_at: m.created_at,
                })
                .collect(),
        })
        .filter(|g| g.leads.len() > 1)
        .collect();

    Ok(Json(groups))
}

#[derive(Deserialize)]
pub struct MergeRequest {
    keep_id: Uuid,
    merge_ids: Vec<Uuid>,
}

/// Folds duplicates into one lead: history, lists, follow-ups, deals and proposals move
/// to the kept lead, blank business fields are filled from the duplicates, and the
/// duplicates are soft-deleted.
pub async fn merge(
    State(state): State<AppState>,
    user: AuthUser,
    Json(req): Json<MergeRequest>,
) -> AppResult<Json<super::LeadRow>> {
    user.require("leads.edit")?;
    user.require("leads.delete")?;
    if !user.can("leads.view_all") {
        return Err(AppError::forbidden("Merging needs access to all leads."));
    }
    let merge_ids: Vec<Uuid> = req.merge_ids.into_iter().filter(|id| *id != req.keep_id).collect();
    if merge_ids.is_empty() || merge_ids.len() > 50 {
        return Err(AppError::BadRequest("Choose between 1 and 50 leads to merge.".into()));
    }

    let mut tx = state.db.begin().await?;
    let found: i64 = sqlx::query_scalar("select count(*) from public.leads where deleted_at is null and id = any($1)")
        .bind([vec![req.keep_id], merge_ids.clone()].concat())
        .fetch_one(&mut *tx)
        .await?;
    if found as usize != merge_ids.len() + 1 {
        return Err(AppError::NotFound);
    }

    // Fill blank company fields on the kept lead from the duplicates (oldest first).
    sqlx::query(
        r#"
        update public.companies k set
          industry        = coalesce(k.industry, d.industry),
          category        = coalesce(k.category, d.category),
          country         = coalesce(k.country, d.country),
          region          = coalesce(k.region, d.region),
          city            = coalesce(k.city, d.city),
          address         = coalesce(k.address, d.address),
          website_url     = coalesce(k.website_url, d.website_url),
          facebook_url    = coalesce(k.facebook_url, d.facebook_url),
          instagram_url   = coalesce(k.instagram_url, d.instagram_url),
          linkedin_url    = coalesce(k.linkedin_url, d.linkedin_url),
          google_maps_url = coalesce(k.google_maps_url, d.google_maps_url),
          phone           = coalesce(k.phone, d.phone),
          email           = coalesce(k.email, d.email)
        from (
          select (array_agg(c.industry order by l.created_at) filter (where c.industry is not null))[1] as industry,
                 (array_agg(c.category order by l.created_at) filter (where c.category is not null))[1] as category,
                 (array_agg(c.country order by l.created_at) filter (where c.country is not null))[1] as country,
                 (array_agg(c.region order by l.created_at) filter (where c.region is not null))[1] as region,
                 (array_agg(c.city order by l.created_at) filter (where c.city is not null))[1] as city,
                 (array_agg(c.address order by l.created_at) filter (where c.address is not null))[1] as address,
                 (array_agg(c.website_url order by l.created_at) filter (where c.website_url is not null))[1] as website_url,
                 (array_agg(c.facebook_url order by l.created_at) filter (where c.facebook_url is not null))[1] as facebook_url,
                 (array_agg(c.instagram_url order by l.created_at) filter (where c.instagram_url is not null))[1] as instagram_url,
                 (array_agg(c.linkedin_url order by l.created_at) filter (where c.linkedin_url is not null))[1] as linkedin_url,
                 (array_agg(c.google_maps_url order by l.created_at) filter (where c.google_maps_url is not null))[1] as google_maps_url,
                 (array_agg(c.phone order by l.created_at) filter (where c.phone is not null))[1] as phone,
                 (array_agg(c.email order by l.created_at) filter (where c.email is not null))[1] as email
          from public.leads l join public.companies c on c.id = l.company_id
          where l.id = any($2)
        ) d
        where k.id = (select company_id from public.leads where id = $1)
        "#,
    )
    .bind(req.keep_id)
    .bind(&merge_ids)
    .execute(&mut *tx)
    .await?;

    for sql in [
        "update public.lead_interactions set lead_id = $1 where lead_id = any($2)",
        "update public.follow_ups set lead_id = $1 where lead_id = any($2)",
        "update public.meetings set lead_id = $1 where lead_id = any($2)",
        "update public.deals set lead_id = $1 where lead_id = any($2)",
        "update public.proposals set lead_id = $1 where lead_id = any($2)",
        "insert into public.lead_list_members (list_id, lead_id, added_by)
           select distinct list_id, $1, added_by from public.lead_list_members where lead_id = any($2)
           on conflict do nothing",
        "insert into public.lead_research (lead_id, website_quality, social_activity, branding_quality,
             content_consistency, online_presence, marketing_weaknesses, potential_services, findings,
             outreach_strategy, researched_by)
           select $1, website_quality, social_activity, branding_quality, content_consistency, online_presence,
             marketing_weaknesses, potential_services, findings, outreach_strategy, researched_by
           from public.lead_research where lead_id = any($2)
           order by updated_at desc limit 1
           on conflict (lead_id) do nothing",
        "update public.activities set entity_id = $1 where entity_type = 'lead' and entity_id = any($2)",
        "update public.leads set deleted_at = now() where id = any($2)",
    ] {
        sqlx::query(sql).bind(req.keep_id).bind(&merge_ids).execute(&mut *tx).await?;
    }

    audit::record(
        &mut *tx,
        AuditEntry {
            actor_id: Some(user.id),
            action: "leads.merged",
            entity_type: Some("lead"),
            entity_id: Some(req.keep_id),
            changes: json!({ "merged": merge_ids }),
        },
    )
    .await?;
    audit::activity(&mut *tx, user.id, "lead", req.keep_id, "lead.merged",
        &format!("{} merged {} duplicate lead(s) into this one", user.full_name, merge_ids.len())).await?;
    tx.commit().await?;

    Ok(Json(super::fetch_lead(&state.db, req.keep_id).await?))
}
