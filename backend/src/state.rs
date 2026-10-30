use std::{sync::Arc, time::Duration};

use anyhow::Context;
use sqlx::PgPool;
use tokio::sync::Mutex;

use crate::{auth::JwtVerifier, config::Config, rate_limit::RateLimiter, storage::Storage, supabase::SupabaseAdmin, vault::Vault};

/// Shared, cheaply clonable application state.
#[derive(Clone)]
pub struct AppState {
    pub db: PgPool,
    pub config: Arc<Config>,
    pub jwt: Arc<JwtVerifier>,
    pub supabase: Arc<SupabaseAdmin>,
    pub storage: Arc<Storage>,
    pub limiter: Arc<RateLimiter>,
    /// Encrypts website credentials; `None` when SECRETS_KEY isn't set.
    pub vault: Option<Arc<Vault>>,
    /// HTTP client for uptime checks (no redirects, short timeout).
    pub monitor_http: reqwest::Client,
    /// Serializes first-run owner creation.
    pub setup_lock: Arc<Mutex<()>>,
}

impl AppState {
    pub fn new(config: Config, db: PgPool) -> anyhow::Result<Self> {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(15))
            .user_agent(concat!("oddly-api/", env!("CARGO_PKG_VERSION")))
            .build()
            .context("building HTTP client")?;

        Ok(Self {
            jwt: Arc::new(JwtVerifier::new(&config, http.clone())),
            supabase: Arc::new(SupabaseAdmin::new(&config, http.clone())),
            storage: Arc::new(Storage::new(&config, http)),
            limiter: Arc::new(RateLimiter::default()),
            vault: config.secrets_key.as_deref().map(Vault::from_base64).transpose()?.map(Arc::new),
            monitor_http: crate::monitor::http_client(),
            setup_lock: Arc::new(Mutex::new(())),
            config: Arc::new(config),
            db,
        })
    }
}
