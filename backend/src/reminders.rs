//! Background reminders: turns due follow-ups and upcoming meetings into notifications.
//! Each item is notified once (`notified_at`), so restarts and multiple runs are safe.

use std::time::Duration;

use sqlx::PgPool;

const INTERVAL: Duration = Duration::from_secs(300);

pub fn spawn(db: PgPool) {
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(INTERVAL);
        loop {
            tick.tick().await;
            if let Err(err) = run_once(&db).await {
                tracing::warn!(error = %err, "reminder job failed");
            }
        }
    });
}

pub async fn run_once(db: &PgPool) -> Result<(), sqlx::Error> {
    // Follow-ups due within 30 minutes (or already overdue and never notified).
    let follow_ups = sqlx::query(
        "with due as (
           update public.follow_ups f set notified_at = now()
           where f.status = 'pending' and f.notified_at is null and f.assigned_to is not null
             and f.due_at <= now() + interval '30 minutes'
           returning f.id, f.assigned_to, f.title, f.due_at
         )
         insert into public.notifications (user_id, kind, title, body, entity_type, entity_id)
         select d.assigned_to, 'follow_up_due',
                case when d.due_at < now() then 'Overdue: ' else 'Due soon: ' end || d.title,
                'Due ' || to_char(d.due_at at time zone p.timezone, 'Mon DD, HH12:MI AM'),
                'follow_up', d.id
         from due d join public.profiles p on p.id = d.assigned_to",
    )
    .execute(db)
    .await?
    .rows_affected();

    // Meetings starting within 30 minutes: organizer and team participants.
    let meetings = sqlx::query(
        "with soon as (
           update public.meetings m set notified_at = now()
           where m.deleted_at is null and m.status = 'scheduled' and m.notified_at is null
             and m.starts_at between now() and now() + interval '30 minutes'
           returning m.id, m.title, m.starts_at, m.organizer_id
         ),
         people as (
           select s.id, s.title, s.starts_at, s.organizer_id as user_id from soon s where s.organizer_id is not null
           union
           select s.id, s.title, s.starts_at, mp.user_id from soon s
           join public.meeting_participants mp on mp.meeting_id = s.id where mp.user_id is not null
         )
         insert into public.notifications (user_id, kind, title, body, entity_type, entity_id)
         select pe.user_id, 'meeting_soon', 'Meeting soon: ' || pe.title,
                'Starts ' || to_char(pe.starts_at at time zone p.timezone, 'HH12:MI AM'), 'meeting', pe.id
         from people pe join public.profiles p on p.id = pe.user_id",
    )
    .execute(db)
    .await?
    .rows_affected();

    if follow_ups + meetings > 0 {
        tracing::info!(follow_ups, meetings, "sent reminders");
    }
    Ok(())
}
