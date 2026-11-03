//! Desktop app downloads and auto-updates, served from the private `releases` bucket.
//! Public on purpose (the app checks before anyone signs in); every installer is signed and
//! the app verifies the signature before installing.

use axum::{
    extract::{Path, State},
    http::header,
    response::{IntoResponse, Redirect, Response},
};
use serde::Deserialize;

use crate::{
    error::{AppError, AppResult},
    state::AppState,
};

const BUCKET: &str = "releases";

/// `ODDLY_1.2.3_x64-setup.exe` and nothing else (no paths, no other files).
fn valid_installer_name(name: &str) -> bool {
    name.strip_prefix("ODDLY_")
        .and_then(|rest| rest.strip_suffix("_x64-setup.exe"))
        .is_some_and(|v| !v.is_empty() && v.len() <= 20 && v.chars().all(|c| c.is_ascii_digit() || c == '.'))
}

async fn manifest(state: &AppState) -> AppResult<Vec<u8>> {
    state.storage.download(BUCKET, "latest.json").await?.ok_or(AppError::NotFound)
}

/// The updater manifest the desktop app polls.
pub async fn latest(State(state): State<AppState>) -> AppResult<Response> {
    let body = manifest(&state).await?;
    Ok(([(header::CONTENT_TYPE, "application/json")], body).into_response())
}

/// A short-lived link to one installer.
pub async fn installer(State(state): State<AppState>, Path(name): Path<String>) -> AppResult<Redirect> {
    if !valid_installer_name(&name) {
        return Err(AppError::NotFound);
    }
    signed_link(&state, &name).await
}

/// 404 when the installer isn't uploaded, otherwise a 10-minute signed download link.
async fn signed_link(state: &AppState, name: &str) -> AppResult<Redirect> {
    if state.storage.info(BUCKET, name).await?.is_none() {
        return Err(AppError::NotFound);
    }
    let url = state.storage.signed_download_url(BUCKET, name, 600, Some(name)).await?;
    Ok(Redirect::temporary(&url))
}

#[derive(Deserialize)]
struct Manifest {
    version: String,
}

/// Shareable "download the latest ODDLY" link for new teammates.
pub async fn download(State(state): State<AppState>) -> AppResult<Redirect> {
    let m: Manifest = serde_json::from_slice(&manifest(&state).await?)
        .map_err(|e| AppError::Internal(anyhow::anyhow!("latest.json is invalid: {e}")))?;
    let name = format!("ODDLY_{}_x64-setup.exe", m.version);
    if !valid_installer_name(&name) {
        return Err(AppError::Internal(anyhow::anyhow!("latest.json has an invalid version")));
    }
    signed_link(&state, &name).await
}

#[cfg(test)]
mod tests {
    use super::valid_installer_name;

    #[test]
    fn only_installers_are_served() {
        assert!(valid_installer_name("ODDLY_1.0.0_x64-setup.exe"));
        assert!(!valid_installer_name("latest.json"));
        assert!(!valid_installer_name("ODDLY_../secret_x64-setup.exe"));
        assert!(!valid_installer_name("ODDLY__x64-setup.exe"));
    }
}
