//! Access-controlled files: signed upload, verify-and-register, list, signed download, delete.
//! Permissions follow the record a file belongs to.

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use uuid::Uuid;

use crate::{
    audit::{self, AuditEntry},
    auth::AuthUser,
    error::{AppError, AppResult},
    state::AppState,
    validate::Validator,
};

/// (view permission, manage permission) for files attached to each kind of record.
/// A client's media library (bucket `media`) belongs to the content team.
fn permissions(entity_type: &str, bucket: &str) -> Option<(&'static str, &'static str)> {
    Some(match entity_type {
        "client" if bucket == "media" => ("content.view", "content.manage"),
        "client" | "contract" => ("clients.view", "clients.manage"),
        "lead" => ("leads.view", "leads.edit"),
        "proposal" => ("proposals.view", "proposals.manage"),
        "content_post" => ("content.view", "content.manage"),
        "website" => ("websites.view", "websites.manage"),
        "project" | "task" => ("projects.view", "projects.view"),
        _ => return None,
    })
}

fn require(user: &AuthUser, entity_type: &str, bucket: &str, write: bool) -> AppResult<()> {
    let (view, manage) = permissions(entity_type, bucket).ok_or_else(|| AppError::BadRequest("Files can't be attached to this record.".into()))?;
    user.require(if write { manage } else { view })
}

const ALLOWED_TYPES: &[&str] = &[
    "image/", "video/", "audio/", "font/", "application/pdf", "text/plain", "text/csv", "application/zip",
    "application/msword", "application/vnd.openxmlformats-officedocument", "application/vnd.ms-excel",
    "application/vnd.ms-powerpoint", "application/postscript", "application/illustrator", "image/vnd.adobe.photoshop",
    "application/x-font", "application/font", "application/octet-stream",
];

fn bucket_limit(bucket: &str) -> Option<i64> {
    match bucket {
        "media" => Some(500 * 1024 * 1024),
        "documents" => Some(50 * 1024 * 1024),
        _ => None,
    }
}

fn safe_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_') { c } else { '-' })
        .collect();
    let trimmed = cleaned.trim_matches('-');
    let short: String = trimmed.chars().rev().take(80).collect::<Vec<_>>().into_iter().rev().collect();
    if short.is_empty() { "file".into() } else { short }
}

#[derive(Deserialize)]
pub struct UploadRequest {
    bucket: String,
    entity_type: String,
    entity_id: Uuid,
    file_name: String,
    content_type: String,
    size_bytes: i64,
}

#[derive(Serialize)]
pub struct UploadTicket {
    upload_url: String,
    storage_path: String,
}

pub async fn upload_url(State(state): State<AppState>, user: AuthUser, Json(req): Json<UploadRequest>) -> AppResult<Json<UploadTicket>> {
    require(&user, &req.entity_type, &req.bucket, true)?;
    let limit = bucket_limit(&req.bucket).ok_or_else(|| AppError::BadRequest("Unknown storage bucket.".into()))?;
    let mut v = Validator::new();
    v.text("file_name", &req.file_name, 255);
    if req.size_bytes <= 0 || req.size_bytes > limit {
        v.fail("size_bytes", format!("Files can be up to {} MB here.", limit / 1024 / 1024));
    }
    let ct = req.content_type.to_lowercase();
    if !ALLOWED_TYPES.iter().any(|t| ct.starts_with(t)) {
        v.fail("content_type", "This file type isn't allowed.");
    }
    if ct.contains("html") || ct.contains("javascript") || req.file_name.to_lowercase().ends_with(".exe") {
        v.fail("content_type", "This file type isn't allowed.");
    }
    v.finish()?;

    let path = format!("{}/{}/{}-{}", req.entity_type, req.entity_id, Uuid::new_v4(), safe_name(&req.file_name));
    let upload_url = state.storage.signed_upload_url(&req.bucket, &path).await?;
    Ok(Json(UploadTicket { upload_url, storage_path: path }))
}

#[derive(Serialize, sqlx::FromRow)]
pub struct FileRow {
    id: Uuid,
    bucket: String,
    original_name: String,
    content_type: String,
    size_bytes: i64,
    category: Option<String>,
    entity_type: Option<String>,
    entity_id: Option<Uuid>,
    uploaded_by_name: Option<String>,
    created_at: DateTime<Utc>,
}

const FILE_SELECT: &str = "select f.id, f.bucket, f.original_name, f.content_type, f.size_bytes, f.category,
    f.entity_type::text as entity_type, f.entity_id, p.full_name as uploaded_by_name, f.created_at
  from public.files f left join public.profiles p on p.id = f.uploaded_by";

#[derive(Deserialize)]
pub struct RegisterFile {
    bucket: String,
    storage_path: String,
    entity_type: String,
    entity_id: Uuid,
    original_name: String,
    category: Option<String>,
}

