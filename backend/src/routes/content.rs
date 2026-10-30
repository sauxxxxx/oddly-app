//! Content studio: posts through a customizable workflow, internal approvals with history,
//! and a client-organized media library.

use std::collections::HashMap;

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::{Postgres, QueryBuilder};
use uuid::Uuid;

use super::common::{like_pattern, non_empty};
use crate::{
    audit::{self, AuditEntry},
    auth::AuthUser,
    error::{AppError, AppResult},
    state::AppState,
    validate::{clean, Validator},
};

pub const PLATFORMS: &[&str] = &["facebook", "instagram", "tiktok", "linkedin", "x", "youtube", "google_business", "website", "other"];
pub const TYPES: &[&str] = &["image", "carousel", "video", "reel", "story", "text", "article", "other"];
pub const ASSET_TYPES: &[&str] = &["graphic", "video", "logo", "brand_guideline", "font", "image", "marketing_material", "other"];

#[derive(Serialize, sqlx::FromRow)]
pub struct Post {
    id: Uuid,
    client_id: Uuid,
    client_name: String,
    title: String,
    platform: String,
    content_type: String,
    category: Option<String>,
    campaign: Option<String>,
    caption: Option<String>,
    hashtags: Vec<String>,
    stage_id: Uuid,
    stage_key: String,
    stage_name: String,
    stage_color: String,
    designer_id: Option<Uuid>,
    designer_name: Option<String>,
    creator_id: Option<Uuid>,
    creator_name: Option<String>,
    due_at: Option<DateTime<Utc>>,
    publish_at: Option<DateTime<Utc>>,
    published_at: Option<DateTime<Utc>>,
    published_url: Option<String>,
    assets: i64,
    last_feedback: Option<String>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

const SELECT: &str = "select cp.id, cp.client_id, co.name as client_name, cp.title, cp.platform, cp.content_type, cp.category,
    cp.campaign, cp.caption, cp.hashtags, cp.stage_id, s.key as stage_key, s.name as stage_name, s.color as stage_color,
    cp.designer_id, d.full_name as designer_name, cp.creator_id, c.full_name as creator_name, cp.due_at, cp.publish_at,
    cp.published_at, cp.published_url,
    (select count(*) from public.content_assets a where a.post_id = cp.id and a.deleted_at is null) as assets,
    (select ap.feedback from public.content_approvals ap where ap.post_id = cp.id order by ap.created_at desc limit 1) as last_feedback,
    cp.created_at, cp.updated_at
  from public.content_posts cp
  join public.content_workflow_stages s on s.id = cp.stage_id
  join public.clients cl on cl.id = cp.client_id
  join public.companies co on co.id = cl.company_id
  left join public.profiles d on d.id = cp.designer_id
  left join public.profiles c on c.id = cp.creator_id";

#[derive(Deserialize, Default)]
pub struct PostQuery {
    client_id: Option<Uuid>,
    stage_id: Option<Uuid>,
    /// Comma-separated stage keys, e.g. `internal_review,client_approval`.
    stage_keys: Option<String>,
    platform: Option<String>,
    from: Option<DateTime<Utc>>,
    to: Option<DateTime<Utc>>,
    /// `me` = I'm the designer or creator.
    assignee: Option<String>,
    search: Option<String>,
    /// Only posts with a caption.
    with_caption: Option<bool>,
}

pub async fn list(State(state): State<AppState>, user: AuthUser, Query(q): Query<PostQuery>) -> AppResult<Json<Vec<Post>>> {
    user.require("content.view")?;
    let mut qb = QueryBuilder::<Postgres>::new(format!("{SELECT} where cp.deleted_at is null and cl.deleted_at is null"));
    if let Some(v) = q.client_id {
        qb.push(" and cp.client_id = ").push_bind(v);
    }
    if let Some(v) = q.stage_id {
        qb.push(" and cp.stage_id = ").push_bind(v);
    }
    if let Some(keys) = non_empty(&q.stage_keys) {
        let keys: Vec<String> = keys.split(',').map(|k| k.trim().to_owned()).collect();
        qb.push(" and s.key = any(").push_bind(keys).push(")");
    }
    if let Some(v) = non_empty(&q.platform) {
        qb.push(" and cp.platform = ").push_bind(v.to_owned());
    }
    if let Some(v) = q.from {
        qb.push(" and coalesce(cp.publish_at, cp.due_at) >= ").push_bind(v);
    }
    if let Some(v) = q.to {
        qb.push(" and coalesce(cp.publish_at, cp.due_at) < ").push_bind(v);
    }
    if non_empty(&q.assignee) == Some("me") {
        qb.push(" and (cp.designer_id = ").push_bind(user.id).push(" or cp.creator_id = ").push_bind(user.id).push(")");
    }
    if let Some(t) = non_empty(&q.search) {
        let p = like_pattern(t);
        qb.push(" and (cp.title ilike ").push_bind(p.clone()).push(" or cp.caption ilike ").push_bind(p.clone())
            .push(" or co.name ilike ").push_bind(p.clone()).push(" or cp.campaign ilike ").push_bind(p).push(")");
    }
    if q.with_caption == Some(true) {
        qb.push(" and coalesce(cp.caption, '') <> ''");
    }
    qb.push(" order by coalesce(cp.publish_at, cp.due_at, cp.created_at) limit 1000");
    Ok(Json(qb.build_query_as::<Post>().fetch_all(&state.db).await?))
}

#[derive(Serialize, sqlx::FromRow)]
pub struct Approval {
    id: Uuid,
    decision: String,
    feedback: Option<String>,
    reviewer_type: String,
    reviewer_name: Option<String>,
    revision: i32,
    created_at: DateTime<Utc>,
}

#[derive(Serialize)]
pub struct PostDetail {
    #[serde(flatten)]
    post: Post,
    approvals: Vec<Approval>,
    asset_list: Vec<Asset>,
}

async fn fetch(state: &AppState, id: Uuid) -> AppResult<Post> {
    sqlx::query_as::<_, Post>(&format!("{SELECT} where cp.id = $1 and cp.deleted_at is null"))
        .bind(id)
        .fetch_optional(&state.db)
        .await?
        .ok_or(AppError::NotFound)
}

async fn detail(state: &AppState, id: Uuid) -> AppResult<PostDetail> {
    let post = fetch(state, id).await?;
    let approvals = sqlx::query_as::<_, Approval>(
        "select a.id, a.decision, a.feedback, a.reviewer_type, coalesce(p.full_name, a.reviewer_name) as reviewer_name, a.revision, a.created_at
         from public.content_approvals a left join public.profiles p on p.id = a.reviewer_id
         where a.post_id = $1 order by a.created_at desc",
    )
    .bind(id)
    .fetch_all(&state.db)
    .await?;
    let asset_list = assets_where(state, AssetQuery { post_id: Some(id), ..Default::default() }).await?;
    Ok(PostDetail { post, approvals, asset_list })
}

pub async fn get(State(state): State<AppState>, user: AuthUser, Path(id): Path<Uuid>) -> AppResult<Json<PostDetail>> {
    user.require("content.view")?;
    Ok(Json(detail(&state, id).await?))
}

#[derive(Deserialize)]
pub struct PostInput {
    client_id: Uuid,
    title: String,
    platform: String,
    content_type: String,
    category: Option<String>,
    campaign: Option<String>,
    caption: Option<String>,
    #[serde(default)]
    hashtags: Vec<String>,
    stage_id: Option<Uuid>,
    designer_id: Option<Uuid>,
    creator_id: Option<Uuid>,
    due_at: Option<DateTime<Utc>>,
    publish_at: Option<DateTime<Utc>>,
    published_url: Option<String>,
}

fn validate(i: &PostInput) -> AppResult<()> {
    let mut v = Validator::new();
    v.text("title", &i.title, 200);
    v.one_of("platform", &i.platform, PLATFORMS);
    v.one_of("content_type", &i.content_type, TYPES);
    v.optional_text("category", i.category.as_deref(), 80);
    v.optional_text("campaign", i.campaign.as_deref(), 120);
    v.optional_text("caption", i.caption.as_deref(), 5000);
    v.optional_text("published_url", i.published_url.as_deref(), 1000);
    if i.hashtags.len() > 60 {
        v.fail("hashtags", "Up to 60 hashtags.");
    }
    v.finish()
}

fn clean_tags(tags: &[String]) -> Vec<String> {
    tags.iter()
        .map(|t| t.trim().trim_start_matches('#').replace(' ', ""))
        .filter(|t| !t.is_empty())
        .map(|t| format!("#{t}"))
        .collect()
}

pub async fn create(State(state): State<AppState>, user: AuthUser, Json(i): Json<PostInput>) -> AppResult<Json<PostDetail>> {
    user.require("content.manage")?;
    validate(&i)?;
    let id: Uuid = sqlx::query_scalar(
        "insert into public.content_posts (client_id, title, platform, content_type, category, campaign, caption, hashtags, stage_id,
           designer_id, creator_id, due_at, publish_at, published_url, created_by)
         select $1,$2,$3,$4,$5,$6,$7,$8,
           coalesce($9, (select id from public.content_workflow_stages where archived_at is null order by position limit 1)),
           $10, coalesce($11, $15), $12, $13, $14, $15
         from public.clients where id = $1 and deleted_at is null
         returning id",
    )
    .bind(i.client_id).bind(i.title.trim()).bind(&i.platform).bind(&i.content_type).bind(clean(i.category.clone()))
    .bind(clean(i.campaign.clone())).bind(clean(i.caption.clone())).bind(clean_tags(&i.hashtags)).bind(i.stage_id)
    .bind(i.designer_id).bind(i.creator_id).bind(i.due_at).bind(i.publish_at).bind(clean(i.published_url.clone())).bind(user.id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::BadRequest("Choose a client.".into()))?;
    if let Some(d) = i.designer_id.filter(|d| *d != user.id) {
        notify(&state, d, "content_assigned", &format!("{} assigned you a design", user.full_name), i.title.trim(), id).await?;
    }
    Ok(Json(detail(&state, id).await?))
}

