//! Small helpers shared by the list endpoints.

use serde::Serialize;

#[derive(Serialize)]
pub struct Page<T> {
    pub items: Vec<T>,
    pub total: i64,
    pub page: i64,
    pub per_page: i64,
}

/// Clamps page/per_page from the query string to sane bounds.
pub fn paging(page: Option<i64>, per_page: Option<i64>, max: i64) -> (i64, i64, i64) {
    let per_page = per_page.unwrap_or(50).clamp(1, max);
    let page = page.unwrap_or(1).max(1);
    (page, per_page, (page - 1) * per_page)
}

/// Escapes `%`, `_` and `\` so user input is matched literally inside ILIKE.
pub fn like_pattern(term: &str) -> String {
    let escaped = term.trim().replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_");
    format!("%{escaped}%")
}

pub fn non_empty(value: &Option<String>) -> Option<&str> {
    value.as_deref().map(str::trim).filter(|v| !v.is_empty())
}
