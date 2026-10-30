//! ODDLY API — the single backend every ODDLY client (desktop now, web later) talks to.

mod audit;
mod auth;
mod config;
mod error;
mod rate_limit;
mod routes;
mod state;
mod supabase;
mod validate;

use std::{net::SocketAddr, time::Duration};

use anyhow::Context;
use axum::{
    http::{header, HeaderValue, Method},
    middleware,
};
use sqlx::postgres::PgPoolOptions;
use tower_http::{cors::CorsLayer, limit::RequestBodyLimitLayer, trace::TraceLayer};
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
    let state = AppState::new(config, db)?;

    let app = routes::router(state.clone())
        .layer(middleware::from_fn_with_state(state, rate_limit::per_ip))
        .layer(RequestBodyLimitLayer::new(2 * 1024 * 1024))
        .layer(cors)
        .layer(TraceLayer::new_for_http());

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

async fn shutdown_signal() {
    let _ = tokio::signal::ctrl_c().await;
    tracing::info!("shutting down");
}
