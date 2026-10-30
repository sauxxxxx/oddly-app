//! Audit trail (security) and activity feed (human-readable timeline) helpers.

use serde_json::Value;
use sqlx::PgExecutor;
use uuid::Uuid;

pub struct AuditEntry<'a> {
    pub actor_id: Option<Uuid>,
    pub action: &'a str,
    pub entity_type: Option<&'a str>,
    pub entity_id: Option<Uuid>,
    pub changes: Value,
}

pub async fn record<'e>(db: impl PgExecutor<'e>, entry: AuditEntry<'_>) -> Result<(), sqlx::Error> {
    sqlx::query(
        "insert into public.audit_logs (actor_id, action, entity_type, entity_id, changes)
         values ($1, $2, $3, $4, $5)",
    )
    .bind(entry.actor_id)
    .bind(entry.action)
    .bind(entry.entity_type)
    .bind(entry.entity_id)
    .bind(entry.changes)
    .execute(db)
    .await?;
    Ok(())
}

pub async fn activity<'e>(
    db: impl PgExecutor<'e>,
    actor_id: Uuid,
    entity_type: &str,
    entity_id: Uuid,
    action: &str,
    summary: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "insert into public.activities (actor_id, entity_type, entity_id, action, summary)
         values ($1, $2, $3, $4, $5)",
    )
    .bind(actor_id)
    .bind(entity_type)
    .bind(entity_id)
    .bind(action)
    .bind(summary)
    .execute(db)
    .await?;
    Ok(())
}
