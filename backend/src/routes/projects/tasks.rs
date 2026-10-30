//! Tasks: assignments, deadlines, subtasks, comments, Kanban moves and calendar ranges.

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{Postgres, QueryBuilder};
use uuid::Uuid;

use super::PRIORITIES;
use crate::{
    audit,
    auth::AuthUser,
    error::{AppError, AppResult},
    routes::common::{like_pattern, non_empty},
    state::AppState,
    validate::{clean, Validator},
};

pub const STATUSES: &[&str] = &["todo", "in_progress", "in_review", "blocked", "done"];

#[derive(Serialize, sqlx::FromRow)]
pub struct Task {
    id: Uuid,
    project_id: Option<Uuid>,
    project_name: Option<String>,
    client_id: Option<Uuid>,
    client_name: Option<String>,
    title: String,
    description: Option<String>,
    status: String,
    priority: String,
    assignee_id: Option<Uuid>,
    assignee_name: Option<String>,
    reporter_id: Option<Uuid>,
    reporter_name: Option<String>,
    due_at: Option<DateTime<Utc>>,
    overdue: bool,
    position: f64,
    completed_at: Option<DateTime<Utc>>,
    subtasks_total: i64,
    subtasks_done: i64,
    comments: i64,
    created_at: DateTime<Utc>,
}

const SELECT: &str = "select t.id, t.project_id, p.name as project_name, coalesce(t.client_id, p.client_id) as client_id,
    co.name as client_name, t.title, nullif(t.description, 'onboarding') as description, t.status, t.priority,
    t.assignee_id, a.full_name as assignee_name, t.reporter_id, r.full_name as reporter_name, t.due_at,
    (t.status <> 'done' and coalesce(t.due_at < now(), false)) as overdue, t.position, t.completed_at,
    (select count(*) from public.subtasks s where s.task_id = t.id) as subtasks_total,
    (select count(*) from public.subtasks s where s.task_id = t.id and s.is_done) as subtasks_done,
    (select count(*) from public.comments c where c.entity_type = 'task' and c.entity_id = t.id and c.deleted_at is null) as comments,
    t.created_at
  from public.tasks t
  left join public.projects p on p.id = t.project_id
  left join public.clients cl on cl.id = coalesce(t.client_id, p.client_id)
  left join public.companies co on co.id = cl.company_id
  left join public.profiles a on a.id = t.assignee_id
  left join public.profiles r on r.id = t.reporter_id";

#[derive(Deserialize, Default)]
pub struct TaskQuery {
    project_id: Option<Uuid>,
    client_id: Option<Uuid>,
    /// `me`, `unassigned` or a member id.
    assignee: Option<String>,
    /// A status, `open` (not done) or empty for all.
    status: Option<String>,
    due_from: Option<DateTime<Utc>>,
    due_to: Option<DateTime<Utc>>,
    search: Option<String>,
}

pub async fn list(State(state): State<AppState>, user: AuthUser, Query(q): Query<TaskQuery>) -> AppResult<Json<Vec<Task>>> {
    user.require("projects.view")?;
    let mut qb = QueryBuilder::<Postgres>::new(format!("{SELECT} where t.deleted_at is null and (p.id is null or p.deleted_at is null)"));
    if let Some(v) = q.project_id {
        qb.push(" and t.project_id = ").push_bind(v);
    }
    if let Some(v) = q.client_id {
        qb.push(" and coalesce(t.client_id, p.client_id) = ").push_bind(v);
    }
    match non_empty(&q.assignee) {
        Some("me") => {
            qb.push(" and t.assignee_id = ").push_bind(user.id);
        }
        Some("unassigned") => {
            qb.push(" and t.assignee_id is null");
        }
        Some(id) => {
            if let Ok(id) = id.parse::<Uuid>() {
                qb.push(" and t.assignee_id = ").push_bind(id);
            }
        }
        None => {}
    }
    match non_empty(&q.status) {
        Some("open") => {
            qb.push(" and t.status <> 'done'");
        }
        Some(s) => {
            qb.push(" and t.status = ").push_bind(s.to_owned());
        }
        None => {}
    }
    if let Some(v) = q.due_from {
        qb.push(" and t.due_at >= ").push_bind(v);
    }
    if let Some(v) = q.due_to {
        qb.push(" and t.due_at < ").push_bind(v);
    }
    if let Some(term) = non_empty(&q.search) {
        let pat = like_pattern(term);
        qb.push(" and (t.title ilike ").push_bind(pat.clone()).push(" or p.name ilike ").push_bind(pat).push(")");
    }
    qb.push(" order by case when t.status = 'done' then 1 else 0 end, t.position, t.due_at nulls last, t.created_at limit 1000");
    Ok(Json(qb.build_query_as::<Task>().fetch_all(&state.db).await?))
}

