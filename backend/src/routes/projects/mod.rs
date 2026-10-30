//! Projects (per client or internal) with members, deliverables and reusable templates.

pub mod tasks;

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{Postgres, QueryBuilder};
use uuid::Uuid;

use super::common::{like_pattern, non_empty};
use crate::{
    audit,
    auth::AuthUser,
    error::{AppError, AppResult},
    state::AppState,
    validate::{clean, Validator},
};

pub const PRIORITIES: &[&str] = &["low", "medium", "high", "urgent"];

/// Reusable starting points for common agency work: (key, name, category, tasks).
pub const TEMPLATES: &[(&str, &str, &str, &[&str])] = &[
    ("website", "Website build", "Website development", &[
        "Discovery call and sitemap", "Collect content, photos and logins", "Wireframes", "Design mockups",
        "Client design approval", "Development", "Content entry", "QA on mobile and desktop", "Launch", "Post-launch check",
    ]),
    ("social", "Social media setup", "Social media management", &[
        "Audit current pages", "Content pillars and strategy", "First month content calendar", "Post templates",
        "Design first month posts", "Write captions and hashtags", "Client approval", "Schedule posts", "Month-end report",
    ]),
    ("branding", "Branding", "Branding", &[
        "Brand questionnaire", "Moodboard", "Logo concepts", "Revisions", "Brand guidelines", "Final files handover",
    ]),
    ("maintenance", "Website maintenance (monthly)", "Website maintenance", &[
        "Core and plugin updates", "Verify backups", "Security scan", "Speed check", "Content updates", "Monthly report",
    ]),
];

#[derive(Serialize)]
pub struct Template {
    key: &'static str,
    name: &'static str,
    category: &'static str,
    tasks: &'static [&'static str],
}

pub async fn templates(_user: AuthUser) -> Json<Vec<Template>> {
    Json(TEMPLATES.iter().map(|(key, name, category, tasks)| Template { key, name, category, tasks }).collect())
}

#[derive(Serialize, sqlx::FromRow)]
pub struct Project {
    id: Uuid,
    name: String,
    description: Option<String>,
    category: Option<String>,
    status: String,
    priority: String,
    client_id: Option<Uuid>,
    client_name: Option<String>,
    start_date: Option<NaiveDate>,
    deadline: Option<NaiveDate>,
    completed_at: Option<DateTime<Utc>>,
    owner_id: Option<Uuid>,
    owner_name: Option<String>,
    deliverables: Vec<String>,
    total_tasks: i64,
    done_tasks: i64,
    overdue_tasks: i64,
    members: serde_json::Value,
    created_at: DateTime<Utc>,
}

const SELECT: &str = "select p.id, p.name, p.description, p.category, p.status, p.priority, p.client_id, co.name as client_name,
    p.start_date, p.deadline, p.completed_at, p.owner_id, o.full_name as owner_name, p.deliverables,
    (select count(*) from public.tasks t where t.project_id = p.id and t.deleted_at is null) as total_tasks,
    (select count(*) from public.tasks t where t.project_id = p.id and t.deleted_at is null and t.status = 'done') as done_tasks,
    (select count(*) from public.tasks t where t.project_id = p.id and t.deleted_at is null and t.status <> 'done' and t.due_at < now()) as overdue_tasks,
    coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'name', u.full_name, 'role', pm.role) order by u.full_name)
              from public.project_members pm join public.profiles u on u.id = pm.user_id where pm.project_id = p.id), '[]'::jsonb) as members,
    p.created_at
  from public.projects p
  left join public.clients cl on cl.id = p.client_id
  left join public.companies co on co.id = cl.company_id
  left join public.profiles o on o.id = p.owner_id";

#[derive(Deserialize, Default)]
pub struct ProjectQuery {
    /// A status, `current` (default: planning/active/on_hold) or `all`.
    status: Option<String>,
    client_id: Option<Uuid>,
    /// `me` = projects I own or am a member of.
    member: Option<String>,
    search: Option<String>,
}

