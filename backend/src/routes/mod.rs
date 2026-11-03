use axum::{
    routing::{get, patch, post},
    Router,
};

use crate::state::AppState;

pub(crate) mod clients;
pub(crate) mod common;
pub(crate) mod content;
pub(crate) mod ai;
pub(crate) mod analytics;
pub(crate) mod dashboard;
pub(crate) mod files;
pub(crate) mod health;
pub(crate) mod leads;
pub(crate) mod lookups;
pub(crate) mod me;
pub(crate) mod notifications;
pub(crate) mod projects;
pub(crate) mod sales;
pub(crate) mod saved_filters;
pub(crate) mod setup;
pub(crate) mod team;
pub(crate) mod updates;
pub(crate) mod websites;

pub fn router(state: AppState) -> Router {
    let api = Router::new()
        .route("/health", get(health::health))
        .route("/updates/latest.json", get(updates::latest))
        .route("/updates/download", get(updates::download))
        .route("/updates/{name}", get(updates::installer))
        .route("/setup/status", get(setup::status))
        .route("/setup", post(setup::create_owner))
        .route("/me", get(me::get_me).patch(me::update_me))
        .route("/me/password", post(me::change_password))
        .route("/dashboard", get(dashboard::summary))
        .route("/ai/status", get(ai::status))
        .route("/ai/conversations", get(ai::list_conversations).post(ai::create_conversation))
        .route("/ai/conversations/{id}", get(ai::get_conversation).patch(ai::rename_conversation).delete(ai::delete_conversation))
        .route("/ai/conversations/{id}/messages", post(ai::send_message))
        .route("/ai/leads/{id}/analyze", post(ai::analyze_lead))
        .route("/ai/drafts", post(ai::draft))
        .route("/ai/insights", post(ai::insights))
        .route("/analytics/leads", get(analytics::leads))
        .route("/analytics/sales", get(analytics::sales))
        .route("/analytics/clients", get(analytics::clients))
        .route("/analytics/finance", get(analytics::finance))
        .route("/analytics/team", get(analytics::team))
        .route("/lookups", get(lookups::lookups))
        .route("/notifications", get(notifications::list))
        .route("/notifications/read-all", post(notifications::mark_all_read))
        .route("/notifications/{id}/read", post(notifications::mark_read))
        .route("/team/members", get(team::list_members).post(team::create_member))
        .route("/team/members/{id}", patch(team::update_member))
        .route("/team/members/{id}/reset-password", post(team::reset_member_password))
        .route("/roles", get(team::list_roles))
        .route("/team/workload", get(team::workload))
        .route("/audit-log", get(team::audit_log))
        // Projects & tasks
        .route("/projects", get(projects::list).post(projects::create))
        .route("/projects/templates", get(projects::templates))
        .route("/projects/{id}", get(projects::get).put(projects::update).delete(projects::remove))
        .route("/tasks", get(projects::tasks::list).post(projects::tasks::create))
        .route("/tasks/{id}", get(projects::tasks::get).put(projects::tasks::update).delete(projects::tasks::remove))
        .route("/tasks/{id}/move", post(projects::tasks::move_task))
        .route("/tasks/{id}/subtasks", post(projects::tasks::add_subtask))
        .route("/tasks/{id}/subtasks/{sub}", axum::routing::put(projects::tasks::update_subtask).delete(projects::tasks::remove_subtask))
        .route("/tasks/{id}/comments", post(projects::tasks::add_comment))
        .route("/tasks/{id}/comments/{comment}", axum::routing::delete(projects::tasks::remove_comment))
        // Content studio
        .route("/content", get(content::list).post(content::create))
        .route("/content/assets", get(content::assets).post(content::add_asset))
        .route("/content/assets/{id}", axum::routing::put(content::update_asset).delete(content::remove_asset))
        .route("/content/stages", post(content::create_stage))
        .route("/content/stages/reorder", post(content::reorder_stages))
        .route("/content/stages/{id}", axum::routing::put(content::update_stage).delete(content::remove_stage))
        .route("/content/{id}", get(content::get).put(content::update).delete(content::remove))
        .route("/content/{id}/stage", post(content::move_stage))
        .route("/content/{id}/review", post(content::review))
        // Websites
        .route("/websites", get(websites::list).post(websites::create))
        .route("/websites/{id}", get(websites::get).put(websites::update).delete(websites::remove))
        .route("/websites/{id}/check", post(websites::check_now))
        .route("/websites/{id}/maintenance", post(websites::add_maintenance))
        .route("/websites/{id}/secrets", post(websites::add_secret))
        .route("/maintenance", get(websites::maintenance))
        .route("/maintenance/{id}", axum::routing::put(websites::update_maintenance).delete(websites::remove_maintenance))
        .route("/secrets/{id}", axum::routing::put(websites::update_secret).delete(websites::remove_secret))
        .route("/secrets/{id}/reveal", post(websites::reveal_secret))
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
        // Clients
        .route("/clients", get(clients::list).post(clients::create))
        .route("/clients/activity", get(clients::feed))
        .route("/clients/{id}", get(clients::get).put(clients::update).delete(clients::remove))
        .route("/clients/{id}/status", post(clients::set_status))
        .route("/clients/{id}/history", get(clients::history))
        .route("/clients/{id}/contacts", post(clients::add_contact))
        .route("/clients/{id}/contacts/{contact_id}", axum::routing::put(clients::update_contact).delete(clients::remove_contact))
        .route("/clients/{id}/services", post(clients::add_service))
        .route("/clients/{id}/services/{service_id}", axum::routing::put(clients::update_service).delete(clients::remove_service))
        .route("/clients/{id}/onboarding", post(clients::start_onboarding))
        .route("/clients/{id}/onboarding/{task_id}", post(clients::toggle_onboarding))
        .route("/clients/{id}/contracts", post(clients::contracts::create))
        .route("/contracts", get(clients::contracts::list))
        .route("/contracts/{id}", axum::routing::put(clients::contracts::update).delete(clients::contracts::remove))
        .route("/services", get(clients::services::list).post(clients::services::create))
        .route("/services/{id}", axum::routing::put(clients::services::update))
        // Files
        .route("/files", get(files::list).post(files::register))
        .route("/files/upload-url", post(files::upload_url))
        .route("/files/{id}/download", get(files::download))
        .route("/files/{id}", axum::routing::delete(files::remove))
        .route("/saved-filters", get(saved_filters::list).post(saved_filters::create))
        .route("/saved-filters/{id}", axum::routing::delete(saved_filters::remove));

    Router::new().nest("/api/v1", api).with_state(state)
}
