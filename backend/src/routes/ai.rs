//! AI assistant endpoints. All model calls happen here on the server; results are
//! suggestions and drafts only — nothing is sent, changed, approved or published by AI.

use std::time::Duration;

use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{
    ai::{tools, Msg, OpenAi, Usage, GROUND_RULES},
    audit::{self, AuditEntry},
    auth::AuthUser,
    error::{AppError, AppResult},
    state::AppState,
};

const MAX_TOOL_ROUNDS: usize = 6;
const HISTORY_MESSAGES: i64 = 20;

#[derive(Serialize)]
pub struct Status {
    configured: bool,
    allowed: bool,
    model: Option<String>,
}

pub async fn status(State(state): State<AppState>, user: AuthUser) -> Json<Status> {
    Json(Status {
        configured: state.ai.is_some(),
        allowed: user.can("ai.use"),
        model: state.ai.as_ref().map(|a| a.model.clone()),
    })
}

/// The AI client, after checking permission, configuration and the per-user AI rate limit.
fn client<'a>(state: &'a AppState, user: &AuthUser) -> AppResult<&'a OpenAi> {
    user.require("ai.use")?;
    let ai = state.ai.as_deref().ok_or_else(|| {
        AppError::Unavailable("The AI assistant isn't set up yet. An administrator needs to add OPENAI_API_KEY to the server.".into())
    })?;
    if !state.limiter.check(&format!("ai:{}", user.id), 40, Duration::from_secs(600)) {
        return Err(AppError::TooManyRequests);
    }
    Ok(ai)
}

async fn today(state: &AppState, user: &AuthUser) -> AppResult<String> {
    let d: String = sqlx::query_scalar("select to_char(now() at time zone $1, 'FMDay, YYYY-MM-DD HH24:MI')")
        .bind(&user.timezone)
        .fetch_one(&state.db)
        .await?;
    Ok(d)
}

fn usage_json(model: &str, usage: Usage, tools_used: &[String]) -> Value {
    json!({ "model": model, "prompt_tokens": usage.prompt_tokens, "completion_tokens": usage.completion_tokens, "tools": tools_used })
}

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

#[derive(Serialize, sqlx::FromRow)]
pub struct Conversation {
    id: Uuid,
    title: Option<String>,
    context_type: Option<String>,
    context_id: Option<Uuid>,
    context_label: Option<String>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

const CONVERSATION_SELECT: &str = "select c.id, c.title, c.context_type::text as context_type, c.context_id,
    case c.context_type
      when 'lead' then (select co.name from public.leads l join public.companies co on co.id = l.company_id where l.id = c.context_id)
      when 'client' then (select co.name from public.clients cl join public.companies co on co.id = cl.company_id where cl.id = c.context_id)
    end as context_label,
    c.created_at, c.updated_at
  from public.ai_conversations c";

pub async fn list_conversations(State(state): State<AppState>, user: AuthUser) -> AppResult<Json<Vec<Conversation>>> {
    user.require("ai.use")?;
    Ok(Json(
        sqlx::query_as::<_, Conversation>(&format!(
            "{CONVERSATION_SELECT} where c.user_id = $1 and c.deleted_at is null order by c.updated_at desc limit 100"
        ))
        .bind(user.id)
        .fetch_all(&state.db)
        .await?,
    ))
}

#[derive(Deserialize)]
pub struct NewConversation {
    context_type: Option<String>,
    context_id: Option<Uuid>,
}

/// Checks the user may see the record a conversation is about.
async fn check_context(state: &AppState, user: &AuthUser, kind: &str, id: Uuid) -> AppResult<()> {
    match kind {
        "lead" => {
            user.require("leads.view")?;
            crate::routes::leads::ensure_visible(&state.db, user, id).await
        }
        "client" => {
            user.require("clients.view")?;
            let exists: bool = sqlx::query_scalar("select exists (select 1 from public.clients where id = $1 and deleted_at is null)")
                .bind(id)
                .fetch_one(&state.db)
                .await?;
            if exists { Ok(()) } else { Err(AppError::NotFound) }
        }
        _ => Err(AppError::BadRequest("Conversations can be about a lead or a client.".into())),
    }
}

pub async fn create_conversation(
    State(state): State<AppState>,
    user: AuthUser,
    Json(input): Json<NewConversation>,
) -> AppResult<Json<Conversation>> {
    user.require("ai.use")?;
    let context = match (input.context_type.as_deref(), input.context_id) {
        (Some(kind), Some(id)) => {
            check_context(&state, &user, kind, id).await?;
            Some((kind.to_owned(), id))
        }
        (None, None) => None,
        _ => return Err(AppError::BadRequest("Give both context_type and context_id, or neither.".into())),
    };
    let id: Uuid = sqlx::query_scalar(
        "insert into public.ai_conversations (user_id, context_type, context_id) values ($1, $2, $3) returning id",
    )
    .bind(user.id)
    .bind(context.as_ref().map(|c| c.0.clone()))
    .bind(context.map(|c| c.1))
    .fetch_one(&state.db)
    .await?;
    fetch_conversation(&state, &user, id).await.map(Json)
}

async fn fetch_conversation(state: &AppState, user: &AuthUser, id: Uuid) -> AppResult<Conversation> {
    sqlx::query_as::<_, Conversation>(&format!("{CONVERSATION_SELECT} where c.id = $1 and c.user_id = $2 and c.deleted_at is null"))
        .bind(id)
        .bind(user.id)
        .fetch_optional(&state.db)
        .await?
        .ok_or(AppError::NotFound)
}

#[derive(Serialize, sqlx::FromRow)]
pub struct Message {
    id: Uuid,
    role: String,
    content: String,
    tools: Vec<String>,
    created_at: DateTime<Utc>,
}

#[derive(Serialize)]
pub struct ConversationDetail {
    #[serde(flatten)]
    conversation: Conversation,
    messages: Vec<Message>,
}

pub async fn get_conversation(State(state): State<AppState>, user: AuthUser, Path(id): Path<Uuid>) -> AppResult<Json<ConversationDetail>> {
    user.require("ai.use")?;
    let conversation = fetch_conversation(&state, &user, id).await?;
    let messages = sqlx::query_as::<_, Message>(
        "select id, role, content,
                coalesce(array(select jsonb_array_elements_text(token_usage -> 'tools')), '{}') as tools, created_at
         from public.ai_messages where conversation_id = $1 and role in ('user', 'assistant') order by created_at, id",
    )
    .bind(id)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(ConversationDetail { conversation, messages }))
}