pub async fn list(State(state): State<AppState>, user: AuthUser, Query(q): Query<ProjectQuery>) -> AppResult<Json<Vec<Project>>> {
    user.require("projects.view")?;
    let mut qb = QueryBuilder::<Postgres>::new(format!("{SELECT} where p.deleted_at is null"));
    match non_empty(&q.status) {
        Some("all") => {}
        Some(s) if s != "current" => {
            qb.push(" and p.status = ").push_bind(s.to_owned());
        }
        _ => {
            qb.push(" and p.status in ('planning','active','on_hold')");
        }
    }
    if let Some(c) = q.client_id {
        qb.push(" and p.client_id = ").push_bind(c);
    }
    if non_empty(&q.member) == Some("me") {
        qb.push(" and (p.owner_id = ").push_bind(user.id)
            .push(" or exists (select 1 from public.project_members pm where pm.project_id = p.id and pm.user_id = ")
            .push_bind(user.id).push("))");
    }
    if let Some(t) = non_empty(&q.search) {
        let pat = like_pattern(t);
        qb.push(" and (p.name ilike ").push_bind(pat.clone()).push(" or co.name ilike ").push_bind(pat).push(")");
    }
    qb.push(" order by p.deadline asc nulls last, p.created_at desc limit 500");
    Ok(Json(qb.build_query_as::<Project>().fetch_all(&state.db).await?))
}

pub async fn fetch(state: &AppState, id: Uuid) -> AppResult<Project> {
    sqlx::query_as::<_, Project>(&format!("{SELECT} where p.id = $1 and p.deleted_at is null"))
        .bind(id)
        .fetch_optional(&state.db)
        .await?
        .ok_or(AppError::NotFound)
}

pub async fn get(State(state): State<AppState>, user: AuthUser, Path(id): Path<Uuid>) -> AppResult<Json<Project>> {
    user.require("projects.view")?;
    Ok(Json(fetch(&state, id).await?))
}

#[derive(Deserialize)]
pub struct ProjectInput {
    name: String,
    description: Option<String>,
    category: Option<String>,
    status: Option<String>,
    priority: Option<String>,
    client_id: Option<Uuid>,
    start_date: Option<NaiveDate>,
    deadline: Option<NaiveDate>,
    owner_id: Option<Uuid>,
    #[serde(default)]
    deliverables: Vec<String>,
    #[serde(default)]
    member_ids: Vec<Uuid>,
    /// Creates the template's tasks (create only).
    template: Option<String>,
}

fn validate(i: &ProjectInput) -> AppResult<()> {
    let mut v = Validator::new();
    v.text("name", &i.name, 200);
    v.optional_text("description", i.description.as_deref(), 10_000);
    v.optional_text("category", i.category.as_deref(), 120);
    if let Some(s) = &i.status {
        v.one_of("status", s, &["planning", "active", "on_hold", "completed", "cancelled"]);
    }
    if let Some(p) = &i.priority {
        v.one_of("priority", p, PRIORITIES);
    }
    if let (Some(a), Some(b)) = (i.start_date, i.deadline) {
        if b < a {
            v.fail("deadline", "The deadline is before the start date.");
        }
    }
    if i.deliverables.len() > 50 {
        v.fail("deliverables", "Up to 50 deliverables.");
    }
    v.finish()
}

async fn set_members(tx: &mut sqlx::Transaction<'_, Postgres>, id: Uuid, ids: &[Uuid]) -> AppResult<()> {
    sqlx::query("delete from public.project_members where project_id = $1 and not (user_id = any($2))").bind(id).bind(ids).execute(&mut **tx).await?;
    sqlx::query("insert into public.project_members (project_id, user_id) select $1, unnest($2::uuid[]) on conflict do nothing").bind(id).bind(ids).execute(&mut **tx).await?;
    Ok(())
}

