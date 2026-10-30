//! Lead -> client conversion. The client reuses the lead's company and contacts, so no
//! business information is re-entered or duplicated.

use axum::{
    extract::{Path, State},
    Json,
};
use chrono::NaiveDate;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use serde_json::json;
use uuid::Uuid;

use super::proposals::BILLING;
use crate::{
    audit::{self, AuditEntry},
    auth::AuthUser,
    error::{AppError, AppResult},
    routes::leads::ensure_visible,
    state::AppState,
    validate::{clean, Validator},
};

#[derive(Deserialize)]
pub struct ServiceInput {
    service_id: Option<Uuid>,
    name: String,
    price: Decimal,
    currency: String,
    billing_type: String,
    start_date: Option<NaiveDate>,
}

#[derive(Deserialize)]
pub struct ConvertInput {
    account_manager_id: Option<Uuid>,
    status: Option<String>,
    client_since: Option<NaiveDate>,
    deal_id: Option<Uuid>,
    proposal_id: Option<Uuid>,
    notes: Option<String>,
    #[serde(default)]
    services: Vec<ServiceInput>,
}

#[derive(Serialize)]
pub struct Converted {
    client_id: Uuid,
    already_client: bool,
}

pub async fn convert(
    State(state): State<AppState>,
    user: AuthUser,
    Path(lead_id): Path<Uuid>,
    Json(input): Json<ConvertInput>,
) -> AppResult<Json<Converted>> {
    user.require("sales.manage")?;
    if !user.can("clients.manage") && !user.can("leads.edit") {
        return Err(AppError::forbidden("You can't create clients."));
    }
    ensure_visible(&state.db, &user, lead_id).await?;

    let mut v = Validator::new();
    if let Some(s) = &input.status {
        v.one_of("status", s, &["onboarding", "active"]);
    }
    v.optional_text("notes", input.notes.as_deref(), 5000);
    for (i, s) in input.services.iter().enumerate() {
        if s.name.trim().is_empty() {
            v.fail(&format!("services.{i}.name"), "Name every service.");
        }
        if s.price.is_sign_negative() {
            v.fail(&format!("services.{i}.price"), "Price can't be negative.");
        }
        if !BILLING.contains(&s.billing_type.as_str()) {
            v.fail(&format!("services.{i}.billing_type"), "Unknown billing type.");
        }
    }
    v.finish()?;

    let mut tx = state.db.begin().await?;
    let (company_id, company_name, assigned): (Uuid, String, Option<Uuid>) = sqlx::query_as(
        "select l.company_id, c.name, l.assigned_to from public.leads l join public.companies c on c.id = l.company_id
         where l.id = $1 for update of l",
    )
    .bind(lead_id)
    .fetch_one(&mut *tx)
    .await?;

    if let Some(existing) = sqlx::query_scalar::<_, Uuid>(
        "select id from public.clients where company_id = $1 and deleted_at is null",
    )
    .bind(company_id)
    .fetch_optional(&mut *tx)
    .await?
    {
        return Ok(Json(Converted { client_id: existing, already_client: true }));
    }

    let client_id: Uuid = sqlx::query_scalar(
        "insert into public.clients (company_id, lead_id, deal_id, proposal_id, status, account_manager_id, client_since, notes, created_by)
         values ($1, $2, $3, $4, coalesce($5, 'onboarding'), coalesce($6, $7), coalesce($8, current_date), $9, $10)
         returning id",
    )
    .bind(company_id)
    .bind(lead_id)
    .bind(input.deal_id)
    .bind(input.proposal_id)
    .bind(&input.status)
    .bind(input.account_manager_id)
    .bind(assigned)
    .bind(input.client_since)
    .bind(clean(input.notes.clone()))
    .bind(user.id)
    .fetch_one(&mut *tx)
    .await?;

    for s in &input.services {
        sqlx::query(
            "insert into public.client_services (client_id, service_id, name, price, currency, billing_type, start_date)
             values ($1, $2, $3, $4, $5, $6, coalesce($7, current_date))",
        )
        .bind(client_id)
        .bind(s.service_id)
        .bind(s.name.trim())
        .bind(s.price)
        .bind(&s.currency)
        .bind(&s.billing_type)
        .bind(s.start_date)
        .execute(&mut *tx)
        .await?;
    }

    sqlx::query(
        "update public.leads set status = 'converted', converted_at = now(), next_action = null, next_action_due_at = null,
           stage_id = coalesce((select id from public.pipeline_stages where kind = 'won' and archived_at is null order by position limit 1), stage_id)
         where id = $1",
    )
    .bind(lead_id)
    .execute(&mut *tx)
    .await?;
    // Win any open deal on this lead (the chosen one, or all open ones if none was chosen).
    sqlx::query(
        "update public.deals set status = 'won', won_at = coalesce(won_at, now())
         where lead_id = $1 and status = 'open' and deleted_at is null and ($2::uuid is null or id = $2)",
    )
    .bind(lead_id)
    .bind(input.deal_id)
    .execute(&mut *tx)
    .await?;

    audit::activity(&mut *tx, user.id, "lead", lead_id, "lead.converted", &format!("{} converted {company_name} into a client", user.full_name)).await?;
    audit::activity(&mut *tx, user.id, "client", client_id, "client.created", &format!("{company_name} became a client")).await?;
    audit::record(
        &mut *tx,
        AuditEntry { actor_id: Some(user.id), action: "lead.converted", entity_type: Some("client"), entity_id: Some(client_id), changes: json!({ "lead_id": lead_id }) },
    )
    .await?;
    tx.commit().await?;

    Ok(Json(Converted { client_id, already_client: false }))
}