async fn fetch(state: &AppState, id: Uuid) -> AppResult<Task> {
    sqlx::query_as::<_, Task>(&format!("{SELECT} where t.id = $1 and t.deleted_at is null"))
        .bind(id)
        .fetch_optional(&state.db)
        .await?
        .ok_or(AppError::NotFound)
}

#[derive(Serialize, sqlx::FromRow)]
pub struct Subtask {
    id: Uuid,
    title: String,
    is_done: bool,
    position: i32,
}

#[derive(Serialize, sqlx::FromRow)]
pub struct Comment {
    id: Uuid,
    body: String,
    author_id: Option<Uuid>,
    author_name: Option<String>,
    created_at: DateTime<Utc>,
}

#[derive(Serialize)]
pub struct TaskDetail {
    #[serde(flatten)]
    task: Task,
    subtasks: Vec<Subtask>,
    comment_list: Vec<Comment>,
}

async fn detail(state: &AppState, id: Uuid) -> AppResult<TaskDetail> {
    let (task, subtasks, comment_list) = tokio::try_join!(
        fetch(state, id),
        async {
            Ok::<_, AppError>(
                sqlx::query_as::<_, Subtask>("select id, title, is_done, position from public.subtasks where task_id = $1 order by position, created_at")
                    .bind(id)
                    .fetch_all(&state.db)
                    .await?,
            )
        },
        async {
            Ok::<_, AppError>(
                sqlx::query_as::<_, Comment>(
                    "select c.id, c.body, c.author_id, p.full_name as author_name, c.created_at from public.comments c
                     left join public.profiles p on p.id = c.author_id
                     where c.entity_type = 'task' and c.entity_id = $1 and c.deleted_at is null order by c.created_at",
                )
                .bind(id)
                .fetch_all(&state.db)
                .await?,
            )
        },
    )?;
    Ok(TaskDetail { task, subtasks, comment_list })
}

pub async fn get(State(state): State<AppState>, user: AuthUser, Path(id): Path<Uuid>) -> AppResult<Json<TaskDetail>> {
    user.require("projects.view")?;
    Ok(Json(detail(&state, id).await?))
}

/// Managers can edit any task; everyone else edits tasks assigned to or created by them.
async fn ensure_editable(state: &AppState, user: &AuthUser, id: Uuid) -> AppResult<(Option<Uuid>, String)> {
    let (assignee, reporter, title): (Option<Uuid>, Option<Uuid>, String) =
        sqlx::query_as("select assignee_id, reporter_id, title from public.tasks where id = $1 and deleted_at is null")
            .bind(id)
            .fetch_optional(&state.db)
            .await?
            .ok_or(AppError::NotFound)?;
    if user.can("projects.manage") || assignee == Some(user.id) || reporter == Some(user.id) {
        Ok((assignee, title))
    } else {
        Err(AppError::forbidden("Only the assignee, the creator or a project manager can change this task."))
    }
}

#[derive(Deserialize)]
pub struct TaskInput {
    project_id: Option<Uuid>,
    client_id: Option<Uuid>,
    title: String,
    description: Option<String>,
    status: Option<String>,
    priority: Option<String>,
    assignee_id: Option<Uuid>,
    due_at: Option<DateTime<Utc>>,
}

fn validate(i: &TaskInput) -> AppResult<()> {
    let mut v = Validator::new();
    v.text("title", &i.title, 300);
    v.optional_text("description", i.description.as_deref(), 20_000);
    if let Some(s) = &i.status {
        v.one_of("status", s, STATUSES);
    }
    if let Some(p) = &i.priority {
        v.one_of("priority", p, PRIORITIES);
    }
    v.finish()
}

async fn notify_assignee(state: &AppState, user: &AuthUser, assignee: Option<Uuid>, task_id: Uuid, title: &str) -> AppResult<()> {
    if let Some(a) = assignee.filter(|a| *a != user.id) {
        sqlx::query(
            "insert into public.notifications (user_id, kind, title, body, entity_type, entity_id)
             values ($1, 'task_assigned', $2, $3, 'task', $4)",
        )
        .bind(a)
        .bind(format!("{} assigned you a task", user.full_name))
        .bind(title)
        .bind(task_id)
        .execute(&state.db)
        .await?;
    }
    Ok(())
}

