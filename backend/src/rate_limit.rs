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
    let forwarded = state.config.trust_proxy.then(|| client_ip(request.headers())).flatten();
    let key = format!("ip:{}", forwarded.unwrap_or_else(|| addr.ip().to_string()));
    if state.limiter.check(&key, state.config.rate_limit_per_minute, Duration::from_secs(60)) {
        next.run(request).await
    } else {
        AppError::TooManyRequests.into_response()
    }
}

/// The client IP as reported by the proxy in front of the API. Cloudflare sets
/// `CF-Connecting-IP`; other proxies append the address they saw to `X-Forwarded-For`, so the
/// last entry is the trustworthy one (earlier entries can be sent by the client itself).
fn client_ip(headers: &axum::http::HeaderMap) -> Option<String> {
    let header = |name: &str| headers.get(name).and_then(|v| v.to_str().ok());
    header("cf-connecting-ip")
        .or_else(|| header("x-forwarded-for")?.rsplit(',').next())
        .map(str::trim)
        .filter(|ip| ip.parse::<std::net::IpAddr>().is_ok())
        .map(str::to_owned)
}

#[cfg(test)]
mod tests {
    use axum::http::{HeaderMap, HeaderValue};

    use super::client_ip;

    #[test]
    fn spoofed_forwarded_entries_are_ignored() {
        let mut h = HeaderMap::new();
        h.insert("x-forwarded-for", HeaderValue::from_static("1.2.3.4, 203.0.113.9"));
        assert_eq!(client_ip(&h).as_deref(), Some("203.0.113.9"));
        h.insert("cf-connecting-ip", HeaderValue::from_static("198.51.100.7"));
        assert_eq!(client_ip(&h).as_deref(), Some("198.51.100.7"));
        h.insert("cf-connecting-ip", HeaderValue::from_static("not-an-ip"));
        assert_eq!(client_ip(&h), None);
    }
}