pub async fn update(State(state): State<AppState>, user: AuthUser, Path(id): Path<Uuid>, Json(i): Json<PostInput>) -> AppResult<Json<PostDetail>> {
    user.require("content.manage")?;
    validate(&i)?;
    let before = fetch(&state, id).await?;
    sqlx::query(
        "update public.content_posts set client_id=$2, title=$3, platform=$4, content_type=$5, category=$6, campaign=$7,
           caption=$8, hashtags=$9, stage_id=coalesce($10, stage_id), designer_id=$11, creator_id=$12, due_at=$13,
           publish_at=$14, published_url=$15
         where id = $1",
    )
    .bind(id).bind(i.client_id).bind(i.title.trim()).bind(&i.platform).bind(&i.content_type).bind(clean(i.category.clone()))
    .bind(clean(i.campaign.clone())).bind(clean(i.caption.clone())).bind(clean_tags(&i.hashtags)).bind(i.stage_id)
    .bind(i.designer_id).bind(i.creator_id).bind(i.due_at).bind(i.publish_at).bind(clean(i.published_url.clone()))
    .execute(&state.db)
    .await?;
    if let Some(stage) = i.stage_id.filter(|s| *s != before.stage_id) {
        apply_stage_effects(&state, id, stage).await?;
    }
    if let Some(d) = i.designer_id.filter(|d| Some(*d) != before.designer_id && *d != user.id) {
        notify(&state, d, "content_assigned", &format!("{} assigned you a design", user.full_name), i.title.trim(), id).await?;
    }
    Ok(Json(detail(&state, id).await?))
}