pub async fn create(State(state): State<AppState>, user: AuthUser, Json(i): Json<TaskInput>) -> AppResult<Json<TaskDetail>> {
    user.require("projects.view")?;
    validate(&i)?;
    if i.assignee_id.is_some_and(|a| a != user.id) && !user.can("projects.manage") {
        return Err(AppError::forbidden("Only project managers can assign tasks to others."));
    }
    let id: Uuid = sqlx::query_scalar(
        "insert into public.tasks (project_id, client_id, title, description, status, priority, assignee_id, reporter_id, due_at, position)
         values ($1, $2, $3, $4, coalesce($5,'todo'), coalesce($6,'medium'), $7, $8, $9,
                 coalesce((select max(position) + 1 from public.tasks where project_id is not distinct from $1 and deleted_at is null), 1))
         returning id",
    )
    .bind(i.project_id).bind(i.client_id).bind(i.title.trim()).bind(clean(i.description.clone()))
    .bind(&i.status).bind(&i.priority).bind(i.assignee_id).bind(user.id).bind(i.due_at)
    .fetch_one(&state.db)
    .await?;
    notify_assignee(&state, &user, i.assignee_id, id, i.title.trim()).await?;
    Ok(Json(detail(&state, id).await?))
}

pub async fn update(State(state): State<AppState>, user: AuthUser, Path(id): Path<Uuid>, Json(i): Json<TaskInput>) -> AppResult<Json<TaskDetail>> {
    user.require("projects.view")?;
    validate(&i)?;
    let (before_assignee, _) = ensure_editable(&state, &user, id).await?;
    if i.assignee_id != before_assignee && i.assignee_id.is_some_and(|a| a != user.id) && !user.can("projects.manage") {
        return Err(AppError::forbidden("Only project managers can assign tasks to others."));
    }
    sqlx::query(
        "update public.tasks set project_id=$2, client_id=$3, title=$4,
           description = case when description = 'onboarding' then description else $5 end,
           status=coalesce($6,status), priority=coalesce($7,priority), assignee_id=$8, due_at=$9,
           completed_at = case when coalesce($6,status) = 'done' then coalesce(completed_at, now()) else null end
         where id = $1",
    )
    .bind(id).bind(i.project_id).bind(i.client_id).bind(i.title.trim()).bind(clean(i.description.clone()))
    .bind(&i.status).bind(&i.priority).bind(i.assignee_id).bind(i.due_at)
    .execute(&state.db)
    .await?;
    if i.assignee_id != before_assignee {
        notify_assignee(&state, &user, i.assignee_id, id, i.title.trim()).await?;
    }
    Ok(Json(detail(&state, id).await?))
}

#[derive(Deserialize)]
pub struct MoveTask {
    status: String,
    /// Position among the destination column's tasks (any float; lower = higher up).
    position: Option<f64>,
}

/// Kanban drag and drop.
pub async fn move_task(State(state): State<AppState>, user: AuthUser, Path(id): Path<Uuid>, Json(m): Json<MoveTask>) -> AppResult<Json<TaskDetail>> {
    user.require("projects.view")?;
    let mut v = Validator::new();
    v.one_of("status", &m.status, STATUSES);
    v.finish()?;
    let (_, title) = ensure_editable(&state, &user, id).await?;
    sqlx::query(
        "update public.tasks set status = $2, position = coalesce($3, position),
           completed_at = case when $2 = 'done' then coalesce(completed_at, now()) else null end
         where id = $1",
    )
    .bind(id).bind(&m.status).bind(m.position)
    .execute(&state.db)
    .await?;
    if m.status == "done" {
        audit::activity(&state.db, user.id, "task", id, "task.completed", &format!("{} completed {title}", user.full_name)).await?;
    }
    Ok(Json(detail(&state, id).await?))
}

pub async fn remove(State(state): State<AppState>, user: AuthUser, Path(id): Path<Uuid>) -> AppResult<StatusCode> {
    user.require("projects.view")?;
    ensure_editable(&state, &user, id).await?;
    sqlx::query("update public.tasks set deleted_at = now() where id = $1").bind(id).execute(&state.db).await?;
    Ok(StatusCode::NO_CONTENT)
}

