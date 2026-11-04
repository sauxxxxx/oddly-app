use std::collections::HashSet;

use axum::{
    extract::{FromRequestParts, OriginalUri},
    http::request::Parts,
};
use uuid::Uuid;

use super::jwt::VerifyError;
use crate::{
    error::{AppError, AppResult},
    state::AppState,
};

/// Paths a user may call while they still have to replace a temporary password.
const PASSWORD_CHANGE_ALLOWED: &[&str] = &["/api/v1/me", "/api/v1/me/password"];

/// The signed-in team member, resolved on every request from the Supabase token
/// plus ODDLY's own profile, roles and permissions.
#[derive(Debug, Clone)]
pub struct AuthUser {
    pub id: Uuid,
    pub email: String,
    pub full_name: String,
    pub job_title: Option<String>,
    pub phone: Option<String>,
    pub timezone: String,
    pub must_change_password: bool,
    pub roles: Vec<String>,
    pub permissions: HashSet<String>,
}

#[derive(sqlx::FromRow)]
struct AuthRow {
    id: Uuid,
    email: String,
    full_name: String,
    job_title: Option<String>,
    phone: Option<String>,
    timezone: String,
    status: String,
    must_change_password: bool,
    roles: Vec<String>,
    permissions: Vec<String>,
}

impl AuthUser {
    pub fn is_super_admin(&self) -> bool {
        self.roles.iter().any(|r| r == "super_admin")
    }

    pub fn can(&self, permission: &str) -> bool {
        self.is_super_admin() || self.permissions.contains(permission)
    }

    pub fn require(&self, permission: &str) -> AppResult<()> {
        if self.can(permission) {
            Ok(())
        } else {
            Err(AppError::Forbidden {
                code: "forbidden",
                message: "You don't have permission to do this.".into(),
            })
        }
    }

    /// Sorted permission keys for the client (used to show/hide UI, never trusted).
    pub fn permission_list(&self) -> Vec<String> {
        let mut list: Vec<String> = self.permissions.iter().cloned().collect();
        list.sort();
        list
    }
}

impl FromRequestParts<AppState> for AuthUser {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Self::Rejection> {
        let token = parts
            .headers
            .get(axum::http::header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .map(str::trim)
            .filter(|t| !t.is_empty())
            .ok_or(AppError::Unauthorized("Sign in to continue."))?;

        let claims = state.jwt.verify(token).await.map_err(|err| match err {
            VerifyError::Invalid => AppError::Unauthorized("Your session has expired. Please sign in again."),
            VerifyError::Keys(e) => AppError::Internal(e),
        })?;

        let row = sqlx::query_as::<_, AuthRow>(
            r#"
            select p.id, p.email, p.full_name, p.job_title, p.phone, p.timezone, p.status,
                   p.must_change_password,
                   coalesce(array_agg(distinct r.key) filter (where r.key is not null), '{}') as roles,
                   coalesce(array_agg(distinct perm.key) filter (where perm.key is not null), '{}') as permissions
            from public.profiles p
            left join public.user_roles ur on ur.user_id = p.id
            left join public.roles r on r.id = ur.role_id
            left join public.role_permissions rp on rp.role_id = r.id
            left join public.permissions perm on perm.id = rp.permission_id
            where p.id = $1
            group by p.id
            "#,
        )
        .bind(claims.sub)
        .fetch_optional(&state.db)
        .await?
        .ok_or(AppError::Forbidden {
            code: "no_profile",
            message: "This account is not part of the ODDLY workspace.".into(),
        })?;

        if row.status != "active" {
            return Err(AppError::Forbidden {
                code: "account_suspended",
                message: "This account has been suspended. Contact an administrator.".into(),
            });
        }

        // Routes are nested under /api/v1, and nesting strips that prefix from `parts.uri`.
        let path = parts.extensions.get::<OriginalUri>().map_or(parts.uri.path(), |u| u.path());
        if row.must_change_password && !PASSWORD_CHANGE_ALLOWED.contains(&path) {
            return Err(AppError::Forbidden {
                code: "password_change_required",
                message: "Set a new password before continuing.".into(),
            });
        }

        Ok(Self {
            id: row.id,
            email: row.email,
            full_name: row.full_name,
            job_title: row.job_title,
            phone: row.phone,
            timezone: row.timezone,
            must_change_password: row.must_change_password,
            roles: row.roles,
            permissions: row.permissions.into_iter().collect(),
        })
    }
}