/// Publishing stamps published_at; leaving it clears it.
async fn apply_stage_effects(state: &AppState, id: Uuid, stage: Uuid) -> AppResult<()> {
    sqlx::query(
        "update public.content_posts cp set
           published_at = case when s.key = 'published' then coalesce(cp.published_at, now()) else null end
         from public.content_workflow_stages s where cp.id = $1 and s.id = $2",
    )
    .bind(id)
    .bind(stage)
    .execute(&state.db)
    .await?;
    Ok(())
}

#[derive(Deserialize)]
pub struct MoveStage {
    stage_id: Uuid,
}

pub async fn move_stage(State(state): State<AppState>, user: AuthUser, Path(id): Path<Uuid>, Json(m): Json<MoveStage>) -> AppResult<Json<PostDetail>> {
    user.require("content.manage")?;
    let key: String = sqlx::query_scalar("select key from public.content_workflow_stages where id = $1 and archived_at is null")
        .bind(m.stage_id)
        .fetch_optional(&state.db)
        .await?
        .ok_or(AppError::NotFound)?;
    // Approving is a decision, not a drag: only approvers can move posts to Approved.
    if key == "approved" && !user.can("content.approve") {
        return Err(AppError::forbidden("Only approvers can approve content. Send it for review instead."));
    }
    let updated = sqlx::query("update public.content_posts set stage_id = $2 where id = $1 and deleted_at is null")
        .bind(id).bind(m.stage_id).execute(&state.db).await?;
    if updated.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    apply_stage_effects(&state, id, m.stage_id).await?;
    Ok(Json(detail(&state, id).await?))
}