// ---- Subtasks ----------------------------------------------------------------

#[derive(Deserialize)]
pub struct SubtaskInput {
    title: Option<String>,
    is_done: Option<bool>,
}

pub async fn add_subtask(State(state): State<AppState>, user: AuthUser, Path(id): Path<Uuid>, Json(s): Json<SubtaskInput>) -> AppResult<Json<TaskDetail>> {
    user.require("projects.view")?;
    ensure_editable(&state, &user, id).await?;
    let title = clean(s.title).ok_or_else(|| AppError::BadRequest("Name the subtask.".into()))?;
    sqlx::query(
        "insert into public.subtasks (task_id, title, position)
         values ($1, $2, coalesce((select max(position) + 1 from public.subtasks where task_id = $1), 0))",
    )
    .bind(id).bind(title.chars().take(300).collect::<String>())
    .execute(&state.db)
    .await?;
    Ok(Json(detail(&state, id).await?))
}

pub async fn update_subtask(State(state): State<AppState>, user: AuthUser, Path((id, sub)): Path<(Uuid, Uuid)>, Json(s): Json<SubtaskInput>) -> AppResult<Json<TaskDetail>> {
    user.require("projects.view")?;
    ensure_editable(&state, &user, id).await?;
    sqlx::query(
        "update public.subtasks set title = coalesce($3, title), is_done = coalesce($4, is_done),
           completed_at = case when coalesce($4, is_done) then coalesce(completed_at, now()) else null end
         where id = $2 and task_id = $1",
    )
    .bind(id).bind(sub).bind(clean(s.title)).bind(s.is_done)
    .execute(&state.db)
    .await?;
    Ok(Json(detail(&state, id).await?))
}

pub async fn remove_subtask(State(state): State<AppState>, user: AuthUser, Path((id, sub)): Path<(Uuid, Uuid)>) -> AppResult<Json<TaskDetail>> {
    user.require("projects.view")?;
    ensure_editable(&state, &user, id).await?;
    sqlx::query("delete from public.subtasks where id = $2 and task_id = $1").bind(id).bind(sub).execute(&state.db).await?;
    Ok(Json(detail(&state, id).await?))
}

// ---- Comments ----------------------------------------------------------------

#[derive(Deserialize)]
pub struct CommentInput {
    body: String,
}

/// Anyone who can see the task can comment; the assignee is notified.
pub async fn add_comment(State(state): State<AppState>, user: AuthUser, Path(id): Path<Uuid>, Json(c): Json<CommentInput>) -> AppResult<Json<TaskDetail>> {
    user.require("projects.view")?;
    let mut v = Validator::new();
    v.text("body", &c.body, 10_000);
    v.finish()?;
    let (assignee, title): (Option<Uuid>, String) = sqlx::query_as("select assignee_id, title from public.tasks where id = $1 and deleted_at is null")
        .bind(id)
        .fetch_optional(&state.db)
        .await?
        .ok_or(AppError::NotFound)?;
    sqlx::query("insert into public.comments (entity_type, entity_id, author_id, body) values ('task', $1, $2, $3)")
        .bind(id).bind(user.id).bind(c.body.trim())
        .execute(&state.db)
        .await?;
    if let Some(a) = assignee.filter(|a| *a != user.id) {
        sqlx::query(
            "insert into public.notifications (user_id, kind, title, body, entity_type, entity_id)
             values ($1, 'task_comment', $2, $3, 'task', $4)",
        )
        .bind(a)
        .bind(format!("{} commented on {title}", user.full_name))
        .bind(c.body.trim().chars().take(200).collect::<String>())
        .bind(id)
        .execute(&state.db)
        .await?;
    }
    Ok(Json(detail(&state, id).await?))
}

pub async fn remove_comment(State(state): State<AppState>, user: AuthUser, Path((id, comment)): Path<(Uuid, Uuid)>) -> AppResult<Json<TaskDetail>> {
    user.require("projects.view")?;
    let deleted = sqlx::query(
        "update public.comments set deleted_at = now() where id = $2 and entity_type = 'task' and entity_id = $1
           and (author_id = $3 or $4)",
    )
    .bind(id).bind(comment).bind(user.id).bind(user.can("projects.manage"))
    .execute(&state.db)
    .await?;
    if deleted.rows_affected() == 0 {
        return Err(AppError::forbidden("You can only delete your own comments."));
    }
    Ok(Json(detail(&state, id).await?))
}
