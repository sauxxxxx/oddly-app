//! First-run owner setup. Only works while the workspace has no users; the database
//! trigger makes that first account Super Admin.

use std::time::Duration;

use axum::{
    extract::{ConnectInfo, State},
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::{
    audit::{self, AuditEntry},
    error::{AppError, AppResult},
    state::AppState,
    validate::Validator,
};

#[derive(Serialize)]
pub struct SetupStatus {
    setup_required: bool,
    setup_token_required: bool,
}

pub async fn status(State(state): State<AppState>) -> AppResult<Json<SetupStatus>> {
    Ok(Json(SetupStatus {
        setup_required: !has_users(&state).await?,
        setup_token_required: state.config.setup_token.is_some(),
    }))
}

#[derive(Deserialize)]
pub struct CreateOwner {
    email: String,
    full_name: String,
    password: String,
    setup_token: Option<String>,
}

#[derive(Serialize)]
pub struct Created {
    email: String,
}

pub async fn create_owner(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<std::net::SocketAddr>,
    Json(input): Json<CreateOwner>,
) -> AppResult<Json<Created>> {
    if !state.limiter.check(&format!("setup:{}", addr.ip()), 5, Duration::from_secs(600)) {
        return Err(AppError::TooManyRequests);
    }

    if let Some(expected) = &state.config.setup_token {
        if input.setup_token.as_deref() != Some(expected.as_str()) {
            return Err(AppError::forbidden("The setup token is incorrect."));
        }
    }

    let email = input.email.trim().to_lowercase();
    let full_name = input.full_name.trim().to_owned();
    let mut v = Validator::new();
    v.email("email", &email);
    v.text("full_name", &full_name, 120);
    v.password("password", &input.password);
    v.finish()?;

    let _guard = state.setup_lock.lock().await;
    if has_users(&state).await? {
        return Err(AppError::Conflict("This workspace has already been set up. Sign in instead.".into()));
    }

    let user_id = state.supabase.create_user(&email, &input.password, &full_name, false).await?;

    audit::record(
        &state.db,
        AuditEntry {
            actor_id: Some(user_id),
            action: "workspace.owner_created",
            entity_type: Some("profile"),
            entity_id: Some(user_id),
            changes: json!({ "email": email }),
        },
    )
    .await?;

    tracing::info!(%user_id, "workspace owner created");
    Ok(Json(Created { email }))
}

async fn has_users(state: &AppState) -> AppResult<bool> {
    Ok(sqlx::query_scalar("select exists (select 1 from public.profiles)")
        .fetch_one(&state.db)
        .await?)
}