#[derive(Deserialize)]
pub struct Review {
    decision: String,
    feedback: Option<String>,
}

/// Records an approval decision and moves the post: approved -> Approved,
/// otherwise -> Revision Required. Creator and designer are notified.
pub async fn review(State(state): State<AppState>, user: AuthUser, Path(id): Path<Uuid>, Json(r): Json<Review>) -> AppResult<Json<PostDetail>> {
    user.require("content.approve")?;
    let mut v = Validator::new();
    v.one_of("decision", &r.decision, &["approved", "changes_requested", "rejected"]);
    v.optional_text("feedback", r.feedback.as_deref(), 5000);
    if r.decision != "approved" && r.feedback.as_deref().unwrap_or("").trim().is_empty() {
        v.fail("feedback", "Say what needs to change.");
    }
    v.finish()?;
    let post = fetch(&state, id).await?;
    let target = if r.decision == "approved" { "approved" } else { "revision_required" };
    let mut tx = state.db.begin().await?;
    sqlx::query(
        "insert into public.content_approvals (post_id, reviewer_id, reviewer_type, decision, feedback, revision)
         values ($1, $2, 'internal', $3, $4, (select count(*) + 1 from public.content_approvals where post_id = $1))",
    )
    .bind(id).bind(user.id).bind(&r.decision).bind(clean(r.feedback.clone()))
    .execute(&mut *tx)
    .await?;
    sqlx::query("update public.content_posts set stage_id = (select id from public.content_workflow_stages where key = $2) where id = $1")
        .bind(id).bind(target).execute(&mut *tx).await?;
    tx.commit().await?;
    let verb = if r.decision == "approved" { "approved" } else { "requested changes on" };
    for person in [post.creator_id, post.designer_id].into_iter().flatten().filter(|p| *p != user.id) {
        notify(&state, person, "content_review", &format!("{} {verb} {}", user.full_name, post.title), r.feedback.as_deref().unwrap_or(""), id).await?;
    }
    Ok(Json(detail(&state, id).await?))
}

