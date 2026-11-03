//! ODDLY API — the single backend every ODDLY client (desktop now, web later) talks to.

mod ai;
mod audit;
mod auth;
mod config;
mod error;
mod monitor;
mod rate_limit;
mod reminders;
mod routes;
mod state;
mod storage;
#[cfg(test)]
mod smoke_tests;
mod supabase;
mod validate;
mod vault;

use std::{net::SocketAddr, time::Duration};

use anyhow::Context;
use axum::{
    http::{header, HeaderValue, Method, StatusCode},
    middleware,
};
use sqlx::postgres::PgPoolOptions;
use tower_http::{
    catch_panic::CatchPanicLayer, cors::CorsLayer, limit::RequestBodyLimitLayer, set_header::SetResponseHeaderLayer,
    timeout::TimeoutLayer, trace::TraceLayer,
};
use tracing_subscriber::EnvFilter;

use crate::{config::Config, state::AppState};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();
    // Dev runs start from the workspace root (`cargo run -p oddly-api`), so also load backend/.env.
    // Never overrides variables that are already set; release builds rely on the real environment.
    #[cfg(debug_assertions)]
    dotenvy::from_path(concat!(env!("CARGO_MANIFEST_DIR"), "/.env")).ok();
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| "oddly_api=info,tower_http=info".into()),
        )
        .init();

    let config = Config::from_env()?;

    let db = PgPoolOptions::new()
        .max_connections(config.database_max_connections)
        .acquire_timeout(Duration::from_secs(10))
        .connect(&config.database_url)
        .await
        .context("connecting to the database (check DATABASE_URL)")?;

    let bind_addr = config.bind_addr;
    let cors = cors_layer(&config.cors_allowed_origins)?;
    reminders::spawn(db.clone());
    let state = AppState::new(config, db)?;
    monitor::spawn(state.db.clone(), state.monitor_http.clone());

    let app = routes::router(state.clone())
        .layer(middleware::from_fn_with_state(state, rate_limit::per_ip))
        .layer(RequestBodyLimitLayer::new(2 * 1024 * 1024))
        // AI answers can take a while; anything slower than this is cut off.
        .layer(TimeoutLayer::with_status_code(StatusCode::GATEWAY_TIMEOUT, Duration::from_secs(150)))
        // API responses carry private data: never cache them, never render them as pages.
        .layer(SetResponseHeaderLayer::overriding(header::CACHE_CONTROL, HeaderValue::from_static("no-store")))
        .layer(SetResponseHeaderLayer::overriding(header::X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff")))
        .layer(SetResponseHeaderLayer::overriding(header::X_FRAME_OPTIONS, HeaderValue::from_static("DENY")))
        .layer(SetResponseHeaderLayer::overriding(header::REFERRER_POLICY, HeaderValue::from_static("no-referrer")))
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        // A bug in one request returns a 500 instead of dropping the connection.
        .layer(CatchPanicLayer::new());

    let listener = tokio::net::TcpListener::bind(bind_addr)
        .await
        .with_context(|| format!("binding {bind_addr}"))?;
    tracing::info!("ODDLY API listening on http://{bind_addr}");

    axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>())
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    Ok(())
}

fn cors_layer(origins: &[String]) -> anyhow::Result<CorsLayer> {
    let origins = origins
        .iter()
        .map(|o| o.parse::<HeaderValue>().with_context(|| format!("invalid CORS origin {o}")))
        .collect::<anyhow::Result<Vec<_>>>()?;

    Ok(CorsLayer::new()
        .allow_origin(origins)
        .allow_methods([Method::GET, Method::POST, Method::PUT, Method::PATCH, Method::DELETE])
        .allow_headers([header::AUTHORIZATION, header::CONTENT_TYPE])
        .max_age(Duration::from_secs(3600)))
}

/// Ctrl+C locally; SIGTERM when a hosting platform stops or redeploys the container.
async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };
    #[cfg(unix)]
    let terminate = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut s) => {
                s.recv().await;
            }
            Err(_) => std::future::pending::<()>().await,
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
    tracing::info!("shutting down");
}
