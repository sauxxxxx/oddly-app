//! Spreadsheet import. The desktop app parses XLSX/CSV, maps columns and sends rows in
//! batches; this module validates them, detects duplicates and writes each batch with a
//! handful of set-based statements.

use std::collections::{BTreeMap, HashMap};

use axum::{extract::State, Json};
use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::{Postgres, QueryBuilder};
use uuid::Uuid;

use super::{duplicates, push_scope, LeadInput};
use crate::{
    auth::AuthUser,
    error::{AppError, AppResult},
    state::AppState,
    validate::Validator,
};

const MAX_BATCH: usize = 500;

#[derive(Deserialize, Clone)]
pub struct ImportRow {
    #[serde(flatten)]
    input: LeadInput,
    /// Free-text source / stage names from the spreadsheet, matched to configured values.
    source_name: Option<String>,
    stage_name: Option<String>,
}

#[derive(Deserialize, Default)]
pub struct ImportOptions {
    list_id: Option<Uuid>,
    assigned_to: Option<Uuid>,
    source_id: Option<Uuid>,
    stage_id: Option<Uuid>,
}

#[derive(Serialize)]
pub struct RowIssue {
    index: usize,
    errors: BTreeMap<String, String>,
    duplicate: Option<duplicates::Match>,
    duplicate_of_row: Option<usize>,
}

struct Resolver {
    sources: HashMap<String, Uuid>,
    stages: HashMap<String, Uuid>,
}

impl Resolver {
    async fn load(state: &AppState) -> AppResult<Self> {
        let sources: Vec<(Uuid, String, String)> =
            sqlx::query_as("select id, key, name from public.lead_sources").fetch_all(&state.db).await?;
        let stages: Vec<(Uuid, String)> =
            sqlx::query_as("select id, name from public.pipeline_stages where archived_at is null")
                .fetch_all(&state.db)
                .await?;
        let mut source_map = HashMap::new();
        for (id, key, name) in sources {
            source_map.insert(simplify(&key), id);
            source_map.insert(simplify(&name), id);
        }
        Ok(Self {
            sources: source_map,
            stages: stages.into_iter().map(|(id, name)| (simplify(&name), id)).collect(),
        })
    }

    /// Fills ids from names and options; returns field errors for names that don't match.
    fn apply(&self, row: ImportRow, opts: &ImportOptions, v: &mut Validator) -> LeadInput {
        let mut input = row.input.normalized();
        if input.source_id.is_none() {
            input.source_id = match row.source_name.as_deref().map(simplify).filter(|s| !s.is_empty()) {
                Some(name) => match self.sources.get(&name).copied() {
                    Some(id) => Some(id),
                    None => {
                        // Keep what the sheet said so nothing is lost.
                        input.source_detail = input.source_detail.or(row.source_name.clone());
                        self.sources.get("other").copied().or(opts.source_id)
                    }
                },
                None => opts.source_id,
            };
        }
        if input.stage_id.is_none() {
            if let Some(name) = row.stage_name.as_deref().map(simplify).filter(|s| !s.is_empty()) {
                match self.stages.get(&name) {
                    Some(id) => input.stage_id = Some(*id),
                    None => v.fail("stage_name", format!("Unknown pipeline stage \"{}\".", row.stage_name.unwrap_or_default())),
                }
            }
        }
        input.stage_id = input.stage_id.or(opts.stage_id);
        input.assigned_to = input.assigned_to.or(opts.assigned_to);
        input
    }
}

fn simplify(s: &str) -> String {
    s.to_lowercase().chars().filter(char::is_ascii_alphanumeric).collect()
}

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct PreviewRequest {
    rows: Vec<ImportRow>,
    #[serde(default)]
    options: ImportOptions,
    /// Index of the first row in this batch within the whole file.
    #[serde(default)]
    offset: usize,
}

