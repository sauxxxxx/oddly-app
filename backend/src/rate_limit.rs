use std::{
    collections::HashMap,
    net::SocketAddr,
    sync::Mutex,
    time::{Duration, Instant},
};

use axum::{
    extract::{ConnectInfo, Request, State},
    middleware::Next,
    response::{IntoResponse, Response},
};

use crate::{error::AppError, state::AppState};

/// Fixed-window, in-memory rate limiter. Good for a single API instance; move to a
/// shared store (e.g. Redis) if the API is ever scaled horizontally.
#[derive(Default)]
pub struct RateLimiter {
    windows: Mutex<HashMap<String, (Instant, u32)>>,
}

impl RateLimiter {
    /// Returns `true` if the call identified by `key` is allowed.
    pub fn check(&self, key: &str, limit: u32, window: Duration) -> bool {
        let now = Instant::now();
        let mut windows = self.windows.lock().unwrap_or_else(|e| e.into_inner());

        if windows.len() > 10_000 {
            windows.retain(|_, (start, _)| now.duration_since(*start) < window);
        }

        let entry = windows.entry(key.to_owned()).or_insert((now, 0));
        if now.duration_since(entry.0) >= window {
            *entry = (now, 0);
        }
        entry.1 += 1;
        entry.1 <= limit
    }
}

/// Global per-IP limit applied to every API request.
pub async fn per_ip(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    request: Request,
    next: Next,
) -> Response {
    // Behind a proxy every request comes from the proxy, so use the forwarded client IP.
    let forwarded = state
        .config
        .trust_proxy
        .then(|| request.headers().get("x-forwarded-for")?.to_str().ok()?.split(',').next().map(|s| s.trim().to_owned()))
        .flatten()
        .filter(|ip| !ip.is_empty());
    let key = format!("ip:{}", forwarded.unwrap_or_else(|| addr.ip().to_string()));
    if state.limiter.check(&key, state.config.rate_limit_per_minute, Duration::from_secs(60)) {
        next.run(request).await
    } else {
        AppError::TooManyRequests.into_response()
    }
}
