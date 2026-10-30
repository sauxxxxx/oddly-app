use std::{
    collections::HashMap,
    time::{Duration, Instant},
};

use anyhow::Context;
use jsonwebtoken::{decode, decode_header, jwk::JwkSet, Algorithm, DecodingKey, Validation};
use serde::Deserialize;
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::config::Config;

/// Claims ODDLY reads from a Supabase Auth access token.
#[derive(Debug, Deserialize)]
pub struct Claims {
    pub sub: Uuid,
    #[allow(dead_code)]
    pub email: Option<String>,
    #[allow(dead_code)]
    pub session_id: Option<Uuid>,
}

#[derive(Debug, thiserror::Error)]
pub enum VerifyError {
    #[error("token is invalid or expired")]
    Invalid,
    #[error("could not load signing keys: {0}")]
    Keys(#[from] anyhow::Error),
}

/// Minimum time between JWKS refetches triggered by an unknown `kid`,
/// so forged tokens cannot make us hammer Supabase.
const JWKS_REFRESH_COOLDOWN: Duration = Duration::from_secs(60);

/// Verifies Supabase access tokens.
///
/// * Asymmetric signing keys (ES256 / RS256, Supabase's current default) are verified
///   against the project's JWKS endpoint, cached in memory and refreshed on key rotation.
/// * Projects still on the legacy shared secret use HS256 with `SUPABASE_JWT_SECRET`.
pub struct JwtVerifier {
    issuer: String,
    jwks_url: String,
    hs256_key: Option<DecodingKey>,
    http: reqwest::Client,
    cache: RwLock<KeyCache>,
}

#[derive(Default)]
struct KeyCache {
    keys: HashMap<String, DecodingKey>,
    fetched_at: Option<Instant>,
}

impl JwtVerifier {
    pub fn new(config: &Config, http: reqwest::Client) -> Self {
        let issuer = config.auth_issuer();
        Self {
            jwks_url: format!("{issuer}/.well-known/jwks.json"),
            issuer,
            hs256_key: config.supabase_jwt_secret.as_deref().map(|s| DecodingKey::from_secret(s.as_bytes())),
            http,
            cache: RwLock::default(),
        }
    }

    pub async fn verify(&self, token: &str) -> Result<Claims, VerifyError> {
        let header = decode_header(token).map_err(|_| VerifyError::Invalid)?;

        let key = match header.alg {
            Algorithm::HS256 => self.hs256_key.clone().ok_or(VerifyError::Invalid)?,
            Algorithm::ES256 | Algorithm::RS256 => {
                let kid = header.kid.as_deref().ok_or(VerifyError::Invalid)?;
                self.key_for(kid).await?.ok_or(VerifyError::Invalid)?
            }
            _ => return Err(VerifyError::Invalid),
        };

        let mut validation = Validation::new(header.alg);
        validation.set_audience(&["authenticated"]);
        validation.set_issuer(&[&self.issuer]);
        validation.leeway = 30;

        decode::<Claims>(token, &key, &validation)
            .map(|data| data.claims)
            .map_err(|_| VerifyError::Invalid)
    }

    async fn key_for(&self, kid: &str) -> anyhow::Result<Option<DecodingKey>> {
        {
            let cache = self.cache.read().await;
            if let Some(key) = cache.keys.get(kid) {
                return Ok(Some(key.clone()));
            }
            if cache.fetched_at.is_some_and(|t| t.elapsed() < JWKS_REFRESH_COOLDOWN) {
                return Ok(None);
            }
        }

        let mut cache = self.cache.write().await;
        // Another request may have refreshed while we waited for the lock.
        if cache.fetched_at.is_none_or(|t| t.elapsed() >= JWKS_REFRESH_COOLDOWN) {
            cache.keys = self.fetch_jwks().await?;
            cache.fetched_at = Some(Instant::now());
        }
        Ok(cache.keys.get(kid).cloned())
    }

    async fn fetch_jwks(&self) -> anyhow::Result<HashMap<String, DecodingKey>> {
        let set: JwkSet = self
            .http
            .get(&self.jwks_url)
            .send()
            .await
            .context("requesting Supabase JWKS")?
            .error_for_status()
            .context("Supabase JWKS returned an error")?
            .json()
            .await
            .context("parsing Supabase JWKS")?;

        let mut keys = HashMap::new();
        for jwk in &set.keys {
            let Some(kid) = jwk.common.key_id.clone() else { continue };
            match DecodingKey::from_jwk(jwk) {
                Ok(key) => {
                    keys.insert(kid, key);
                }
                Err(err) => tracing::warn!(%kid, error = %err, "skipping unsupported JWK"),
            }
        }
        tracing::debug!(count = keys.len(), "loaded Supabase signing keys");
        Ok(keys)
    }
}
