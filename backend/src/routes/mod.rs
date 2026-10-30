use axum::{
    routing::{get, patch, post},
    Router,
};

use crate::state::AppState;

mod dashboard;
mod health;
mod me;
mod notifications;
mod setup;
mod team;

pub fn router(state: AppState) -> Router {
    let api = Router::new()
        .route("/health", get(health::health))
        .route("/setup/status", get(setup::status))
        .route("/setup", post(setup::create_owner))
        .route("/me", get(me::get_me).patch(me::update_me))
        .route("/me/password", post(me::change_password))
        .route("/dashboard", get(dashboard::summary))
        .route("/notifications", get(notifications::list))
        .route("/notifications/read-all", post(notifications::mark_all_read))
        .route("/notifications/{id}/read", post(notifications::mark_read))
        .route("/team/members", get(team::list_members).post(team::create_member))
        .route("/team/members/{id}", patch(team::update_member))
        .route("/team/members/{id}/reset-password", post(team::reset_member_password))
        .route("/roles", get(team::list_roles));

    Router::new().nest("/api/v1", api).with_state(state)
}
