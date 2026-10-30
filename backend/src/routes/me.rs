use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};
use serde_json::json;
use uuid::Uuid;

use crate::{
    audit::{self, AuditEntry},
    auth::AuthUser,
    error::AppResult,
    state::AppState,
    validate::{clean, Validator},
};

#[derive(Serialize)]
pub struct Me {
    id: Uuid,
    email: String,
    full_name: String,
    job_title: Option<String>,
    phone: Option<String>,
    timezone: String,
    must_change_password: bool,
    roles: Vec<String>,
    permissions: Vec<String>,
    ai_configured: bool,
}

fn to_me(user: &AuthUser, state: &AppState) -> Me {
    Me {
        id: user.id,
        email: user.email.clone(),
        full_name: user.full_name.clone(),
        job_title: user.job_title.clone(),
        phone: user.phone.clone(),
        timezone: user.timezone.clone(),
        must_change_password: user.must_change_password,
        roles: user.roles.clone(),
        permissions: if user.is_super_admin() { vec!["*".into()] } else { user.permission_list() },
        ai_configured: state.config.openai_api_key.is_some(),
    }
}

pub async fn get_me(State(state): State<AppState>, user: AuthUser) -> AppResult<Json<Me>> {
    // Throttled "last seen" so team pages can show who is active.
    sqlx::query(
        "update public.profiles set last_seen_at = now()
         where id = $1 and (last_seen_at is null or last_seen_at < now() - interval '5 minutes')",
    )
    .bind(user.id)
    .execute(&state.db)
    .await?;

    Ok(Json(to_me(&user, &state)))
}

/// Sent by the profile form with every field. `full_name` and `timezone` keep their
/// current value when omitted; an omitted or blank `job_title` / `phone` clears it.
#[derive(Deserialize)]
pub struct UpdateMe {
    full_name: Option<String>,
    job_title: Option<String>,
    phone: Option<String>,
    timezone: Option<String>,
}

pub async fn update_me(
    State(state): State<AppState>,
    user: AuthUser,
    Json(input): Json<UpdateMe>,
) -> AppResult<Json<Me>> {
    let full_name = input.full_name.map(|s| s.trim().to_owned());
    let job_title = clean(input.job_title);
    let phone = clean(input.phone);
    let timezone = clean(input.timezone);

    let mut v = Validator::new();
    if let Some(name) = &full_name {
        v.text("full_name", name, 120);
    }
    v.optional_text("job_title", job_title.as_deref(), 120);
    v.optional_text("phone", phone.as_deref(), 40);
    if let Some(tz) = &timezone {
        let known: bool = sqlx::query_scalar("select exists (select 1 from pg_timezone_names where name = $1)")
            .bind(tz)
            .fetch_one(&state.db)
            .await?;
        if !known {
            v.fail("timezone", "Unknown time zone.");
        }
    }
    v.finish()?;

    sqlx::query(
        "update public.profiles set
           full_name = coalesce($2, full_name),
           job_title = $3,
           phone     = $4,
           timezone  = coalesce($5, timezone)
         where id = $1",
    )
    .bind(user.id)
    .bind(&full_name)
    .bind(&job_title)
    .bind(&phone)
    .bind(&timezone)
    .execute(&state.db)
    .await?;

    let mut updated = user.clone();
    if let Some(name) = full_name {
        updated.full_name = name;
    }
    updated.job_title = job_title;
    updated.phone = phone;
    if let Some(tz) = timezone {
        updated.timezone = tz;
    }
    Ok(Json(to_me(&updated, &state)))
}

#[derive(Deserialize)]
pub struct ChangePassword {
    password: String,
}

pub async fn change_password(
    State(state): State<AppState>,
    user: AuthUser,
    Json(input): Json<ChangePassword>,
) -> AppResult<Json<Me>> {
    let mut v = Validator::new();
    v.password("password", &input.password);
    v.finish()?;

    state.supabase.set_password(user.id, &input.password).await?;

    sqlx::query("update public.profiles set must_change_password = false where id = $1")
        .bind(user.id)
        .execute(&state.db)
        .await?;

    audit::record(
        &state.db,
        AuditEntry {
            actor_id: Some(user.id),
            action: "profile.password_changed",
            entity_type: Some("profile"),
            entity_id: Some(user.id),
            changes: json!({}),
        },
    )
    .await?;

    let mut updated = user.clone();
    updated.must_change_password = false;
    Ok(Json(to_me(&updated, &state)))
}