#[derive(Deserialize)]
pub struct Rename {
    title: String,
}

pub async fn rename_conversation(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Json(input): Json<Rename>,
) -> AppResult<Json<Conversation>> {
    user.require("ai.use")?;
    let title = input.title.trim();
    if title.is_empty() || title.chars().count() > 120 {
        return Err(AppError::BadRequest("Use a title of 1–120 characters.".into()));
    }
    let done = sqlx::query("update public.ai_conversations set title = $3, updated_at = now() where id = $1 and user_id = $2 and deleted_at is null")
        .bind(id)
        .bind(user.id)
        .bind(title)
        .execute(&state.db)
        .await?;
    if done.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    fetch_conversation(&state, &user, id).await.map(Json)
}

pub async fn delete_conversation(State(state): State<AppState>, user: AuthUser, Path(id): Path<Uuid>) -> AppResult<StatusCode> {
    user.require("ai.use")?;
    let done = sqlx::query("update public.ai_conversations set deleted_at = now() where id = $1 and user_id = $2 and deleted_at is null")
        .bind(id)
        .bind(user.id)
        .execute(&state.db)
        .await?;
    if done.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
pub struct NewMessage {
    content: String,
}

#[derive(Serialize)]
pub struct Exchange {
    user_message: Message,
    assistant_message: Message,
    conversation: Conversation,
}

pub async fn send_message(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Json(input): Json<NewMessage>,
) -> AppResult<Json<Exchange>> {
    let ai = client(&state, &user)?;
    let content = input.content.trim().to_owned();
    if content.is_empty() || content.chars().count() > 8000 {
        return Err(AppError::BadRequest("Write a message of up to 8,000 characters.".into()));
    }
    let conversation = fetch_conversation(&state, &user, id).await?;

    let mut history: Vec<(String, String)> = sqlx::query_as(
        "select role, content from (select role, content, created_at, id from public.ai_messages
           where conversation_id = $1 and role in ('user', 'assistant') order by created_at desc, id desc limit $2) h
         order by created_at, id",
    )
    .bind(id)
    .bind(HISTORY_MESSAGES)
    .fetch_all(&state.db)
    .await?;

    let mut system = format!(
        "You are the ODDLY assistant for a digital marketing agency. You are helping {name} (roles: {roles}). \
         Now: {now} ({tz}). Use the tools to look up agency data before answering questions about it. \
         Be concise and practical; use short paragraphs or bullet lists; refer to records by name, not id.\n\n{GROUND_RULES}",
        name = user.full_name,
        roles = user.roles.join(", "),
        now = today(&state, &user).await?,
        tz = user.timezone,
    );
    if let (Some(kind), Some(cid)) = (&conversation.context_type, conversation.context_id) {
        system.push_str(&format!(
            "\n\nThis conversation is about the {kind} \"{}\" (id {cid}). Look it up with the tools when relevant.",
            conversation.context_label.as_deref().unwrap_or("record")
        ));
    }

    let mut messages = vec![Msg::system(system)];
    for (role, text) in history.drain(..) {
        messages.push(if role == "user" { Msg::user(text) } else { Msg::assistant(text) });
    }
    messages.push(Msg::user(&content));

    let tool_defs = tools::definitions(&user);
    let offer_tools = tool_defs.as_array().is_some_and(|a| !a.is_empty());
    let mut usage = Usage::default();
    let mut used: Vec<String> = Vec::new();
    let mut reply: Option<String> = None;

    for round in 0..=MAX_TOOL_ROUNDS {
        let last = round == MAX_TOOL_ROUNDS;
        let (msg, u) = ai.chat(&messages, (offer_tools && !last).then_some(&tool_defs), false, 1500).await?;
        usage += u;
        match msg.tool_calls.clone().filter(|c| !c.is_empty()) {
            Some(calls) if !last => {
                messages.push(Msg { role: "assistant".into(), content: msg.content.clone(), tool_calls: Some(calls.clone()), tool_call_id: None });
                let results = futures::future::join_all(
                    calls.iter().map(|c| tools::run(&state, &user, &c.function.name, &c.function.arguments)),
                )
                .await;
                for (call, result) in calls.iter().zip(results) {
                    if !used.contains(&call.function.name) {
                        used.push(call.function.name.clone());
                    }
                    messages.push(Msg::tool(&call.id, result));
                }
            }
            _ => {
                reply = msg.content.filter(|t| !t.trim().is_empty());
                break;
            }
        }
    }
    let reply = reply.unwrap_or_else(|| "I couldn't put an answer together for that. Try asking in a different way.".into());

    let mut tx = state.db.begin().await?;
    let user_message = sqlx::query_as::<_, Message>(
        "insert into public.ai_messages (conversation_id, role, content) values ($1, 'user', $2)
         returning id, role, content, '{}'::text[] as tools, created_at",
    )
    .bind(id)
    .bind(&content)
    .fetch_one(&mut *tx)
    .await?;
    let assistant_message = sqlx::query_as::<_, Message>(
        "insert into public.ai_messages (conversation_id, role, content, model, token_usage, created_at)
         values ($1, 'assistant', $2, $3, $4, clock_timestamp())
         returning id, role, content, $5::text[] as tools, created_at",
    )
    .bind(id)
    .bind(&reply)
    .bind(&ai.model)
    .bind(usage_json(&ai.model, usage, &used))
    .bind(&used)
    .fetch_one(&mut *tx)
    .await?;
    let title: String = content.chars().take(60).collect();
    sqlx::query("update public.ai_conversations set updated_at = now(), title = coalesce(title, $2) where id = $1")
        .bind(id)
        .bind(title.trim())
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;

    Ok(Json(Exchange { user_message, assistant_message, conversation: fetch_conversation(&state, &user, id).await? }))
}

