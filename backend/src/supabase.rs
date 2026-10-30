//! Minimal client for the Supabase Auth Admin API. Uses the secret key, so it must
//! only ever run server-side.

use anyhow::Context;
use reqwest::StatusCode;
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{config::Config, error::AppError};

pub struct SupabaseAdmin {
    http: reqwest::Client,
    base_url: String,
    secret_key: String,
}

#[derive(Deserialize)]
struct CreatedUser {
    id: Uuid,
}

#[derive(Deserialize)]
struct ErrorBody {
    #[serde(alias = "msg", alias = "message", alias = "error_description")]
    msg: Option<String>,
    error_code: Option<String>,
}

impl SupabaseAdmin {
    pub fn new(config: &Config, http: reqwest::Client) -> Self {
        Self {
            http,
            base_url: format!("{}/auth/v1/admin/users", config.supabase_url),
            secret_key: config.supabase_secret_key.clone(),
        }
    }

    fn request(&self, method: reqwest::Method, url: &str) -> reqwest::RequestBuilder {
        let req = self.http.request(method, url).header("apikey", &self.secret_key);
        // Legacy service_role keys are JWTs and go in Authorization too;
        // new `sb_secret_` keys are sent only as `apikey`.
        if self.secret_key.starts_with("eyJ") {
            req.bearer_auth(&self.secret_key)
        } else {
            req
        }
    }

    /// Creates a confirmed email/password user. The database trigger creates the profile.
    pub async fn create_user(
        &self,
        email: &str,
        password: &str,
        full_name: &str,
        must_change_password: bool,
    ) -> Result<Uuid, AppError> {
        let body = json!({
            "email": email,
            "password": password,
            "email_confirm": true,
            "user_metadata": { "full_name": full_name, "must_change_password": must_change_password },
        });
        let res = self
            .request(reqwest::Method::POST, &self.base_url)
            .json(&body)
            .send()
            .await
            .context("calling Supabase Auth")?;

        if res.status().is_success() {
            let user: CreatedUser = res.json().await.context("parsing Supabase user")?;
            return Ok(user.id);
        }
        Err(self.map_error(res).await)
    }

    pub async fn set_password(&self, user_id: Uuid, password: &str) -> Result<(), AppError> {
        self.update_user(user_id, json!({ "password": password })).await
    }

    /// Blocks or unblocks sign-in for a suspended / reactivated team member.
    pub async fn set_banned(&self, user_id: Uuid, banned: bool) -> Result<(), AppError> {
        let duration = if banned { "876000h" } else { "none" };
        self.update_user(user_id, json!({ "ban_duration": duration })).await
    }

    async fn update_user(&self, user_id: Uuid, body: Value) -> Result<(), AppError> {
        let res = self
            .request(reqwest::Method::PUT, &format!("{}/{user_id}", self.base_url))
            .json(&body)
            .send()
            .await
            .context("calling Supabase Auth")?;
        if res.status().is_success() {
            Ok(())
        } else {
            Err(self.map_error(res).await)
        }
    }

    async fn map_error(&self, res: reqwest::Response) -> AppError {
        let status = res.status();
        let body: Option<ErrorBody> = res.json().await.ok();
        let code = body.as_ref().and_then(|b| b.error_code.clone()).unwrap_or_default();
        let msg = body.and_then(|b| b.msg).unwrap_or_default();

        if code == "email_exists" || msg.to_lowercase().contains("already been registered") {
            return AppError::Conflict("A user with this email address already exists.".into());
        }
        if code == "weak_password" || (status == StatusCode::UNPROCESSABLE_ENTITY && msg.to_lowercase().contains("password")) {
            let mut fields = std::collections::BTreeMap::new();
            fields.insert("password".to_owned(), if msg.is_empty() { "Password is too weak.".to_owned() } else { msg });
            return AppError::Validation(fields);
        }
        AppError::Internal(anyhow::anyhow!("Supabase Auth returned {status}: {code} {msg}"))
    }
}