pub async fn remove(State(state): State<AppState>, user: AuthUser, Path(id): Path<Uuid>) -> AppResult<StatusCode> {
    user.require("content.manage")?;
    sqlx::query("update public.content_posts set deleted_at = now() where id = $1").bind(id).execute(&state.db).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn notify(state: &AppState, user_id: Uuid, kind: &str, title: &str, body: &str, post_id: Uuid) -> AppResult<()> {
    sqlx::query(
        "insert into public.notifications (user_id, kind, title, body, entity_type, entity_id) values ($1, $2, $3, nullif($4, ''), 'content_post', $5)",
    )
    .bind(user_id).bind(kind).bind(title).bind(body.chars().take(300).collect::<String>()).bind(post_id)
    .execute(&state.db)
    .await?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Workflow stages (customizable)
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct StageInput {
    name: String,
    color: Option<String>,
}

fn check_stage(i: &StageInput) -> AppResult<()> {
    let mut v = Validator::new();
    v.text("name", &i.name, 40);
    if let Some(c) = &i.color {
        if !(c.len() == 7 && c.starts_with('#') && c[1..].chars().all(|ch| ch.is_ascii_hexdigit())) {
            v.fail("color", "Use a hex color like #A855F7.");
        }
    }
    v.finish()
}

pub async fn create_stage(State(state): State<AppState>, user: AuthUser, Json(i): Json<StageInput>) -> AppResult<StatusCode> {
    user.require("settings.manage")?;
    check_stage(&i)?;
    sqlx::query(
        "insert into public.content_workflow_stages (key, name, color, position)
         values ('custom_' || substr(md5(random()::text), 1, 8), $1, coalesce($2, '#A855F7'),
                 (select coalesce(max(position), 0) + 10 from public.content_workflow_stages))",
    )
    .bind(i.name.trim()).bind(&i.color)
    .execute(&state.db)
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn update_stage(State(state): State<AppState>, user: AuthUser, Path(id): Path<Uuid>, Json(i): Json<StageInput>) -> AppResult<StatusCode> {
    user.require("settings.manage")?;
    check_stage(&i)?;
    sqlx::query("update public.content_workflow_stages set name = $2, color = coalesce($3, color) where id = $1")
        .bind(id).bind(i.name.trim()).bind(&i.color).execute(&state.db).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
pub struct Reorder {
    ids: Vec<Uuid>,
}

pub async fn reorder_stages(State(state): State<AppState>, user: AuthUser, Json(r): Json<Reorder>) -> AppResult<StatusCode> {
    user.require("settings.manage")?;
    sqlx::query("update public.content_workflow_stages s set position = t.ord * 10 from unnest($1::uuid[]) with ordinality as t(id, ord) where s.id = t.id")
        .bind(&r.ids).execute(&state.db).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
pub struct RemoveStage {
    move_to: Uuid,
}

/// Custom stages can be removed (posts move elsewhere); built-in ones drive approvals and publishing.
pub async fn remove_stage(State(state): State<AppState>, user: AuthUser, Path(id): Path<Uuid>, Query(q): Query<RemoveStage>) -> AppResult<StatusCode> {
    user.require("settings.manage")?;
    let key: String = sqlx::query_scalar("select key from public.content_workflow_stages where id = $1").bind(id).fetch_optional(&state.db).await?.ok_or(AppError::NotFound)?;
    if !key.starts_with("custom_") {
        return Err(AppError::BadRequest("Built-in stages can be renamed but not removed.".into()));
    }
    let mut tx = state.db.begin().await?;
    sqlx::query("update public.content_posts set stage_id = $2 where stage_id = $1").bind(id).bind(q.move_to).execute(&mut *tx).await?;
    sqlx::query("update public.content_workflow_stages set archived_at = now() where id = $1").bind(id).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------------------
// Media library
// ---------------------------------------------------------------------------

#[derive(Serialize, sqlx::FromRow)]
pub struct Asset {
    id: Uuid,
    client_id: Uuid,
    client_name: String,
    post_id: Option<Uuid>,
    file_id: Uuid,
    asset_type: String,
    title: Option<String>,
    tags: Vec<String>,
    original_name: String,
    content_type: String,
    size_bytes: i64,
    uploaded_by_name: Option<String>,
    created_at: DateTime<Utc>,
    #[sqlx(skip)]
    preview_url: Option<String>,
    #[serde(skip)]
    storage_path: String,
}

#[derive(Deserialize, Default)]
pub struct AssetQuery {
    client_id: Option<Uuid>,
    post_id: Option<Uuid>,
    asset_type: Option<String>,
    search: Option<String>,
}

async fn assets_where(state: &AppState, q: AssetQuery) -> AppResult<Vec<Asset>> {
    let mut qb = QueryBuilder::<Postgres>::new(
        "select a.id, a.client_id, co.name as client_name, a.post_id, a.file_id, a.asset_type, a.title, a.tags,
                f.original_name, f.content_type, f.size_bytes, p.full_name as uploaded_by_name, a.created_at,
                f.storage_path
         from public.content_assets a
         join public.files f on f.id = a.file_id and f.deleted_at is null
         join public.clients cl on cl.id = a.client_id
         join public.companies co on co.id = cl.company_id
         left join public.profiles p on p.id = a.uploaded_by
         where a.deleted_at is null",
    );
    if let Some(v) = q.client_id {
        qb.push(" and a.client_id = ").push_bind(v);
    }
    if let Some(v) = q.post_id {
        qb.push(" and a.post_id = ").push_bind(v);
    }
    if let Some(v) = non_empty(&q.asset_type) {
        qb.push(" and a.asset_type = ").push_bind(v.to_owned());
    }
    if let Some(t) = non_empty(&q.search) {
        let p = like_pattern(t);
        qb.push(" and (a.title ilike ").push_bind(p.clone()).push(" or f.original_name ilike ").push_bind(p.clone())
            .push(" or array_to_string(a.tags, ' ') ilike ").push_bind(p).push(")");
    }
    qb.push(" order by a.created_at desc limit 300");
    let mut assets = qb.build_query_as::<Asset>().fetch_all(&state.db).await?;

    // One batch request signs previews for every image and video on the page.
    let previewable: Vec<String> = assets
        .iter()
        .filter(|a| a.content_type.starts_with("image/") || a.content_type.starts_with("video/"))
        .map(|a| a.storage_path.clone())
        .collect();
    if !previewable.is_empty() {
        let urls: HashMap<String, String> = state.storage.signed_urls("media", &previewable, 3600).await?;
        for a in &mut assets {
            a.preview_url = urls.get(&a.storage_path).cloned();
        }
    }
    Ok(assets)
}

pub async fn assets(State(state): State<AppState>, user: AuthUser, Query(q): Query<AssetQuery>) -> AppResult<Json<Vec<Asset>>> {
    user.require("content.view")?;
    Ok(Json(assets_where(&state, q).await?))
}

#[derive(Deserialize)]
pub struct AssetInput {
    client_id: Uuid,
    file_id: Uuid,
    post_id: Option<Uuid>,
    asset_type: String,
    title: Option<String>,
    #[serde(default)]
    tags: Vec<String>,
}

pub async fn add_asset(State(state): State<AppState>, user: AuthUser, Json(i): Json<AssetInput>) -> AppResult<StatusCode> {
    user.require("content.manage")?;
    let mut v = Validator::new();
    v.one_of("asset_type", &i.asset_type, ASSET_TYPES);
    v.optional_text("title", i.title.as_deref(), 200);
    v.finish()?;
    // The file must have been uploaded for this client's media library.
    let ok: bool = sqlx::query_scalar(
        "select exists (select 1 from public.files where id = $1 and entity_type = 'client' and entity_id = $2 and bucket = 'media' and deleted_at is null)",
    )
    .bind(i.file_id).bind(i.client_id).fetch_one(&state.db).await?;
    if !ok {
        return Err(AppError::BadRequest("That file isn't in this client's media library.".into()));
    }
    let tags: Vec<String> = i.tags.iter().map(|t| t.trim().to_owned()).filter(|t| !t.is_empty()).take(30).collect();
    sqlx::query(
        "insert into public.content_assets (client_id, post_id, file_id, asset_type, title, tags, uploaded_by) values ($1,$2,$3,$4,$5,$6,$7)",
    )
    .bind(i.client_id).bind(i.post_id).bind(i.file_id).bind(&i.asset_type).bind(clean(i.title.clone())).bind(&tags).bind(user.id)
    .execute(&state.db)
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
pub struct AssetUpdate {
    post_id: Option<Uuid>,
    asset_type: String,
    title: Option<String>,
    #[serde(default)]
    tags: Vec<String>,
}

pub async fn update_asset(State(state): State<AppState>, user: AuthUser, Path(id): Path<Uuid>, Json(i): Json<AssetUpdate>) -> AppResult<StatusCode> {
    user.require("content.manage")?;
    let mut v = Validator::new();
    v.one_of("asset_type", &i.asset_type, ASSET_TYPES);
    v.finish()?;
    sqlx::query("update public.content_assets set post_id = $2, asset_type = $3, title = $4, tags = $5 where id = $1")
        .bind(id).bind(i.post_id).bind(&i.asset_type).bind(clean(i.title.clone()))
        .bind(i.tags.iter().map(|t| t.trim().to_owned()).filter(|t| !t.is_empty()).collect::<Vec<_>>())
        .execute(&state.db)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn remove_asset(State(state): State<AppState>, user: AuthUser, Path(id): Path<Uuid>) -> AppResult<StatusCode> {
    user.require("content.manage")?;
    let row: Option<(Uuid, String, String)> = sqlx::query_as(
        "update public.content_assets a set deleted_at = now() from public.files f
         where a.id = $1 and f.id = a.file_id returning f.id, f.bucket, f.storage_path",
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await?;
    let (file_id, bucket, path) = row.ok_or(AppError::NotFound)?;
    sqlx::query("update public.files set deleted_at = now() where id = $1").bind(file_id).execute(&state.db).await?;
    state.storage.remove(&bucket, &[path]).await?;
    audit::record(&state.db, AuditEntry { actor_id: Some(user.id), action: "content.asset_deleted", entity_type: Some("file"), entity_id: Some(file_id), changes: json!({}) }).await?;
    Ok(StatusCode::NO_CONTENT)
}
