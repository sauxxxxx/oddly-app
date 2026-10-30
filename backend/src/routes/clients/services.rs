//! The agency's service catalog (also the presets for proposals and client services).

use axum::{
    extract::{Path, State},
    Json,
};
use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    auth::AuthUser,
    error::{AppError, AppResult},
    state::AppState,
    validate::{clean, Validator},
};

pub const CATEGORIES: &[&str] = &["graphic_design", "social_media", "content", "web_development", "web_maintenance", "branding", "seo", "ads", "other"];

#[derive(Serialize, sqlx::FromRow)]
pub struct Service {
    id: Uuid,
    name: String,
    category: String,
    description: Option<String>,
    billing_type: String,
    default_price: Option<Decimal>,
    currency: String,
    is_package: bool,
    is_active: bool,
    active_clients: i64,
    created_at: DateTime<Utc>,
}

const SELECT: &str = "select s.id, s.name, s.category, s.description, s.billing_type, s.default_price, s.currency, s.is_package,
    s.is_active, (select count(distinct cs.client_id) from public.client_services cs where cs.service_id = s.id and cs.status = 'active') as active_clients,
    s.created_at from public.services s";

fn can_read(user: &AuthUser) -> AppResult<()> {
    if user.can("clients.view") || user.can("proposals.view") || user.can("settings.manage") {
        Ok(())
    } else {
        Err(AppError::forbidden("You don't have access to the service catalog."))
    }
}

fn can_write(user: &AuthUser) -> AppResult<()> {
    if user.can("settings.manage") || user.can("clients.manage") {
        Ok(())
    } else {
        Err(AppError::forbidden("You can't change the service catalog."))
    }
}

pub async fn list(State(state): State<AppState>, user: AuthUser) -> AppResult<Json<Vec<Service>>> {
    can_read(&user)?;
    Ok(Json(sqlx::query_as::<_, Service>(&format!("{SELECT} order by s.is_active desc, lower(s.name)")).fetch_all(&state.db).await?))
}

#[derive(Deserialize)]
pub struct ServiceInput {
    name: String,
    category: String,
    description: Option<String>,
    billing_type: String,
    default_price: Option<Decimal>,
    currency: String,
    #[serde(default)]
    is_package: bool,
    is_active: Option<bool>,
}

fn validate(i: &ServiceInput) -> AppResult<()> {
    let mut v = Validator::new();
    v.text("name", &i.name, 120);
    v.one_of("category", &i.category, CATEGORIES);
    v.one_of("billing_type", &i.billing_type, crate::routes::sales::proposals::BILLING);
    v.optional_text("description", i.description.as_deref(), 2000);
    if i.default_price.is_some_and(|p| p.is_sign_negative()) {
        v.fail("default_price", "Can't be negative.");
    }
    if i.currency.len() != 3 || !i.currency.chars().all(|c| c.is_ascii_uppercase()) {
        v.fail("currency", "Use a 3-letter currency code.");
    }
    v.finish()
}

async fn fetch(state: &AppState, id: Uuid) -> AppResult<Service> {
    Ok(sqlx::query_as::<_, Service>(&format!("{SELECT} where s.id = $1")).bind(id).fetch_one(&state.db).await?)
}

pub async fn create(State(state): State<AppState>, user: AuthUser, Json(i): Json<ServiceInput>) -> AppResult<Json<Service>> {
    can_write(&user)?;
    validate(&i)?;
    let id: Uuid = sqlx::query_scalar(
        "insert into public.services (name, category, description, billing_type, default_price, currency, is_package, is_active)
         values ($1,$2,$3,$4,$5,$6,$7,coalesce($8,true)) returning id",
    )
    .bind(i.name.trim()).bind(&i.category).bind(clean(i.description.clone())).bind(&i.billing_type)
    .bind(i.default_price).bind(&i.currency).bind(i.is_package).bind(i.is_active)
    .fetch_one(&state.db)
    .await?;
    Ok(Json(fetch(&state, id).await?))
}

pub async fn update(State(state): State<AppState>, user: AuthUser, Path(id): Path<Uuid>, Json(i): Json<ServiceInput>) -> AppResult<Json<Service>> {
    can_write(&user)?;
    validate(&i)?;
    let updated = sqlx::query(
        "update public.services set name=$2, category=$3, description=$4, billing_type=$5, default_price=$6, currency=$7,
           is_package=$8, is_active=coalesce($9, is_active) where id = $1",
    )
    .bind(id).bind(i.name.trim()).bind(&i.category).bind(clean(i.description.clone())).bind(&i.billing_type)
    .bind(i.default_price).bind(&i.currency).bind(i.is_package).bind(i.is_active)
    .execute(&state.db)
    .await?;
    if updated.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(Json(fetch(&state, id).await?))
}
