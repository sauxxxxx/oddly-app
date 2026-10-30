//! Supabase Storage (S3-compatible) client. Buckets are private: the API issues short-lived
//! signed URLs after checking permissions, and the desktop app moves bytes directly.

use anyhow::Context;
use serde::Deserialize;
use serde_json::json;

use crate::{config::Config, error::AppError};

pub struct Storage {
    http: reqwest::Client,
    base: String,
    key: String,
}

#[derive(Deserialize)]
struct SignedUpload {
    url: String,
}

#[derive(Deserialize)]
struct SignedDownload {
    #[serde(rename = "signedURL")]
    signed_url: String,
}

#[derive(Deserialize)]
pub struct ObjectInfo {
    pub name: String,
    pub metadata: Option<ObjectMeta>,
}

#[derive(Deserialize)]
pub struct ObjectMeta {
    pub size: Option<i64>,
    pub mimetype: Option<String>,
}

impl Storage {
    pub fn new(config: &Config, http: reqwest::Client) -> Self {
        Self { http, base: format!("{}/storage/v1", config.supabase_url), key: config.supabase_secret_key.clone() }
    }

    fn req(&self, method: reqwest::Method, path: &str) -> reqwest::RequestBuilder {
        let r = self.http.request(method, format!("{}{path}", self.base)).header("apikey", &self.key);
        if self.key.starts_with("eyJ") {
            r.bearer_auth(&self.key)
        } else {
            r
        }
    }

    /// URL the client PUTs the file to (valid for 2 hours, single object).
    pub async fn signed_upload_url(&self, bucket: &str, path: &str) -> Result<String, AppError> {
        let res = self
            .req(reqwest::Method::POST, &format!("/object/upload/sign/{bucket}/{path}"))
            .send()
            .await
            .context("calling Supabase Storage")?;
        let res = check(res).await?;
        let body: SignedUpload = res.json().await.context("parsing signed upload URL")?;
        Ok(format!("{}{}", self.base, body.url))
    }

    /// Short-lived download link.
    pub async fn signed_download_url(&self, bucket: &str, path: &str, seconds: u32, download_name: Option<&str>) -> Result<String, AppError> {
        let res = self
            .req(reqwest::Method::POST, &format!("/object/sign/{bucket}/{path}"))
            .json(&json!({ "expiresIn": seconds }))
            .send()
            .await
            .context("calling Supabase Storage")?;
        let res = check(res).await?;
        let body: SignedDownload = res.json().await.context("parsing signed URL")?;
        let mut url = format!("{}{}", self.base, body.signed_url);
        if let Some(name) = download_name {
            url.push_str("&download=");
            url.push_str(&urlencode(name));
        }
        Ok(url)
    }

    /// Metadata for one object, or None if it doesn't exist (used to verify uploads).
    pub async fn info(&self, bucket: &str, path: &str) -> Result<Option<ObjectInfo>, AppError> {
        let (prefix, name) = path.rsplit_once('/').unwrap_or(("", path));
        let res = self
            .req(reqwest::Method::POST, &format!("/object/list/{bucket}"))
            .json(&json!({ "prefix": prefix, "search": name, "limit": 5 }))
            .send()
            .await
            .context("calling Supabase Storage")?;
        let res = check(res).await?;
        let items: Vec<ObjectInfo> = res.json().await.context("parsing object list")?;
        Ok(items.into_iter().find(|o| o.name == name))
    }

    pub async fn remove(&self, bucket: &str, paths: &[String]) -> Result<(), AppError> {
        let res = self
            .req(reqwest::Method::DELETE, &format!("/object/{bucket}"))
            .json(&json!({ "prefixes": paths }))
            .send()
            .await
            .context("calling Supabase Storage")?;
        check(res).await?;
        Ok(())
    }
}

async fn check(res: reqwest::Response) -> Result<reqwest::Response, AppError> {
    if res.status().is_success() {
        return Ok(res);
    }
    let status = res.status();
    let body = res.text().await.unwrap_or_default();
    Err(AppError::Internal(anyhow::anyhow!("Supabase Storage returned {status}: {body}")))
}

fn urlencode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}
