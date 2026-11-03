//! Read-only tools for the assistant. Each one calls the same handler the app uses, as
//! the signed-in user, so the assistant sees exactly what that user may see — no more.

use axum::{
    extract::{Path, Query, State},
    Json,
};
use serde::de::DeserializeOwned;
use serde_json::{json, Map, Value};
use uuid::Uuid;

use crate::{
    auth::AuthUser,
    error::{AppError, AppResult},
    routes::{analytics, clients, content, leads, projects, sales},
    state::AppState,
};

/// Tool results larger than this are cut, to keep prompts small.
const MAX_RESULT_CHARS: usize = 14_000;

fn tool(name: &str, description: &str, properties: Value, required: &[&str]) -> Value {
    json!({
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": { "type": "object", "properties": properties, "required": required, "additionalProperties": false },
        }
    })
}

fn range_props() -> Value {
    json!({
        "from": { "type": "string", "description": "Start date YYYY-MM-DD (default: 90 days ago)" },
        "to": { "type": "string", "description": "End date YYYY-MM-DD (default: today)" },
    })
}

/// The tools offered to the model, limited to what this user's permissions allow.
pub fn definitions(user: &AuthUser) -> Value {
    let mut tools = Vec::new();
    if user.can("leads.view") {
        tools.push(tool(
            "search_leads",
            "Search leads the user can see. Returns up to 25 matches with stage, status, owner and next action.",
            json!({
                "search": { "type": "string", "description": "Business name, contact, email, phone or city" },
                "market": { "type": "string", "enum": ["local", "international"] },
                "status": { "type": "string", "enum": ["active", "on_hold", "converted", "lost", "archived"] },
                "country": { "type": "string" },
                "industry": { "type": "string" },
                "stale_days": { "type": "integer", "description": "Active leads not contacted in this many days (or never)" },
                "researched": { "type": "boolean" },
                "assigned": { "type": "string", "description": "'me', 'unassigned' or omit for all" },
            }),
            &[],
        ));
        tools.push(tool(
            "get_lead",
            "Full details of one lead: company, contact, research notes, lists and recent timeline.",
            json!({ "lead_id": { "type": "string", "description": "Lead id from search_leads" } }),
            &["lead_id"],
        ));
    }
    if user.can("sales.view") {
        tools.push(tool(
            "list_follow_ups",
            "Follow-ups (default: the user's own pending ones).",
            json!({
                "scope": { "type": "string", "enum": ["mine", "team"] },
                "status": { "type": "string", "enum": ["pending", "done", "all"] },
                "due": { "type": "string", "enum": ["overdue", "today", "week"] },
            }),
            &[],
        ));
        tools.push(tool(
            "list_meetings",
            "Meetings between two dates (ISO 8601 date-times).",
            json!({
                "from": { "type": "string" },
                "to": { "type": "string" },
                "scope": { "type": "string", "enum": ["mine", "team"] },
            }),
            &[],
        ));
        tools.push(tool(
            "list_deals",
            "Deals with value, currency, owner and status.",
            json!({ "status": { "type": "string", "enum": ["open", "won", "lost"] }, "search": { "type": "string" } }),
            &[],
        ));
        tools.push(tool(
            "list_interactions",
            "Logged outreach (calls, emails, messages) — optionally for one lead.",
            json!({ "lead_id": { "type": "string" }, "search": { "type": "string" } }),
            &[],
        ));
    }
    if user.can("proposals.view") {
        tools.push(tool(
            "list_proposals",
            "Proposals with status, total and currency.",
            json!({ "status": { "type": "string", "enum": ["draft", "ready", "sent", "accepted", "rejected", "expired"] }, "search": { "type": "string" } }),
            &[],
        ));
    }
    if user.can("clients.view") {
        tools.push(tool(
            "search_clients",
            "Search clients. status: 'current' (default), 'all' or a specific status.",
            json!({ "search": { "type": "string" }, "status": { "type": "string" } }),
            &[],
        ));
        tools.push(tool(
            "get_client",
            "Full details of one client: company, contacts, services, onboarding and counts.",
            json!({ "client_id": { "type": "string" } }),
            &["client_id"],
        ));
        tools.push(tool(
            "client_history",
            "Timeline of one client (meetings, interactions, notes, changes).",
            json!({ "client_id": { "type": "string" } }),
            &["client_id"],
        ));
    }
    if user.can("projects.view") {
        tools.push(tool(
            "list_tasks",
            "Tasks. assignee: 'me' (default), 'unassigned' or omit; status: 'open' (default), a status, or '' for all.",
            json!({
                "assignee": { "type": "string" },
                "status": { "type": "string" },
                "due_to": { "type": "string", "description": "Only tasks due before this ISO 8601 date-time" },
                "search": { "type": "string" },
            }),
            &[],
        ));
    }
    if user.can("content.view") {
        tools.push(tool(
            "list_content",
            "Content posts in a period, with platform, stage, caption and client.",
            json!({
                "client_id": { "type": "string" },
                "from": { "type": "string", "description": "ISO 8601 date-time" },
                "to": { "type": "string", "description": "ISO 8601 date-time" },
                "search": { "type": "string" },
            }),
            &[],
        ));
    }
    if user.can("analytics.view") {
        tools.push(tool("lead_report", "Lead analytics for a date range: new leads, contact and conversion rates, by market/country/industry/source/stage/owner.", range_props(), &[]));
        tools.push(tool("sales_report", "Sales analytics for a date range: deals won/lost, proposal outcomes, outreach; money per currency if permitted.", range_props(), &[]));
        if user.can("clients.view") {
            tools.push(tool("client_report", "Client analytics: current, new, retained, by status/industry, services used.", range_props(), &[]));
        }
        if user.can("finance.view") {
            tools.push(tool("finance_report", "Revenue per currency: won deals, recurring services, contracts, pending proposals.", range_props(), &[]));
        }
        if user.can("team.view") {
            tools.push(tool("team_report", "Completed work per team member in a date range.", range_props(), &[]));
        }
    }
    Value::Array(tools)
}

