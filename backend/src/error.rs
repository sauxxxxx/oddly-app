use std::collections::BTreeMap;

use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;

pub type AppResult<T> = Result<T, AppError>;

/// Every handler error. Converted into a JSON body:
/// `{ "error": { "code": "...", "message": "...", "fields": { ... } } }`
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0}")]
    BadRequest(String),
    #[error("Some fields are invalid")]
    Validation(BTreeMap<String, String>),
    #[error("{0}")]
    Unauthorized(&'static str),
    #[error("{message}")]
    Forbidden { code: &'static str, message: String },
    #[error("Not found")]
    NotFound,
    #[error("{0}")]
    Conflict(String),
    #[error("Too many requests. Please slow down and try again shortly.")]
    TooManyRequests,
    /// A dependency (e.g. the AI service) isn't configured or didn't respond.
    #[error("{0}")]
    Unavailable(String),
    #[error(transparent)]
    Internal(#[from] anyhow::Error),
}

impl AppError {
    pub fn forbidden(message: impl Into<String>) -> Self {
        Self::Forbidden { code: "forbidden", message: message.into() }
    }

    fn status_and_code(&self) -> (StatusCode, &'static str) {
        match self {
            Self::BadRequest(_) => (StatusCode::BAD_REQUEST, "bad_request"),
            Self::Validation(_) => (StatusCode::UNPROCESSABLE_ENTITY, "validation_failed"),
            Self::Unauthorized(_) => (StatusCode::UNAUTHORIZED, "unauthorized"),
            Self::Forbidden { code, .. } => (StatusCode::FORBIDDEN, code),
            Self::NotFound => (StatusCode::NOT_FOUND, "not_found"),
            Self::Conflict(_) => (StatusCode::CONFLICT, "conflict"),
            Self::TooManyRequests => (StatusCode::TOO_MANY_REQUESTS, "rate_limited"),
            Self::Unavailable(_) => (StatusCode::SERVICE_UNAVAILABLE, "unavailable"),
            Self::Internal(_) => (StatusCode::INTERNAL_SERVER_ERROR, "internal_error"),
        }
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, code) = self.status_and_code();

        let message = match &self {
            Self::Internal(err) => {
                tracing::error!(error = ?err, "internal error");
                "Something went wrong on the server. Please try again.".to_owned()
            }
            other => other.to_string(),
        };

        let mut body = json!({ "error": { "code": code, "message": message } });
        if let Self::Validation(fields) = &self {
            body["error"]["fields"] = json!(fields);
        }

        (status, Json(body)).into_response()
    }
}

impl From<sqlx::Error> for AppError {
    fn from(err: sqlx::Error) -> Self {
        match &err {
            sqlx::Error::RowNotFound => Self::NotFound,
            sqlx::Error::Database(db) if db.code().as_deref() == Some("23505") => {
                Self::Conflict("A record with these details already exists.".into())
            }
            _ => Self::Internal(err.into()),
        }
    }
}