/// Validates a batch and reports duplicates without writing anything.
pub async fn preview(
    State(state): State<AppState>,
    user: AuthUser,
    Json(req): Json<PreviewRequest>,
) -> AppResult<Json<Vec<RowIssue>>> {
    user.require("leads.import")?;
    if req.rows.len() > MAX_BATCH {
        return Err(AppError::BadRequest(format!("Send at most {MAX_BATCH} rows at a time.")));
    }
    let resolver = Resolver::load(&state).await?;
    let (inputs, errors) = prepare(&resolver, req.rows, &req.options);
    let matches: HashMap<usize, duplicates::Match> =
        duplicates::find_matches(&state.db, &inputs).await?.into_iter().collect();
    let in_file = in_file_duplicates(&inputs);

    let issues = (0..inputs.len())
        .filter_map(|i| {
            let errs = errors[i].clone();
            let dup = matches.get(&i).cloned();
            let dup_row = in_file.get(&i).map(|j| j + req.offset);
            (!errs.is_empty() || dup.is_some() || dup_row.is_some()).then_some(RowIssue {
                index: i + req.offset,
                errors: errs,
                duplicate: dup,
                duplicate_of_row: dup_row,
            })
        })
        .collect();
    Ok(Json(issues))
}

fn prepare(
    resolver: &Resolver,
    rows: Vec<ImportRow>,
    opts: &ImportOptions,
) -> (Vec<LeadInput>, Vec<BTreeMap<String, String>>) {
    let mut inputs = Vec::with_capacity(rows.len());
    let mut errors = Vec::with_capacity(rows.len());
    for row in rows {
        let mut v = Validator::new();
        let input = resolver.apply(row, opts, &mut v);
        input.validate(&mut v);
        errors.push(match v.finish() {
            Ok(()) => BTreeMap::new(),
            Err(AppError::Validation(f)) => f,
            Err(_) => BTreeMap::new(),
        });
        inputs.push(input);
    }
    (inputs, errors)
}

