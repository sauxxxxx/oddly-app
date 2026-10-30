use axum::{
    routing::{get, patch, post},
    Router,
};

use crate::state::AppState;

pub(crate) mod common;
pub(crate) mod dashboard;
pub(crate) mod health;
pub(crate) mod leads;
pub(crate) mod lookups;
pub(crate) mod me;
pub(crate) mod notifications;
pub(crate) mod sales;
pub(crate) mod saved_filters;
pub(crate) mod setup;
pub(crate) mod team;

pub fn router(state: AppState) -> Router {
    let api = Router::new()
        .route("/health", get(health::health))
        .route("/setup/status", get(setup::status))
        .route("/setup", post(setup::create_owner))
        .route("/me", get(me::get_me).patch(me::update_me))
        .route("/me/password", post(me::change_password))
        .route("/dashboard", get(dashboard::summary))
        .route("/lookups", get(lookups::lookups))
        .route("/notifications", get(notifications::list))
        .route("/notifications/read-all", post(notifications::mark_all_read))
        .route("/notifications/{id}/read", post(notifications::mark_read))
        .route("/team/members", get(team::list_members).post(team::create_member))
        .route("/team/members/{id}", patch(team::update_member))
        .route("/team/members/{id}/reset-password", post(team::reset_member_password))
        .route("/roles", get(team::list_roles))
        // Lead management
        .route("/leads", get(leads::list).post(leads::create))
        .route("/leads/export", get(leads::export))
        .route("/leads/facets", get(leads::facets))
        .route("/leads/bulk", post(leads::bulk))
        .route("/leads/duplicates", get(leads::duplicates::groups))
        .route("/leads/merge", post(leads::duplicates::merge))
        .route("/leads/import", post(leads::import::import))
        .route("/leads/import/preview", post(leads::import::preview))
        .route("/leads/import/history", get(leads::import::history))
        .route("/leads/{id}", get(leads::get).patch(leads::update).delete(leads::remove))
        .route("/leads/{id}/research", get(leads::research::get).put(leads::research::save))
        .route("/lead-lists", get(leads::lists::list).post(leads::lists::create))
        .route(
            "/lead-lists/{id}",
            get(leads::lists::get).patch(leads::lists::update).delete(leads::lists::remove),
        )
        // CRM & sales
        .route("/pipeline", get(sales::pipeline::board))
        .route("/pipeline/stages", post(sales::pipeline::create_stage))
        .route("/pipeline/stages/reorder", post(sales::pipeline::reorder_stages))
        .route("/pipeline/stages/{id}", patch(sales::pipeline::update_stage).delete(sales::pipeline::remove_stage))
        .route("/leads/{id}/stage", post(sales::pipeline::move_lead))
        .route("/leads/{id}/interactions", post(sales::interactions::log))
        .route("/leads/{id}/convert", post(sales::conversion::convert))
        .route("/interactions", get(sales::interactions::list))
        .route("/interactions/{id}", axum::routing::delete(sales::interactions::remove))
        .route("/follow-ups", get(sales::follow_ups::list).post(sales::follow_ups::create))
        .route("/follow-ups/{id}", patch(sales::follow_ups::update).delete(sales::follow_ups::remove))
        .route("/follow-ups/{id}/complete", post(sales::follow_ups::complete))
        .route("/meetings", get(sales::meetings::list).post(sales::meetings::create))
        .route("/meetings/{id}", patch(sales::meetings::update).delete(sales::meetings::remove))
        .route("/deals", get(sales::deals::list).post(sales::deals::create))
        .route("/deals/{id}", patch(sales::deals::update).delete(sales::deals::remove))
        .route("/deals/{id}/close", post(sales::deals::close))
        .route("/proposals", get(sales::proposals::list).post(sales::proposals::create))
        .route("/proposals/{id}", get(sales::proposals::get).put(sales::proposals::save).delete(sales::proposals::remove))
        .route("/proposals/{id}/status", post(sales::proposals::set_status))
        .route("/proposals/{id}/duplicate", post(sales::proposals::duplicate))
        .route("/saved-filters", get(saved_filters::list).post(saved_filters::create))
        .route("/saved-filters/{id}", axum::routing::delete(saved_filters::remove));

    Router::new().nest("/api/v1", api).with_state(state)
}
