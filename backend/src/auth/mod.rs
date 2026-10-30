//! Authentication (Supabase access tokens) and authorization (ODDLY roles & permissions).

mod jwt;
mod user;

pub use jwt::JwtVerifier;
pub use user::AuthUser;

/// Permission keys, mirroring `public.permissions`. Use these constants instead of
/// string literals so a typo is a compile error.
#[allow(dead_code)]
pub mod perm {
    pub const DASHBOARD_VIEW: &str = "dashboard.view";
    pub const LEADS_VIEW: &str = "leads.view";
    pub const LEADS_VIEW_ALL: &str = "leads.view_all";
    pub const SALES_VIEW: &str = "sales.view";
    pub const PROPOSALS_VIEW: &str = "proposals.view";
    pub const CLIENTS_VIEW: &str = "clients.view";
    pub const CONTENT_VIEW: &str = "content.view";
    pub const PROJECTS_VIEW: &str = "projects.view";
    pub const FINANCE_VIEW: &str = "finance.view";
    pub const AI_USE: &str = "ai.use";
    pub const ACTIVITY_VIEW_ALL: &str = "activity.view_all";
    pub const TEAM_VIEW: &str = "team.view";
    pub const TEAM_MANAGE: &str = "team.manage";
}