/// Rows that repeat an earlier row in the same batch -> index of that earlier row.
fn in_file_duplicates(inputs: &[LeadInput]) -> HashMap<usize, usize> {
    let mut first_seen: HashMap<String, usize> = HashMap::new();
    let mut dups = HashMap::new();
    for (i, input) in inputs.iter().enumerate() {
        let keys = duplicates::keys(input);
        if let Some(&j) = keys.iter().find_map(|k| first_seen.get(k)) {
            dups.insert(i, j);
        } else {
            for k in keys {
                first_seen.entry(k).or_insert(i);
            }
        }
    }
    dups
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct ImportRequest {
    job_id: Option<Uuid>,
    file_name: String,
    /// skip: leave existing leads alone · update: fill existing leads from the file ·
    /// create: always create new leads.
    mode: String,
    rows: Vec<ImportRow>,
    #[serde(default)]
    options: ImportOptions,
    #[serde(default)]
    offset: usize,
    /// Total rows in the file (first batch only), for the job record.
    total_rows: Option<i32>,
    /// Marks the job finished after this batch.
    #[serde(default)]
    last: bool,
}

#[derive(Serialize, Clone)]
pub struct RowResult {
    index: usize,
    outcome: &'static str,
    lead_id: Option<Uuid>,
    message: Option<String>,
}

#[derive(Serialize)]
pub struct ImportResponse {
    job_id: Uuid,
    results: Vec<RowResult>,
}

pub async fn import(
    State(state): State<AppState>,
    user: AuthUser,
    Json(req): Json<ImportRequest>,
) -> AppResult<Json<ImportResponse>> {
    user.require("leads.import")?;
    user.require("leads.create")?;
    if req.rows.len() > MAX_BATCH {
        return Err(AppError::BadRequest(format!("Send at most {MAX_BATCH} rows at a time.")));
    }
    if !["skip", "update", "create"].contains(&req.mode.as_str()) {
        return Err(AppError::BadRequest("Unknown duplicate handling mode.".into()));
    }
    if req.mode == "update" {
        user.require("leads.edit")?;
    }

    let resolver = Resolver::load(&state).await?;
    let (inputs, errors) = prepare(&resolver, req.rows, &req.options);
    let default_stage: Uuid = sqlx::query_scalar(
        "select id from public.pipeline_stages where archived_at is null order by is_default desc, position limit 1",
    )
    .fetch_one(&state.db)
    .await?;

    let matches: HashMap<usize, duplicates::Match> = if req.mode == "create" {
        HashMap::new()
    } else {
        duplicates::find_matches(&state.db, &inputs).await?.into_iter().collect()
    };
    let in_file = if req.mode == "create" { HashMap::new() } else { in_file_duplicates(&inputs) };

    // Users without leads.view_all may only update leads they can see.
    let updatable: std::collections::HashSet<Uuid> = if req.mode == "update" && !matches.is_empty() {
        let ids: Vec<Uuid> = matches.values().map(|m| m.lead_id).collect();
        let mut qb = QueryBuilder::<Postgres>::new("select l.id from public.leads l where l.deleted_at is null and l.id = any(");
        qb.push_bind(ids).push(")");
        push_scope(&mut qb, &user, "l");
        qb.build_query_scalar::<Uuid>().fetch_all(&state.db).await?.into_iter().collect()
    } else {
        Default::default()
    };

    let mut results = Vec::with_capacity(inputs.len());
    let mut to_create: Vec<(usize, &LeadInput)> = Vec::new();
    let mut to_update: Vec<(usize, Uuid, &LeadInput)> = Vec::new();

    for (i, input) in inputs.iter().enumerate() {
        let index = i + req.offset;
        if !errors[i].is_empty() {
            let message = errors[i].iter().map(|(f, m)| format!("{f}: {m}")).collect::<Vec<_>>().join(" ");
            results.push(RowResult { index, outcome: "failed", lead_id: None, message: Some(message) });
        } else if let Some(j) = in_file.get(&i) {
            results.push(RowResult {
                index,
                outcome: "skipped",
                lead_id: None,
                message: Some(format!("Same business as row {} in this file.", j + req.offset + 1)),
            });
        } else if let Some(m) = matches.get(&i) {
            if req.mode == "update" && updatable.contains(&m.lead_id) {
                to_update.push((index, m.lead_id, input));
            } else {
                let why = if req.mode == "update" { " (assigned to someone else)" } else { "" };
                results.push(RowResult {
                    index,
                    outcome: "skipped",
                    lead_id: Some(m.lead_id),
                    message: Some(format!("Already exists as {} — matched by {}{why}.", m.business_name, m.matched_by)),
                });
            }
        } else {
            to_create.push((index, input));
        }
    }

    let mut tx = state.db.begin().await?;

    let job_id = match req.job_id {
        Some(id) => id,
        None => sqlx::query_scalar(
            "insert into public.import_jobs (user_id, file_name, mode, total_rows) values ($1, $2, $3, $4) returning id",
        )
        .bind(user.id)
        .bind(req.file_name.chars().take(255).collect::<String>())
        .bind(&req.mode)
        .bind(req.total_rows.unwrap_or(inputs.len() as i32))
        .fetch_one(&mut *tx)
        .await?,
    };

    let created_ids = insert_leads(&mut tx, &to_create, default_stage, user.id).await?;
    for ((index, _), lead_id) in to_create.iter().zip(&created_ids) {
        results.push(RowResult { index: *index, outcome: "created", lead_id: Some(*lead_id), message: None });
    }

    update_leads(&mut tx, &to_update).await?;
    for (index, lead_id, _) in &to_update {
        results.push(RowResult { index: *index, outcome: "updated", lead_id: Some(*lead_id), message: None });
    }

    let touched: Vec<Uuid> = created_ids.iter().copied().chain(to_update.iter().map(|(_, id, _)| *id)).collect();
    if let Some(list_id) = req.options.list_id {
        sqlx::query(
            "insert into public.lead_list_members (list_id, lead_id, added_by)
             select $1, unnest($2::uuid[]), $3 on conflict do nothing",
        )
        .bind(list_id)
        .bind(&touched)
        .bind(user.id)
        .execute(&mut *tx)
        .await?;
    }
    if !created_ids.is_empty() {
        sqlx::query(
            "insert into public.activities (actor_id, entity_type, entity_id, action, summary)
             select $1, 'lead', unnest($2::uuid[]), 'lead.imported', $3",
        )
        .bind(user.id)
        .bind(&created_ids)
        .bind(format!("{} imported this lead from {}", user.full_name, req.file_name))
        .execute(&mut *tx)
        .await?;
    }

    let count = |o: &str| results.iter().filter(|r| r.outcome == o).count() as i32;
    let failures: Vec<serde_json::Value> = results
        .iter()
        .filter(|r| r.outcome == "failed")
        .take(1000)
        .map(|r| json!({ "row": r.index + 1, "message": r.message }))
        .collect();
    sqlx::query(
        "update public.import_jobs set created = created + $2, updated = updated + $3, skipped = skipped + $4,
           failed = failed + $5, errors = (errors || $6::jsonb),
           finished_at = case when $7 then now() else finished_at end
         where id = $1 and user_id = $8",
    )
    .bind(job_id)
    .bind(count("created"))
    .bind(count("updated"))
    .bind(count("skipped"))
    .bind(count("failed"))
    .bind(serde_json::Value::Array(failures))
    .bind(req.last)
    .bind(user.id)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    results.sort_by_key(|r| r.index);
    Ok(Json(ImportResponse { job_id, results }))
}

/// Inserts companies, contacts and leads for new rows with three statements.
async fn insert_leads(
    tx: &mut sqlx::Transaction<'_, Postgres>,
    rows: &[(usize, &LeadInput)],
    default_stage: Uuid,
    user_id: Uuid,
) -> AppResult<Vec<Uuid>> {
    if rows.is_empty() {
        return Ok(Vec::new());
    }
    let n = rows.len();
    let company_ids: Vec<Uuid> = (0..n).map(|_| Uuid::new_v4()).collect();
    let lead_ids: Vec<Uuid> = (0..n).map(|_| Uuid::new_v4()).collect();
    let contact_ids: Vec<Option<Uuid>> = rows.iter().map(|(_, r)| r.has_contact().then(Uuid::new_v4)).collect();

    let col = |f: fn(&LeadInput) -> Option<String>| rows.iter().map(|(_, r)| f(r)).collect::<Vec<_>>();

    sqlx::query(
        "insert into public.companies (id, name, industry, category, market, country, region, city, address,
           website_url, facebook_url, instagram_url, linkedin_url, google_maps_url, phone, email, created_by)
         select t.*, $17 from unnest($1::uuid[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[],
           $8::text[], $9::text[], $10::text[], $11::text[], $12::text[], $13::text[], $14::text[], $15::text[], $16::text[]) t",
    )
    .bind(&company_ids)
    .bind(col(|r| Some(r.business_name.clone())))
    .bind(col(|r| r.industry.clone()))
    .bind(col(|r| r.category.clone()))
    .bind(col(|r| Some(r.market.clone())))
    .bind(col(|r| r.country.clone()))
    .bind(col(|r| r.region.clone()))
    .bind(col(|r| r.city.clone()))
    .bind(col(|r| r.address.clone()))
    .bind(col(|r| r.website_url.clone()))
    .bind(col(|r| r.facebook_url.clone()))
    .bind(col(|r| r.instagram_url.clone()))
    .bind(col(|r| r.linkedin_url.clone()))
    .bind(col(|r| r.google_maps_url.clone()))
    .bind(col(|r| r.business_phone.clone()))
    .bind(col(|r| r.business_email.clone()))
    .bind(user_id)
    .execute(&mut **tx)
    .await?;

    let with_contact: Vec<usize> = (0..n).filter(|i| contact_ids[*i].is_some()).collect();
    if !with_contact.is_empty() {
        let pick = |f: fn(&LeadInput) -> Option<String>| with_contact.iter().map(|i| f(rows[*i].1)).collect::<Vec<_>>();
        sqlx::query(
            "insert into public.contacts (id, company_id, full_name, position, email, phone, is_primary)
             select t.id, t.company_id, coalesce(t.full_name, 'Unknown contact'), t.position, t.email, t.phone, true
             from unnest($1::uuid[], $2::uuid[], $3::text[], $4::text[], $5::text[], $6::text[])
               as t(id, company_id, full_name, position, email, phone)",
        )
        .bind(with_contact.iter().map(|i| contact_ids[*i].unwrap()).collect::<Vec<_>>())
        .bind(with_contact.iter().map(|i| company_ids[*i]).collect::<Vec<_>>())
        .bind(pick(|r| r.contact_name.clone()))
        .bind(pick(|r| r.contact_position.clone()))
        .bind(pick(|r| r.contact_email.clone()))
        .bind(pick(|r| r.contact_phone.clone()))
        .execute(&mut **tx)
        .await?;
    }

    sqlx::query(
        "insert into public.leads (id, company_id, primary_contact_id, source_id, source_detail, stage_id, status,
           priority, assigned_to, potential_services, estimated_value, currency, research_notes, next_action,
           next_action_due_at, created_by)
         select t.id, t.company_id, t.contact_id, t.source_id, t.source_detail, coalesce(t.stage_id, $16),
           coalesce(t.status, 'active'), coalesce(t.priority, 'medium'), coalesce(t.assigned_to, $17),
           coalesce(string_to_array(nullif(t.services, ''), '|'), '{}'), t.value, coalesce(t.currency, 'PHP'),
           t.notes, coalesce(t.next_action, $18), t.next_due, $17
         from unnest($1::uuid[], $2::uuid[], $3::uuid[], $4::uuid[], $5::text[], $6::uuid[], $7::text[], $8::text[],
           $9::uuid[], $10::text[], $11::numeric[], $12::text[], $13::text[], $14::text[], $15::timestamptz[])
           as t(id, company_id, contact_id, source_id, source_detail, stage_id, status, priority, assigned_to,
                services, value, currency, notes, next_action, next_due)",
    )
    .bind(&lead_ids)
    .bind(&company_ids)
    .bind(&contact_ids)
    .bind(rows.iter().map(|(_, r)| r.source_id).collect::<Vec<_>>())
    .bind(col(|r| r.source_detail.clone()))
    .bind(rows.iter().map(|(_, r)| r.stage_id).collect::<Vec<_>>())
    .bind(col(|r| r.status.clone()))
    .bind(col(|r| r.priority.clone()))
    .bind(rows.iter().map(|(_, r)| r.assigned_to).collect::<Vec<_>>())
    .bind(col(|r| Some(r.potential_services.join("|"))))
    .bind(rows.iter().map(|(_, r)| r.estimated_value).collect::<Vec<Option<Decimal>>>())
    .bind(col(|r| r.currency.clone()))
    .bind(col(|r| r.research_notes.clone()))
    .bind(col(|r| r.next_action.clone()))
    .bind(rows.iter().map(|(_, r)| r.next_action_due_at).collect::<Vec<Option<DateTime<Utc>>>>())
    .bind(default_stage)
    .bind(user_id)
    .bind(super::DEFAULT_NEXT_ACTION)
    .execute(&mut **tx)
    .await?;

    Ok(lead_ids)
}