pub async fn create(State(state): State<AppState>, user: AuthUser, Json(i): Json<ProjectInput>) -> AppResult<Json<Project>> {
    user.require("projects.manage")?;
    validate(&i)?;
    let template = match i.template.as_deref().filter(|t| !t.is_empty()) {
        Some(key) => Some(TEMPLATES.iter().find(|t| t.0 == key).ok_or_else(|| AppError::BadRequest("Unknown project template.".into()))?),
        None => None,
    };
    let deliverables: Vec<String> = i.deliverables.iter().map(|d| d.trim().to_owned()).filter(|d| !d.is_empty()).collect();
    let mut tx = state.db.begin().await?;
    let id: Uuid = sqlx::query_scalar(
        "insert into public.projects (client_id, name, description, category, status, priority, start_date, deadline, owner_id, deliverables, created_by)
         values ($1,$2,$3,$4,coalesce($5,'planning'),coalesce($6,'medium'),$7,$8,coalesce($9,$10),$11,$10) returning id",
    )
    .bind(i.client_id).bind(i.name.trim()).bind(clean(i.description.clone()))
    .bind(clean(i.category.clone()).or_else(|| template.map(|t| t.2.to_owned())))
    .bind(&i.status).bind(&i.priority).bind(i.start_date).bind(i.deadline).bind(i.owner_id).bind(user.id).bind(&deliverables)
    .fetch_one(&mut *tx)
    .await?;
    let mut members = i.member_ids.clone();
    members.push(i.owner_id.unwrap_or(user.id));
    members.sort();
    members.dedup();
    set_members(&mut tx, id, &members).await?;
    if let Some((_, _, _, tasks)) = template {
        let titles: Vec<String> = tasks.iter().map(|t| (*t).to_owned()).collect();
        sqlx::query(
            "insert into public.tasks (project_id, client_id, title, status, priority, reporter_id, position)
             select $1, $2, t.title, 'todo', 'medium', $3, t.ord from unnest($4::text[]) with ordinality as t(title, ord)",
        )
        .bind(id).bind(i.client_id).bind(user.id).bind(&titles)
        .execute(&mut *tx)
        .await?;
    }
    if let Some(client) = i.client_id {
        audit::activity(&mut *tx, user.id, "client", client, "project.created", &format!("{} started the project {}", user.full_name, i.name.trim())).await?;
    }
    audit::activity(&mut *tx, user.id, "project", id, "project.created", &format!("{} created the project", user.full_name)).await?;
    tx.commit().await?;
    Ok(Json(fetch(&state, id).await?))
}

pub async fn update(State(state): State<AppState>, user: AuthUser, Path(id): Path<Uuid>, Json(i): Json<ProjectInput>) -> AppResult<Json<Project>> {
    user.require("projects.manage")?;
    validate(&i)?;
    let deliverables: Vec<String> = i.deliverables.iter().map(|d| d.trim().to_owned()).filter(|d| !d.is_empty()).collect();
    let mut tx = state.db.begin().await?;
    let updated = sqlx::query(
        "update public.projects set name=$2, description=$3, category=$4, status=coalesce($5,status), priority=coalesce($6,priority),
           client_id=$7, start_date=$8, deadline=$9, owner_id=coalesce($10, owner_id), deliverables=$11,
           completed_at = case when coalesce($5,status) = 'completed' then coalesce(completed_at, now()) else null end
         where id = $1 and deleted_at is null",
    )
    .bind(id).bind(i.name.trim()).bind(clean(i.description.clone())).bind(clean(i.category.clone())).bind(&i.status)
    .bind(&i.priority).bind(i.client_id).bind(i.start_date).bind(i.deadline).bind(i.owner_id).bind(&deliverables)
    .execute(&mut *tx)
    .await?;
    if updated.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    set_members(&mut tx, id, &i.member_ids).await?;
    tx.commit().await?;
    Ok(Json(fetch(&state, id).await?))
}

pub async fn remove(State(state): State<AppState>, user: AuthUser, Path(id): Path<Uuid>) -> AppResult<StatusCode> {
    user.require("projects.manage")?;
    sqlx::query("update public.projects set deleted_at = now() where id = $1").bind(id).execute(&state.db).await?;
    sqlx::query("update public.tasks set deleted_at = now() where project_id = $1 and deleted_at is null").bind(id).execute(&state.db).await?;
    Ok(StatusCode::NO_CONTENT)
}
