use axum::{
    extract::{Path, State},
    Json,
};
use chrono::{DateTime, Utc};
use rand::{distributions::Alphanumeric, rngs::OsRng, Rng};
use serde::{Deserialize, Serialize};
use serde_json::json;
use uuid::Uuid;

use crate::{
    audit::{self, AuditEntry},
    auth::{perm, AuthUser},
    error::{AppError, AppResult},
    state::AppState,
    validate::{clean, Validator},
};

#[derive(Serialize, sqlx::FromRow)]
pub struct Member {
    id: Uuid,
    email: String,
    full_name: String,
    job_title: Option<String>,
    status: String,
    must_change_password: bool,
    last_seen_at: Option<DateTime<Utc>>,
    created_at: DateTime<Utc>,
    roles: Vec<String>,
}

const MEMBER_SELECT: &str = r#"
    select p.id, p.email, p.full_name, p.job_title, p.status, p.must_change_password,
           p.last_seen_at, p.created_at,
           coalesce(array_agg(r.key order by r.key) filter (where r.key is not null), '{}') as roles
    from public.profiles p
    left join public.user_roles ur on ur.user_id = p.id
    left join public.roles r on r.id = ur.role_id
"#;

pub async fn list_members(State(state): State<AppState>, user: AuthUser) -> AppResult<Json<Vec<Member>>> {
    user.require(perm::TEAM_VIEW)?;
    let members = sqlx::query_as::<_, Member>(&format!(
        "{MEMBER_SELECT} group by p.id order by p.status, lower(p.full_name)"
    ))
    .fetch_all(&state.db)
    .await?;
    Ok(Json(members))
}

async fn fetch_member(state: &AppState, id: Uuid) -> AppResult<Member> {
    Ok(sqlx::query_as::<_, Member>(&format!("{MEMBER_SELECT} where p.id = $1 group by p.id"))
        .bind(id)
        .fetch_one(&state.db)
        .await?)
}

#[derive(Serialize, sqlx::FromRow)]
pub struct Role {
    id: Uuid,
    key: String,
    name: String,
    description: Option<String>,
    member_count: i64,
}

pub async fn list_roles(State(state): State<AppState>, user: AuthUser) -> AppResult<Json<Vec<Role>>> {
    user.require(perm::TEAM_VIEW)?;
    let roles = sqlx::query_as::<_, Role>(
        "select r.id, r.key, r.name, r.description, count(ur.user_id) as member_count
         from public.roles r
         left join public.user_roles ur on ur.role_id = r.id
         group by r.id
         order by r.created_at, r.name",
    )
    .fetch_all(&state.db)
    .await?;
    Ok(Json(roles))
}

/// Only a Super Admin may grant or touch the Super Admin role.
fn check_role_grant(actor: &AuthUser, role_key: &str) -> AppResult<()> {
    if role_key == "super_admin" && !actor.is_super_admin() {
        return Err(AppError::forbidden("Only a Super Admin can grant the Super Admin role."));
    }
    Ok(())
}

async fn role_id(state: &AppState, key: &str) -> AppResult<Uuid> {
    sqlx::query_scalar("select id from public.roles where key = $1")
        .bind(key)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| {
            let mut fields = std::collections::BTreeMap::new();
            fields.insert("role_key".to_owned(), "Unknown role.".to_owned());
            AppError::Validation(fields)
        })
}

#[derive(Deserialize)]
pub struct CreateMember {
    email: String,
    full_name: String,
    job_title: Option<String>,
    role_key: String,
}

#[derive(Serialize)]
pub struct CreatedMember {
    member: Member,
    /// Shown once to the admin, who passes it to the new member. They must change it
    /// at first sign-in.
    temporary_password: String,
}

pub async fn create_member(
    State(state): State<AppState>,
    user: AuthUser,
    Json(input): Json<CreateMember>,
) -> AppResult<Json<CreatedMember>> {
    user.require(perm::TEAM_MANAGE)?;

    let email = input.email.trim().to_lowercase();
    let full_name = input.full_name.trim().to_owned();
    let job_title = clean(input.job_title);

    let mut v = Validator::new();
    v.email("email", &email);
    v.text("full_name", &full_name, 120);
    v.optional_text("job_title", job_title.as_deref(), 120);
    v.text("role_key", &input.role_key, 64);
    v.finish()?;

    check_role_grant(&user, &input.role_key)?;
    let role_id = role_id(&state, &input.role_key).await?;

    let exists: bool = sqlx::query_scalar("select exists (select 1 from public.profiles where lower(email) = $1)")
        .bind(&email)
        .fetch_one(&state.db)
        .await?;
    if exists {
        return Err(AppError::Conflict("A team member with this email already exists.".into()));
    }

    let temporary_password = generate_temporary_password();
    let member_id = state.supabase.create_user(&email, &temporary_password, &full_name, true).await?;

    // The auth trigger has already created the profile row.
    let mut tx = state.db.begin().await?;
    sqlx::query("update public.profiles set job_title = $2 where id = $1")
        .bind(member_id)
        .bind(&job_title)
        .execute(&mut *tx)
        .await?;
    sqlx::query("insert into public.user_roles (user_id, role_id, assigned_by) values ($1, $2, $3) on conflict do nothing")
        .bind(member_id)
        .bind(role_id)
        .bind(user.id)
        .execute(&mut *tx)
        .await?;
    audit::record(
        &mut *tx,
        AuditEntry {
            actor_id: Some(user.id),
            action: "team.member_created",
            entity_type: Some("profile"),
            entity_id: Some(member_id),
            changes: json!({ "email": email, "role": input.role_key }),
        },
    )
    .await?;
    audit::activity(
        &mut *tx,
        user.id,
        "profile",
        member_id,
        "team.member_created",
        &format!("{} added {} to the team", user.full_name, full_name),
    )
    .await?;
    tx.commit().await?;

    Ok(Json(CreatedMember { member: fetch_member(&state, member_id).await?, temporary_password }))
}

