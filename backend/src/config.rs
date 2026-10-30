use std::{env, net::SocketAddr};

use anyhow::{bail, Context};

/// Runtime configuration, read once from the environment at startup.
#[derive(Clone)]
pub struct Config {
    pub database_url: String,
    pub database_max_connections: u32,
    pub bind_addr: SocketAddr,
    pub supabase_url: String,
    pub supabase_secret_key: String,
    pub supabase_jwt_secret: Option<String>,
    pub cors_allowed_origins: Vec<String>,
    pub setup_token: Option<String>,
    pub rate_limit_per_minute: u32,
    pub openai_api_key: Option<String>,
    pub secrets_key: Option<String>,
    /// Behind a hosting proxy: take the client IP from X-Forwarded-For for rate limiting.
    pub trust_proxy: bool,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        let supabase_url = required("SUPABASE_URL")?.trim_end_matches('/').to_owned();
        if !supabase_url.starts_with("https://") && !supabase_url.starts_with("http://localhost") {
            bail!("SUPABASE_URL must be an https:// URL");
        }

        let config = Self {
            database_url: required("DATABASE_URL")?,
            database_max_connections: parse_or("DATABASE_MAX_CONNECTIONS", 10)?,
            // Hosting platforms pass the port in PORT; API_BIND_ADDR wins if both are set.
            bind_addr: optional("API_BIND_ADDR")
                .or_else(|| optional("PORT").map(|p| format!("0.0.0.0:{p}")))
                .unwrap_or_else(|| "127.0.0.1:8080".into())
                .parse()
                .context("API_BIND_ADDR must look like 127.0.0.1:8080")?,
            supabase_url,
            supabase_secret_key: required("SUPABASE_SECRET_KEY")?,
            supabase_jwt_secret: optional("SUPABASE_JWT_SECRET"),
            cors_allowed_origins: optional("CORS_ALLOWED_ORIGINS")
                .unwrap_or_else(|| "http://localhost:1420,http://tauri.localhost,tauri://localhost".into())
                .split(',')
                .map(|o| o.trim().to_owned())
                .filter(|o| !o.is_empty())
                .collect(),
            setup_token: optional("SETUP_TOKEN"),
            rate_limit_per_minute: parse_or("RATE_LIMIT_PER_MINUTE", 600)?,
            openai_api_key: optional("OPENAI_API_KEY"),
            secrets_key: optional("SECRETS_KEY"),
            trust_proxy: optional("TRUST_PROXY").is_some_and(|v| v == "true" || v == "1"),
        };

        if let Some(secret) = &config.supabase_jwt_secret {
            if secret.len() < 32 {
                bail!("SUPABASE_JWT_SECRET looks too short; copy it exactly from Supabase");
            }
        }

        Ok(config)
    }

    pub fn auth_issuer(&self) -> String {
        format!("{}/auth/v1", self.supabase_url)
    }
}

fn optional(key: &str) -> Option<String> {
    env::var(key).ok().map(|v| v.trim().to_owned()).filter(|v| !v.is_empty())
}

fn required(key: &str) -> anyhow::Result<String> {
    optional(key).with_context(|| format!("missing required environment variable {key}"))
}

fn parse_or<T: std::str::FromStr>(key: &str, default: T) -> anyhow::Result<T> {
    match optional(key) {
        Some(v) => v.parse().map_err(|_| anyhow::anyhow!("{key} has an invalid value")),
        None => Ok(default),
    }
}