fn args<T: DeserializeOwned>(v: &Value) -> AppResult<T> {
    serde_json::from_value(v.clone()).map_err(|e| AppError::BadRequest(format!("invalid tool arguments: {e}")))
}

fn uuid_arg(v: &Value, key: &str) -> AppResult<Uuid> {
    v.get(key)
        .and_then(Value::as_str)
        .and_then(|s| s.parse().ok())
        .ok_or_else(|| AppError::BadRequest(format!("{key} must be a record id")))
}

fn to_json<T: serde::Serialize>(r: AppResult<Json<T>>) -> AppResult<Value> {
    r.map(|Json(v)| serde_json::to_value(v).unwrap_or(Value::Null))
}

/// Keeps only the listed keys of each object in `items` (smaller prompts, fewer distractions).
fn pick(value: Value, keys: &[&str]) -> Value {
    let keep = |o: Map<String, Value>| Value::Object(o.into_iter().filter(|(k, v)| keys.contains(&k.as_str()) && !v.is_null()).collect());
    match value {
        Value::Array(items) => Value::Array(items.into_iter().map(|i| if let Value::Object(o) = i { keep(o) } else { i }).collect()),
        Value::Object(mut o) if o.contains_key("items") => {
            let items = o.remove("items").unwrap_or(Value::Null);
            json!({ "total": o.get("total"), "items": pick(items, keys) })
        }
        Value::Object(o) => keep(o),
        other => other,
    }
}

/// Drops nulls/empties recursively.
fn compact(value: Value) -> Value {
    match value {
        Value::Object(o) => Value::Object(
            o.into_iter()
                .map(|(k, v)| (k, compact(v)))
                .filter(|(_, v)| !(v.is_null() || v.as_array().is_some_and(|a| a.is_empty()) || v.as_str() == Some("")))
                .collect(),
        ),
        Value::Array(a) => Value::Array(a.into_iter().map(compact).collect()),
        other => other,
    }
}

const LEAD_KEYS: &[&str] = &[
    "id", "business_name", "industry", "category", "market", "country", "city", "website_url", "contact_name", "contact_position",
    "source_name", "stage_name", "status", "priority", "assigned_to_name", "estimated_value", "currency", "last_contacted_at",
    "next_action", "next_action_at", "lead_score", "created_at",
];

/// Runs one tool call as `user`. Errors (including "not permitted") go back to the model as text.
pub async fn run(state: &AppState, user: &AuthUser, name: &str, raw_args: &str) -> String {
    let parsed: Value = serde_json::from_str(if raw_args.trim().is_empty() { "{}" } else { raw_args }).unwrap_or(json!({}));
    let result = dispatch(state, user, name, &parsed).await;
    let text = match result {
        Ok(v) => serde_json::to_string(&compact(v)).unwrap_or_else(|_| "null".into()),
        Err(AppError::Forbidden { message, .. }) => json!({ "error": format!("Not permitted for this user: {message}") }).to_string(),
        Err(AppError::NotFound) => json!({ "error": "No record with that id that this user can see." }).to_string(),
        Err(AppError::BadRequest(m)) => json!({ "error": m }).to_string(),
        Err(e) => {
            tracing::warn!(tool = name, error = ?e, "AI tool failed");
            json!({ "error": "That lookup failed." }).to_string()
        }
    };
    if text.len() > MAX_RESULT_CHARS {
        let cut = text.char_indices().take_while(|(i, _)| *i < MAX_RESULT_CHARS).last().map_or(0, |(i, _)| i);
        format!("{}… [truncated — ask a narrower question]", &text[..cut])
    } else {
        text
    }
}