// ---------------------------------------------------------------------------
// Lead opportunity analyzer
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize)]
pub struct Opportunity {
    #[serde(default)]
    service: String,
    #[serde(default)]
    why: String,
}

#[derive(Serialize, Deserialize)]
pub struct LeadAnalysis {
    #[serde(default)]
    summary: String,
    #[serde(default)]
    opportunities: Vec<Opportunity>,
    #[serde(default)]
    observations: Vec<String>,
    #[serde(default)]
    outreach_angle: String,
    #[serde(default)]
    to_verify: Vec<String>,
    #[serde(default)]
    data_gaps: Vec<String>,
}

pub async fn analyze_lead(State(state): State<AppState>, user: AuthUser, Path(id): Path<Uuid>) -> AppResult<Json<Value>> {
    let ai = client(&state, &user)?;
    // Same visibility rules as the lead page (404 if the user can't see it).
    let lead = tools::dispatch(&state, &user, "get_lead", &json!({ "lead_id": id })).await?;
    let interactions = tools::run(&state, &user, "list_interactions", &json!({ "lead_id": id, "per_page": 10 }).to_string()).await;
    let services: Vec<String> = sqlx::query_scalar("select name from public.services where is_active order by name")
        .fetch_all(&state.db)
        .await
        .unwrap_or_default();

    let messages = [
        Msg::system(format!(
            "You analyze sales leads for a digital marketing agency and suggest where the agency could help. \
             Base every point strictly on the lead data below. You cannot browse the web, so you don't know anything \
             about the business beyond this data — list what should be checked in `to_verify` and missing information in `data_gaps`. \
             Prefer the agency's own services: {services}.\n\n{GROUND_RULES}\n\n\
             Reply with a JSON object: {{\"summary\": string (2-3 sentences), \"opportunities\": [{{\"service\": string, \"why\": string}}] (max 5), \
             \"observations\": [string] (max 5), \"outreach_angle\": string, \"to_verify\": [string], \"data_gaps\": [string]}}",
            services = if services.is_empty() { "(no catalog yet)".into() } else { services.join(", ") },
        )),
        Msg::user(format!("Lead data:\n{}\n\nRecent interactions:\n{interactions}", serde_json::to_string(&lead).unwrap_or_default())),
    ];
    let (analysis, _usage): (LeadAnalysis, Usage) = ai.json(&messages, 1500).await?;
    let stored = json!({
        "label": "AI suggestions — not verified",
        "model": ai.model,
        "generated_by": user.full_name,
        "analysis": analysis,
    });

    sqlx::query(
        "insert into public.lead_research (lead_id, ai_suggestions, ai_generated_at) values ($1, $2, now())
         on conflict (lead_id) do update set ai_suggestions = excluded.ai_suggestions, ai_generated_at = now(), updated_at = now()",
    )
    .bind(id)
    .bind(&stored)
    .execute(&state.db)
    .await?;
    audit::record(
        &state.db,
        AuditEntry { actor_id: Some(user.id), action: "ai.lead_analyzed", entity_type: Some("lead"), entity_id: Some(id), changes: json!({ "model": ai.model }) },
    )
    .await?;
    Ok(Json(stored))
}

