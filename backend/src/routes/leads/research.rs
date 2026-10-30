//! Research workspace for a lead: scored assessment of its online presence and the
//! outreach strategy. AI suggestions (Phase 6) are stored separately and always labeled.

use axum::{
    extract::{Path, State},
    Json,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::ensure_visible;
use crate::{
    auth::AuthUser,
    error::AppResult,
    state::AppState,
    validate::{clean, Validator},
};

#[derive(Serialize, sqlx::FromRow, Default)]
pub struct Research {
    website_quality: Option<i16>,
    social_activity: Option<i16>,
    branding_quality: Option<i16>,
    content_consistency: Option<i16>,
    online_presence: Option<i16>,
    marketing_weaknesses: Option<String>,
    potential_services: Vec<String>,
    findings: Option<String>,
    outreach_strategy: Option<String>,
    ai_suggestions: Option<serde_json::Value>,
    ai_generated_at: Option<DateTime<Utc>>,
    researched_by_name: Option<String>,
    updated_at: Option<DateTime<Utc>>,
}

async fn fetch(state: &AppState, lead_id: Uuid) -> AppResult<Option<Research>> {
    Ok(sqlx::query_as::<_, Research>(
        "select r.website_quality, r.social_activity, r.branding_quality, r.content_consistency, r.online_presence,
                r.marketing_weaknesses, r.potential_services, r.findings, r.outreach_strategy, r.ai_suggestions,
                r.ai_generated_at, p.full_name as researched_by_name, r.updated_at
         from public.lead_research r left join public.profiles p on p.id = r.researched_by
         where r.lead_id = $1",
    )
    .bind(lead_id)
    .fetch_optional(&state.db)
    .await?)
}

pub async fn get(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<Option<Research>>> {
    user.require("leads.view")?;
    ensure_visible(&state.db, &user, id).await?;
    Ok(Json(fetch(&state, id).await?))
}

#[derive(Deserialize)]
pub struct ResearchInput {
    website_quality: Option<i16>,
    social_activity: Option<i16>,
    branding_quality: Option<i16>,
    content_consistency: Option<i16>,
    online_presence: Option<i16>,
    marketing_weaknesses: Option<String>,
    #[serde(default)]
    potential_services: Vec<String>,
    findings: Option<String>,
    outreach_strategy: Option<String>,
}

pub async fn save(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Json(input): Json<ResearchInput>,
) -> AppResult<Json<Option<Research>>> {
    user.require("leads.edit")?;
    ensure_visible(&state.db, &user, id).await?;

    let mut v = Validator::new();
    for (field, score) in [
        ("website_quality", input.website_quality),
        ("social_activity", input.social_activity),
        ("branding_quality", input.branding_quality),
        ("content_consistency", input.content_consistency),
        ("online_presence", input.online_presence),
    ] {
        if score.is_some_and(|s| !(1..=5).contains(&s)) {
            v.fail(field, "Score from 1 to 5.");
        }
    }
    v.optional_text("marketing_weaknesses", input.marketing_weaknesses.as_deref(), 5000);
    v.optional_text("findings", input.findings.as_deref(), 10_000);
    v.optional_text("outreach_strategy", input.outreach_strategy.as_deref(), 5000);
    v.finish()?;

    let services: Vec<String> =
        input.potential_services.iter().map(|s| s.trim().to_owned()).filter(|s| !s.is_empty()).take(20).collect();

    let mut tx = state.db.begin().await?;
    sqlx::query(
        "insert into public.lead_research (lead_id, website_quality, social_activity, branding_quality,
           content_consistency, online_presence, marketing_weaknesses, potential_services, findings,
           outreach_strategy, researched_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         on conflict (lead_id) do update set website_quality = excluded.website_quality,
           social_activity = excluded.social_activity, branding_quality = excluded.branding_quality,
           content_consistency = excluded.content_consistency, online_presence = excluded.online_presence,
           marketing_weaknesses = excluded.marketing_weaknesses, potential_services = excluded.potential_services,
           findings = excluded.findings, outreach_strategy = excluded.outreach_strategy,
           researched_by = excluded.researched_by",
    )
    .bind(id)
    .bind(input.website_quality)
    .bind(input.social_activity)
    .bind(input.branding_quality)
    .bind(input.content_consistency)
    .bind(input.online_presence)
    .bind(clean(input.marketing_weaknesses))
    .bind(&services)
    .bind(clean(input.findings))
    .bind(clean(input.outreach_strategy))
    .bind(user.id)
    .execute(&mut *tx)
    .await?;
    // Research findings also feed the lead's suggested services when the lead has none yet.
    sqlx::query("update public.leads set potential_services = $2 where id = $1 and potential_services = '{}'")
        .bind(id)
        .bind(&services)
        .execute(&mut *tx)
        .await?;
    crate::audit::activity(&mut *tx, user.id, "lead", id, "lead.researched", &format!("{} updated the research", user.full_name)).await?;
    tx.commit().await?;

    Ok(Json(fetch(&state, id).await?))
}