/// Records an uploaded object after confirming it really exists in storage.
pub async fn register(State(state): State<AppState>, user: AuthUser, Json(req): Json<RegisterFile>) -> AppResult<Json<FileRow>> {
    Ok(Json(register_file(&state, &user, req).await?))
}

pub async fn register_file(state: &AppState, user: &AuthUser, req: RegisterFile) -> AppResult<FileRow> {
    require(user, &req.entity_type, &req.bucket, true)?;
    let expected_prefix = format!("{}/{}/", req.entity_type, req.entity_id);
    if !req.storage_path.starts_with(&expected_prefix) || req.storage_path.contains("..") {
        return Err(AppError::BadRequest("That upload doesn't belong to this record.".into()));
    }
    let info = state
        .storage
        .info(&req.bucket, &req.storage_path)
        .await?
        .ok_or_else(|| AppError::BadRequest("The upload didn't finish. Please try again.".into()))?;
    let meta = info.metadata.unwrap_or(crate::storage::ObjectMeta { size: None, mimetype: None });

    let id: Uuid = sqlx::query_scalar(
        "insert into public.files (bucket, storage_path, original_name, content_type, size_bytes, category, entity_type, entity_id, uploaded_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         on conflict (bucket, storage_path) do update set original_name = excluded.original_name
         returning id",
    )
    .bind(&req.bucket)
    .bind(&req.storage_path)
    .bind(req.original_name.chars().take(255).collect::<String>())
    .bind(meta.mimetype.unwrap_or_else(|| "application/octet-stream".into()))
    .bind(meta.size.unwrap_or(0))
    .bind(&req.category)
    .bind(&req.entity_type)
    .bind(req.entity_id)
    .bind(user.id)
    .fetch_one(&state.db)
    .await?;
    Ok(sqlx::query_as::<_, FileRow>(&format!("{FILE_SELECT} where f.id = $1")).bind(id).fetch_one(&state.db).await?)
}

#[derive(Deserialize)]
pub struct ListQuery {
    entity_type: String,
    entity_id: Uuid,
    bucket: Option<String>,
}

pub async fn list(State(state): State<AppState>, user: AuthUser, Query(q): Query<ListQuery>) -> AppResult<Json<Vec<FileRow>>> {
    let bucket = q.bucket.clone().unwrap_or_else(|| "documents".into());
    require(&user, &q.entity_type, &bucket, false)?;
    let rows = sqlx::query_as::<_, FileRow>(&format!(
        "{FILE_SELECT} where f.deleted_at is null and f.entity_type = $1::public.entity_kind and f.entity_id = $2 and f.bucket = $3
         order by f.created_at desc"
    ))
    .bind(&q.entity_type)
    .bind(q.entity_id)
    .bind(&bucket)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(rows))
}

#[derive(sqlx::FromRow)]
struct Stored {
    bucket: String,
    storage_path: String,
    original_name: String,
    entity_type: Option<String>,
}

async fn stored(state: &AppState, id: Uuid) -> AppResult<Stored> {
    Ok(sqlx::query_as::<_, Stored>(
        "select bucket, storage_path, original_name, entity_type::text as entity_type from public.files where id = $1 and deleted_at is null",
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::NotFound)?)
}

#[derive(Deserialize)]
pub struct DownloadQuery {
    /// `true` forces a download instead of inline preview.
    #[serde(default)]
    attachment: bool,
}

#[derive(Serialize)]
pub struct SignedUrl {
    url: String,
    expires_in: u32,
}

pub async fn download(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Query(q): Query<DownloadQuery>,
) -> AppResult<Json<SignedUrl>> {
    let f = stored(&state, id).await?;
    require(&user, f.entity_type.as_deref().unwrap_or(""), &f.bucket, false)?;
    let url = state
        .storage
        .signed_download_url(&f.bucket, &f.storage_path, 300, q.attachment.then_some(f.original_name.as_str()))
        .await?;
    Ok(Json(SignedUrl { url, expires_in: 300 }))
}

pub async fn remove(State(state): State<AppState>, user: AuthUser, Path(id): Path<Uuid>) -> AppResult<StatusCode> {
    let f = stored(&state, id).await?;
    require(&user, f.entity_type.as_deref().unwrap_or(""), &f.bucket, true)?;
    sqlx::query("update public.files set deleted_at = now() where id = $1").bind(id).execute(&state.db).await?;
    state.storage.remove(&f.bucket, &[f.storage_path.clone()]).await?;
    audit::record(
        &state.db,
        AuditEntry { actor_id: Some(user.id), action: "file.deleted", entity_type: Some("file"), entity_id: Some(id), changes: json!({ "name": f.original_name }) },
    )
    .await?;
    Ok(StatusCode::NO_CONTENT)
}