/// Runs a tool and returns its data (errors propagate, e.g. 404 when the user can't see a record).
pub async fn dispatch(state: &AppState, user: &AuthUser, name: &str, a: &Value) -> AppResult<Value> {
    let s = || State(state.clone());
    let u = || user.clone();
    let mut a = a.clone();
    if let Value::Object(o) = &mut a {
        o.entry("per_page").or_insert(json!(25));
    }
    let without_paging = |mut v: Value| {
        if let Value::Object(o) = &mut v {
            o.remove("per_page");
        }
        v
    };
    Ok(match name {
        "search_leads" => pick(to_json(leads::list(s(), u(), Query(args(&a)?)).await)?, LEAD_KEYS),
        "get_lead" => {
            let id = uuid_arg(&a, "lead_id")?;
            let (detail, research) = tokio::try_join!(
                async { to_json(leads::get(s(), u(), Path(id)).await) },
                async { to_json(leads::research::get(s(), u(), Path(id)).await) },
            )?;
            let mut detail = detail;
            if let Some(timeline) = detail.get_mut("timeline").and_then(Value::as_array_mut) {
                timeline.truncate(15);
            }
            for k in ["company_id", "primary_contact_id", "source_id", "stage_id", "stage_color", "assigned_to", "normalized_name"] {
                detail.as_object_mut().map(|o| o.remove(k));
            }
            json!({ "lead": detail, "research": research })
        }
        "list_follow_ups" => to_json(sales::follow_ups::list(s(), u(), Query(args(&a)?)).await)?,
        "list_meetings" => to_json(sales::meetings::list(s(), u(), Query(args(&without_paging(a))?)).await)?,
        "list_deals" => to_json(sales::deals::list(s(), u(), Query(args(&a)?)).await)?,
        "list_interactions" => to_json(sales::interactions::list(s(), u(), Query(args(&a)?)).await)?,
        "list_proposals" => pick(
            to_json(sales::proposals::list(s(), u(), Query(args(&a)?)).await)?,
            &["id", "number", "title", "status", "company_name", "total", "currency", "sent_at", "valid_until", "responded_at", "owner_name", "updated_at"],
        ),
        "search_clients" => to_json(clients::list(s(), u(), Query(args(&a)?)).await)?,
        "get_client" => to_json(clients::get(s(), u(), Path(uuid_arg(&a, "client_id")?)).await)?,
        "client_history" => {
            let mut v = to_json(clients::history(s(), u(), Path(uuid_arg(&a, "client_id")?)).await)?;
            if let Some(items) = v.as_array_mut() {
                items.truncate(30);
            }
            v
        }
        "list_tasks" => {
            let mut q = without_paging(a);
            if let Value::Object(o) = &mut q {
                o.entry("assignee").or_insert(json!("me"));
                o.entry("status").or_insert(json!("open"));
            }
            let mut v = to_json(projects::tasks::list(s(), u(), Query(args(&q)?)).await)?;
            if let Some(items) = v.as_array_mut() {
                items.truncate(40);
            }
            v
        }
        "list_content" => {
            let mut v = to_json(content::list(s(), u(), Query(args(&without_paging(a))?)).await)?;
            if let Some(items) = v.as_array_mut() {
                items.truncate(30);
            }
            v
        }
        "lead_report" => to_json(analytics::leads(s(), u(), Query(args(&without_paging(a))?)).await)?,
        "sales_report" => to_json(analytics::sales(s(), u(), Query(args(&without_paging(a))?)).await)?,
        "client_report" => to_json(analytics::clients(s(), u(), Query(args(&without_paging(a))?)).await)?,
        "finance_report" => to_json(analytics::finance(s(), u(), Query(args(&without_paging(a))?)).await)?,
        "team_report" => to_json(analytics::team(s(), u(), Query(args(&without_paging(a))?)).await)?,
        other => return Err(AppError::BadRequest(format!("Unknown tool {other}"))),
    })
}