/// Fills existing leads from the file: values present in the sheet win, blanks keep
/// what ODDLY already has.
async fn update_leads(tx: &mut sqlx::Transaction<'_, Postgres>, rows: &[(usize, Uuid, &LeadInput)]) -> AppResult<()> {
    if rows.is_empty() {
        return Ok(());
    }
    let ids: Vec<Uuid> = rows.iter().map(|(_, id, _)| *id).collect();
    let col = |f: fn(&LeadInput) -> Option<String>| rows.iter().map(|(_, _, r)| f(r)).collect::<Vec<_>>();

    sqlx::query(
        "update public.companies c set
           name = coalesce(x.name, c.name), industry = coalesce(x.industry, c.industry),
           category = coalesce(x.category, c.category), market = coalesce(x.market, c.market),
           country = coalesce(x.country, c.country), region = coalesce(x.region, c.region),
           city = coalesce(x.city, c.city), address = coalesce(x.address, c.address),
           website_url = coalesce(x.website, c.website_url), facebook_url = coalesce(x.facebook, c.facebook_url),
           instagram_url = coalesce(x.instagram, c.instagram_url), linkedin_url = coalesce(x.linkedin, c.linkedin_url),
           google_maps_url = coalesce(x.maps, c.google_maps_url), phone = coalesce(x.phone, c.phone),
           email = coalesce(x.email, c.email)
         from (
           select l.company_id, t.* from unnest($1::uuid[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[],
             $7::text[], $8::text[], $9::text[], $10::text[], $11::text[], $12::text[], $13::text[], $14::text[],
             $15::text[], $16::text[])
             as t(lead_id, name, industry, category, market, country, region, city, address, website, facebook,
                  instagram, linkedin, maps, phone, email)
           join public.leads l on l.id = t.lead_id
         ) x
         where c.id = x.company_id",
    )
    .bind(&ids)
    .bind(col(|r| Some(r.business_name.clone())))
    .bind(col(|r| r.industry.clone()))
    .bind(col(|r| r.category.clone()))
    .bind(col(|r| Some(r.market.clone())))
    .bind(col(|r| r.country.clone()))
    .bind(col(|r| r.region.clone()))
    .bind(col(|r| r.city.clone()))
    .bind(col(|r| r.address.clone()))
    .bind(col(|r| r.website_url.clone()))
    .bind(col(|r| r.facebook_url.clone()))
    .bind(col(|r| r.instagram_url.clone()))
    .bind(col(|r| r.linkedin_url.clone()))
    .bind(col(|r| r.google_maps_url.clone()))
    .bind(col(|r| r.business_phone.clone()))
    .bind(col(|r| r.business_email.clone()))
    .execute(&mut **tx)
    .await?;

    // Existing primary contacts get the sheet's values; leads without one get a new contact.
    let (cn, cp, ce, cph) = (
        col(|r| r.contact_name.clone()),
        col(|r| r.contact_position.clone()),
        col(|r| r.contact_email.clone()),
        col(|r| r.contact_phone.clone()),
    );
    sqlx::query(
        "update public.contacts ct set full_name = coalesce(x.name, ct.full_name),
           position = coalesce(x.position, ct.position), email = coalesce(x.email, ct.email),
           phone = coalesce(x.phone, ct.phone)
         from (
           select l.primary_contact_id, t.* from unnest($1::uuid[], $2::text[], $3::text[], $4::text[], $5::text[])
             as t(lead_id, name, position, email, phone)
           join public.leads l on l.id = t.lead_id where l.primary_contact_id is not null
         ) x
         where ct.id = x.primary_contact_id",
    )
    .bind(&ids)
    .bind(&cn)
    .bind(&cp)
    .bind(&ce)
    .bind(&cph)
    .execute(&mut **tx)
    .await?;
    sqlx::query(
        "with ins as (
           insert into public.contacts (company_id, full_name, position, email, phone, is_primary)
           select l.company_id, coalesce(t.name, 'Unknown contact'), t.position, t.email, t.phone, true
           from unnest($1::uuid[], $2::text[], $3::text[], $4::text[], $5::text[]) as t(lead_id, name, position, email, phone)
           join public.leads l on l.id = t.lead_id
           where l.primary_contact_id is null and coalesce(t.name, t.email, t.phone) is not null
           returning id, company_id
         )
         update public.leads l set primary_contact_id = ins.id
         from ins where l.company_id = ins.company_id and l.primary_contact_id is null and l.id = any($1)",
    )
    .bind(&ids)
    .bind(&cn)
    .bind(&cp)
    .bind(&ce)
    .bind(&cph)
    .execute(&mut **tx)
    .await?;

    sqlx::query(
        "update public.leads l set
           source_id = coalesce(t.source_id, l.source_id), source_detail = coalesce(t.source_detail, l.source_detail),
           stage_id = coalesce(t.stage_id, l.stage_id), priority = coalesce(t.priority, l.priority),
           assigned_to = coalesce(t.assigned_to, l.assigned_to),
           potential_services = case when t.services <> '' then string_to_array(t.services, '|') else l.potential_services end,
           estimated_value = coalesce(t.value, l.estimated_value), currency = coalesce(t.currency, l.currency),
           research_notes = coalesce(t.notes, l.research_notes), next_action = coalesce(t.next_action, l.next_action),
           next_action_due_at = coalesce(t.next_due, l.next_action_due_at)
         from unnest($1::uuid[], $2::uuid[], $3::text[], $4::uuid[], $5::text[], $6::uuid[], $7::text[], $8::numeric[],
           $9::text[], $10::text[], $11::text[], $12::timestamptz[])
           as t(lead_id, source_id, source_detail, stage_id, priority, assigned_to, services, value, currency, notes,
                next_action, next_due)
         where l.id = t.lead_id",
    )
    .bind(&ids)
    .bind(rows.iter().map(|(_, _, r)| r.source_id).collect::<Vec<_>>())
    .bind(col(|r| r.source_detail.clone()))
    .bind(rows.iter().map(|(_, _, r)| r.stage_id).collect::<Vec<_>>())
    .bind(col(|r| r.priority.clone()))
    .bind(rows.iter().map(|(_, _, r)| r.assigned_to).collect::<Vec<_>>())
    .bind(col(|r| Some(r.potential_services.join("|"))))
    .bind(rows.iter().map(|(_, _, r)| r.estimated_value).collect::<Vec<Option<Decimal>>>())
    .bind(col(|r| r.currency.clone()))
    .bind(col(|r| r.research_notes.clone()))
    .bind(col(|r| r.next_action.clone()))
    .bind(rows.iter().map(|(_, _, r)| r.next_action_due_at).collect::<Vec<Option<DateTime<Utc>>>>())
    .execute(&mut **tx)
    .await?;

    Ok(())
}

#[derive(Serialize, sqlx::FromRow)]
pub struct ImportJob {
    id: Uuid,
    file_name: String,
    mode: String,
    total_rows: i32,
    created: i32,
    updated: i32,
    skipped: i32,
    failed: i32,
    errors: serde_json::Value,
    user_name: Option<String>,
    started_at: DateTime<Utc>,
    finished_at: Option<DateTime<Utc>>,
}

/// Recent imports (all imports for users who see all leads; otherwise their own).
pub async fn history(State(state): State<AppState>, user: AuthUser) -> AppResult<Json<Vec<ImportJob>>> {
    user.require("leads.import")?;
    let jobs = sqlx::query_as::<_, ImportJob>(
        "select j.id, j.file_name, j.mode, j.total_rows, j.created, j.updated, j.skipped, j.failed, j.errors,
                p.full_name as user_name, j.started_at, j.finished_at
         from public.import_jobs j left join public.profiles p on p.id = j.user_id
         where ($1 or j.user_id = $2)
         order by j.started_at desc limit 30",
    )
    .bind(user.can("leads.view_all"))
    .bind(user.id)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(jobs))
}