// ---------------------------------------------------------------------------
// Drafts
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct DraftRequest {
    kind: String,
    lead_id: Option<Uuid>,
    client_id: Option<Uuid>,
    /// email, facebook, instagram, linkedin, whatsapp, sms, phone (call script)
    channel: Option<String>,
    tone: Option<String>,
    /// Extra direction from the user, or meeting notes for a meeting summary.
    instructions: Option<String>,
}

#[derive(Serialize)]
pub struct Draft {
    kind: String,
    text: String,
    model: String,
    label: &'static str,
}

const DRAFT_KINDS: &[&str] = &[
    "outreach", "follow_up", "proposal_description", "caption", "content_ideas", "meeting_summary", "client_summary", "weekly_summary",
];

pub async fn draft(State(state): State<AppState>, user: AuthUser, Json(req): Json<DraftRequest>) -> AppResult<Json<Draft>> {
    if !DRAFT_KINDS.contains(&req.kind.as_str()) {
        return Err(AppError::BadRequest("Unknown draft type.".into()));
    }
    let instructions = req.instructions.as_deref().map(str::trim).filter(|s| !s.is_empty());
    if instructions.is_some_and(|s| s.chars().count() > 6000) {
        return Err(AppError::BadRequest("Keep the notes under 6,000 characters.".into()));
    }
    let ai = client(&state, &user)?;
    let lead = |id: Option<Uuid>| {
        let (state, user) = (&state, &user);
        async move {
            let id = id.ok_or_else(|| AppError::BadRequest("Choose a lead.".into()))?;
            tools::dispatch(state, user, "get_lead", &json!({ "lead_id": id })).await
        }
    };
    let client_ctx = |id: Option<Uuid>| {
        let (state, user) = (&state, &user);
        async move {
            let id = id.ok_or_else(|| AppError::BadRequest("Choose a client.".into()))?;
            tools::dispatch(state, user, "get_client", &json!({ "client_id": id })).await
        }
    };
    let channel = req.channel.as_deref().unwrap_or("email");
    let tone = req.tone.as_deref().unwrap_or("friendly and professional");

    let (task, context): (String, String) = match req.kind.as_str() {
        "outreach" | "follow_up" => {
            let l = lead(req.lead_id).await?;
            let id = req.lead_id.unwrap_or_default();
            let history = tools::run(&state, &user, "list_interactions", &json!({ "lead_id": id, "per_page": 10 }).to_string()).await;
            let what = if req.kind == "outreach" { "a first outreach message" } else { "a follow-up message that builds on the previous interactions" };
            (
                format!(
                    "Write {what} for the {channel} channel, in a {tone} tone, from {name} at the agency to this lead. \
                     For email include a subject line first (\"Subject: …\"). Keep it short and specific to what the data says about the business; \
                     don't claim to have seen anything not in the data. Use [placeholders] for anything unknown (e.g. [your phone]).",
                    name = user.full_name
                ),
                format!("Lead:\n{}\n\nPrevious interactions:\n{history}", serde_json::to_string(&l).unwrap_or_default()),
            )
        }
        "proposal_description" => {
            let ctx = match (req.lead_id, req.client_id) {
                (Some(_), _) => lead(req.lead_id).await?,
                (None, Some(_)) => client_ctx(req.client_id).await?,
                _ => return Err(AppError::BadRequest("Choose a lead or a client.".into())),
            };
            (
                format!("Write the introduction / scope description for a proposal, in a {tone} tone: what the agency will do and why it fits this business. 2–4 short paragraphs. Don't state prices."),
                format!("Prospect:\n{}", serde_json::to_string(&ctx).unwrap_or_default()),
            )
        }
        "caption" | "content_ideas" => {
            let c = client_ctx(req.client_id).await?;
            let recent = tools::run(&state, &user, "list_content", &json!({ "client_id": req.client_id, "per_page": 10 }).to_string()).await;
            let what = if req.kind == "caption" {
                format!("Write 3 alternative social media captions for {channel}, in a {tone} tone, with a few relevant hashtags each. Number them.")
            } else {
                "Suggest 8 content ideas for this client's social media: a title and one line each, mixing formats (reel, carousel, story, post).".to_owned()
            };
            (what, format!("Client:\n{}\n\nRecent posts:\n{recent}", serde_json::to_string(&c).unwrap_or_default()))
        }
        "meeting_summary" => {
            let notes = instructions.ok_or_else(|| AppError::BadRequest("Paste the meeting notes to summarize.".into()))?;
            let ctx = match (req.lead_id, req.client_id) {
                (Some(_), _) => serde_json::to_string(&lead(req.lead_id).await?).unwrap_or_default(),
                (None, Some(_)) => serde_json::to_string(&client_ctx(req.client_id).await?).unwrap_or_default(),
                _ => "(none)".into(),
            };
            return finish(
                &user, ai, &req.kind,
                "Summarize these meeting notes: a short summary, decisions, action items (with owner if named) and open questions. Use only what the notes say.".into(),
                format!("Related record:\n{ctx}\n\nMeeting notes:\n{notes}"),
                None,
            )
            .await;
        }
        "client_summary" => {
            let c = client_ctx(req.client_id).await?;
            let history = tools::run(&state, &user, "client_history", &json!({ "client_id": req.client_id }).to_string()).await;
            (
                "Summarize this client account for a colleague: who they are, services, status, recent activity, open items and risks. Short sections with bullets.".into(),
                format!("Client:\n{}\n\nHistory:\n{history}", serde_json::to_string(&c).unwrap_or_default()),
            )
        }
        _ => {
            // weekly_summary: the past 7 days of whatever this user can see.
            let today: chrono::NaiveDate = sqlx::query_scalar("select (now() at time zone $1)::date").bind(&user.timezone).fetch_one(&state.db).await?;
            let range = json!({ "from": today - chrono::Duration::days(6), "to": today }).to_string();
            let (leads_r, sales_r, tasks_r, follow_r) = tokio::join!(
                tools::run(&state, &user, "lead_report", &range),
                tools::run(&state, &user, "sales_report", &range),
                tools::run(&state, &user, "list_tasks", "{}"),
                tools::run(&state, &user, "list_follow_ups", r#"{"due":"week"}"#),
            );
            (
                "Write a weekly summary for the agency team: highlights, numbers that changed, what needs attention next week. Bullets, under 250 words. Skip any section whose data says it's not permitted.".into(),
                format!("Lead report:\n{leads_r}\n\nSales report:\n{sales_r}\n\nOpen tasks:\n{tasks_r}\n\nFollow-ups this week:\n{follow_r}"),
            )
        }
    };
    finish(&user, ai, &req.kind, task, context, instructions).await
}

async fn finish(
    user: &AuthUser,
    ai: &OpenAi,
    kind: &str,
    task: String,
    context: String,
    instructions: Option<&str>,
) -> AppResult<Json<Draft>> {
    let mut prompt = format!("Task: {task}\n\n{context}");
    if let Some(extra) = instructions {
        prompt.push_str(&format!("\n\nExtra direction from {}: {extra}", user.full_name));
    }
    let messages = [
        Msg::system(format!(
            "You write drafts for a digital marketing agency team member, {}. Return only the draft text, ready to edit — no preamble.\n\n{GROUND_RULES}",
            user.full_name
        )),
        Msg::user(prompt),
    ];
    let (msg, _usage) = ai.chat(&messages, None, false, 1200).await?;
    let text = msg.content.unwrap_or_default().trim().to_owned();
    if text.is_empty() {
        return Err(AppError::Unavailable("The AI returned an empty draft. Please try again.".into()));
    }
    Ok(Json(Draft { kind: kind.to_owned(), text, model: ai.model.clone(), label: "AI draft — review before using" }))
}

// ---------------------------------------------------------------------------
// Dashboard insights
// ---------------------------------------------------------------------------

#[derive(Deserialize, Default)]
pub struct InsightsRequest {
    #[serde(default)]
    refresh: bool,
}

#[derive(Serialize)]
pub struct Insights {
    items: Vec<String>,
    cached: bool,
}

#[derive(Deserialize)]
struct InsightsReply {
    #[serde(default)]
    insights: Vec<String>,
}

pub async fn insights(State(state): State<AppState>, user: AuthUser, Json(body): Json<InsightsRequest>) -> AppResult<Json<Insights>> {
    user.require("ai.use")?;
    let refresh = body.refresh;
    if let (Some(ai), false) = (state.ai.as_deref(), refresh) {
        if let Some(items) = ai.cached_insights(user.id) {
            return Ok(Json(Insights { items, cached: true }));
        }
    }
    let ai = client(&state, &user)?;
    let today: chrono::NaiveDate = sqlx::query_scalar("select (now() at time zone $1)::date").bind(&user.timezone).fetch_one(&state.db).await?;
    let range = json!({ "from": today - chrono::Duration::days(29), "to": today }).to_string();
    let (leads_r, sales_r, tasks_r, follow_r, stale_r) = tokio::join!(
        tools::run(&state, &user, "lead_report", &range),
        tools::run(&state, &user, "sales_report", &range),
        tools::run(&state, &user, "list_tasks", "{}"),
        tools::run(&state, &user, "list_follow_ups", r#"{"due":"overdue"}"#),
        tools::run(&state, &user, "search_leads", r#"{"stale_days":14,"status":"active","per_page":10}"#),
    );
    let messages = [
        Msg::system(format!(
            "You give a busy agency team member 3 to 5 short, practical insights for today from their data (last 30 days). \
             Each insight: one sentence, max 200 characters, specific (names and numbers from the data), ideally with a next step. \
             Skip data marked as not permitted. If there's too little data, say what to start with.\n\n{GROUND_RULES}\n\n\
             Reply with a JSON object: {{\"insights\": [string]}}"
        )),
        Msg::user(format!(
            "Lead report:\n{leads_r}\n\nSales report:\n{sales_r}\n\nMy open tasks:\n{tasks_r}\n\nOverdue follow-ups:\n{follow_r}\n\nActive leads not contacted in 14+ days:\n{stale_r}"
        )),
    ];
    let (reply, _usage): (InsightsReply, Usage) = ai.json(&messages, 700).await?;
    let items: Vec<String> = reply.insights.into_iter().map(|s| s.trim().to_owned()).filter(|s| !s.is_empty()).take(5).collect();
    ai.store_insights(user.id, items.clone());
    Ok(Json(Insights { items, cached: false }))
}