#[derive(Deserialize)]
pub struct UpdateMember {
    role_key: Option<String>,
    status: Option<String>,
    job_title: Option<String>,
}

pub async fn update_member(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Json(input): Json<UpdateMember>,
) -> AppResult<Json<Member>> {
    user.require(perm::TEAM_MANAGE)?;

    let target = fetch_member(&state, id).await?;
    if target.roles.iter().any(|r| r == "super_admin") && !user.is_super_admin() {
        return Err(AppError::forbidden("Only a Super Admin can change another Super Admin."));
    }
    if id == user.id && (input.role_key.is_some() || input.status.is_some()) {
        return Err(AppError::forbidden("You can't change your own role or status."));
    }

    let mut v = Validator::new();
    if let Some(status) = &input.status {
        v.one_of("status", status, &["active", "suspended"]);
    }
    let job_title = clean(input.job_title);
    v.optional_text("job_title", job_title.as_deref(), 120);
    v.finish()?;

    let new_role_id = match &input.role_key {
        Some(key) => {
            check_role_grant(&user, key)?;
            Some(role_id(&state, key).await?)
        }
        None => None,
    };

    // Block or unblock sign-in first, so a failure leaves the database unchanged.
    if let Some(status) = &input.status {
        if *status != target.status {
            state.supabase.set_banned(id, status == "suspended").await?;
        }
    }

    let mut tx = state.db.begin().await?;
    if let Some(role_id) = new_role_id {
        sqlx::query("delete from public.user_roles where user_id = $1")
            .bind(id)
            .execute(&mut *tx)
            .await?;
        sqlx::query("insert into public.user_roles (user_id, role_id, assigned_by) values ($1, $2, $3)")
            .bind(id)
            .bind(role_id)
            .bind(user.id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(status) = &input.status {
        sqlx::query(
            "update public.profiles set status = $2,
               deactivated_at = case when $2 = 'suspended' then now() else null end
             where id = $1",
        )
        .bind(id)
        .bind(status)
        .execute(&mut *tx)
        .await?;
    }
    if job_title.is_some() {
        sqlx::query("update public.profiles set job_title = $2 where id = $1")
            .bind(id)
            .bind(&job_title)
            .execute(&mut *tx)
            .await?;
    }
    audit::record(
        &mut *tx,
        AuditEntry {
            actor_id: Some(user.id),
            action: "team.member_updated",
            entity_type: Some("profile"),
            entity_id: Some(id),
            changes: json!({
                "role": input.role_key,
                "status": input.status,
                "job_title": job_title,
                "previous_roles": target.roles,
                "previous_status": target.status,
            }),
        },
    )
    .await?;
    tx.commit().await?;

    Ok(Json(fetch_member(&state, id).await?))
}

#[derive(Serialize)]
pub struct PasswordReset {
    temporary_password: String,
}

/// Issues a new temporary password; the member must replace it at next sign-in.
pub async fn reset_member_password(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<PasswordReset>> {
    user.require(perm::TEAM_MANAGE)?;
    if id == user.id {
        return Err(AppError::forbidden("Change your own password from My Profile."));
    }
    let target = fetch_member(&state, id).await?;
    if target.roles.iter().any(|r| r == "super_admin") && !user.is_super_admin() {
        return Err(AppError::forbidden("Only a Super Admin can reset another Super Admin's password."));
    }

    let temporary_password = generate_temporary_password();
    state.supabase.set_password(id, &temporary_password).await?;

    let mut tx = state.db.begin().await?;
    sqlx::query("update public.profiles set must_change_password = true where id = $1")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    audit::record(
        &mut *tx,
        AuditEntry {
            actor_id: Some(user.id),
            action: "team.password_reset",
            entity_type: Some("profile"),
            entity_id: Some(id),
            changes: json!({}),
        },
    )
    .await?;
    tx.commit().await?;

    Ok(Json(PasswordReset { temporary_password }))
}

/// 16 random alphanumeric characters plus a digit guarantee, from the OS CSPRNG.
fn generate_temporary_password() -> String {
    let mut rng = OsRng;
    let body: String = (&mut rng).sample_iter(&Alphanumeric).take(15).map(char::from).collect();
    format!("{body}{}", rng.gen_range(0..10))
}
