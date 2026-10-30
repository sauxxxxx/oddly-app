//! Background jobs for website management:
//! * uptime checks every 10 minutes (down alerts on the transition from up to down),
//! * renewal reminders for domains, hosting, SSL and contracts at 30 and 7 days.

use std::time::{Duration, Instant};

use futures::{stream, StreamExt};
use sqlx::PgPool;
use uuid::Uuid;

const CHECK_EVERY: Duration = Duration::from_secs(600);

pub fn http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        // Redirects aren't followed: a public site could redirect to an internal address.
        // A 3xx answer already proves the site is up.
        .redirect(reqwest::redirect::Policy::none())
        .user_agent("ODDLY uptime monitor")
        .build()
        .expect("monitor HTTP client")
}

pub fn spawn(db: PgPool, http: reqwest::Client) {
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(CHECK_EVERY);
        loop {
            tick.tick().await;
            if let Err(e) = check_all(&db, &http).await {
                tracing::warn!(error = %e, "uptime checks failed");
            }
            if let Err(e) = renewal_reminders(&db).await {
                tracing::warn!(error = %e, "renewal reminders failed");
            }
        }
    });
}

async fn check_all(db: &PgPool, http: &reqwest::Client) -> Result<(), sqlx::Error> {
    let sites: Vec<(Uuid, String)> = sqlx::query_as(
        "select id, coalesce(url, 'https://' || domain) from public.websites where deleted_at is null and status = 'active'",
    )
    .fetch_all(db)
    .await?;
    stream::iter(sites)
        .for_each_concurrent(8, |(id, url)| async move {
            if let Err(e) = check_one(db, http, id, &url).await {
                tracing::warn!(%id, error = ?e, "website check failed to record");
            }
        })
        .await;
    sqlx::query("delete from public.website_checks where checked_at < now() - interval '30 days'").execute(db).await?;
    Ok(())
}

/// Checks one site, records the result, and alerts the developer and account manager
/// when a site that was up goes down (or comes back).
pub async fn check_one(db: &PgPool, http: &reqwest::Client, id: Uuid, url: &str) -> Result<(), crate::error::AppError> {
    let started = Instant::now();
    let (ok, code, error) = match public_target(url).await {
        Err(reason) => (false, None, Some(reason)),
        Ok(()) => match http.get(url).send().await {
            Ok(res) => {
                let code = res.status().as_u16() as i32;
                (res.status().is_success() || res.status().is_redirection(), Some(code), None)
            }
            Err(e) => (false, None, Some(if e.is_timeout() { "Timed out after 15 seconds".to_owned() } else { short_error(&e) })),
        },
    };
    let elapsed = started.elapsed().as_millis().min(i32::MAX as u128) as i32;

    let was_ok: Option<bool> = sqlx::query_scalar("select ok from public.website_checks where website_id = $1 order by checked_at desc limit 1")
        .bind(id)
        .fetch_optional(db)
        .await?;
    sqlx::query("insert into public.website_checks (website_id, ok, status_code, response_ms, error) values ($1, $2, $3, $4, $5)")
        .bind(id).bind(ok).bind(code).bind(ok.then_some(elapsed)).bind(&error)
        .execute(db)
        .await?;
    sqlx::query("update public.websites set last_checked_at = now(), last_status_code = $2 where id = $1")
        .bind(id).bind(code)
        .execute(db)
        .await?;

    if let Some(prev) = was_ok {
        if prev != ok {
            let (title, body) = if ok {
                ("is back up".to_owned(), format!("Responding again ({})", code.map_or("ok".into(), |c| c.to_string())))
            } else {
                ("is down".to_owned(), error.clone().unwrap_or_else(|| format!("HTTP {}", code.unwrap_or(0))))
            };
            sqlx::query(
                "insert into public.notifications (user_id, kind, title, body, entity_type, entity_id)
                 select distinct u, $2, w.domain || ' ' || $3, $4, 'website', w.id
                 from public.websites w join public.clients cl on cl.id = w.client_id,
                      unnest(array[w.developer_id, cl.account_manager_id]) as u
                 where w.id = $1 and u is not null",
            )
            .bind(id)
            .bind(if ok { "website_up" } else { "website_down" })
            .bind(title)
            .bind(body)
            .execute(db)
            .await?;
        }
    }
    Ok(())
}

/// Only public http(s) sites are checked, so a stored URL can't be used to probe the
/// API server's own network (SSRF).
async fn public_target(url: &str) -> Result<(), String> {
    let parsed = reqwest::Url::parse(url).map_err(|_| "Not a valid URL".to_owned())?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("Only http and https sites are monitored".into());
    }
    let host = parsed.host_str().ok_or("URL has no host")?.to_owned();
    let port = parsed.port_or_known_default().unwrap_or(443);
    let addrs = tokio::net::lookup_host((host.as_str(), port)).await.map_err(|_| "Domain doesn't resolve".to_owned())?;
    for addr in addrs {
        let ip = addr.ip();
        let private = match ip {
            std::net::IpAddr::V4(v4) => v4.is_private() || v4.is_loopback() || v4.is_link_local() || v4.is_unspecified() || v4.is_broadcast()
                || v4.octets()[0] == 100 && (64..128).contains(&v4.octets()[1]),
            std::net::IpAddr::V6(v6) => v6.is_loopback() || v6.is_unspecified() || (v6.segments()[0] & 0xfe00) == 0xfc00 || (v6.segments()[0] & 0xffc0) == 0xfe80,
        };
        if private {
            return Err("Private network addresses aren't monitored".into());
        }
    }
    Ok(())
}

fn short_error(e: &reqwest::Error) -> String {
    let s = e.to_string();
    if s.contains("dns") || s.contains("resolve") {
        "Domain doesn't resolve".into()
    } else if s.contains("certificate") || s.contains("tls") || s.contains("ssl") {
        "SSL/TLS error".into()
    } else if s.contains("connect") {
        "Connection refused".into()
    } else {
        s.chars().take(200).collect()
    }
}

/// Domain, hosting, SSL and contract end dates at 30 and 7 days out. Each alert is sent
/// once per item, date and threshold (tracked in `sent_alerts`).
pub async fn renewal_reminders(db: &PgPool) -> Result<u64, sqlx::Error> {
    let sent = sqlx::query(
        r#"
        with due as (
          select 'website' as entity_type, w.id as entity_id, k.kind, k.on_date,
                 w.domain as name, array[w.developer_id, cl.account_manager_id] as recipients
          from public.websites w
          join public.clients cl on cl.id = w.client_id
          cross join lateral (values ('domain', w.domain_expires_on), ('hosting', w.hosting_renews_on), ('SSL certificate', w.ssl_expires_on)) as k(kind, on_date)
          where w.deleted_at is null and w.status <> 'archived' and k.on_date is not null
          union all
          select 'contract', c.id, 'contract', c.end_date, c.title, array[cl.account_manager_id]
          from public.contracts c join public.clients cl on cl.id = c.client_id
          where c.deleted_at is null and c.status in ('signed','active') and c.end_date is not null
        ),
        hits as (
          select d.*, t.days, d.entity_type || ':' || d.entity_id || ':' || d.kind || ':' || d.on_date || ':' || t.days as key
          from due d cross join (values (30), (7)) as t(days)
          where d.on_date between current_date and current_date + t.days
        ),
        fresh as (
          insert into public.sent_alerts (key) select key from hits on conflict do nothing returning key
        )
        insert into public.notifications (user_id, kind, title, body, entity_type, entity_id)
        select distinct u, 'renewal_due',
               case when h.kind = 'contract' then 'Contract ending: ' || h.name else initcap(h.kind) || ' renewal: ' || h.name end,
               'Due ' || to_char(h.on_date, 'Mon DD, YYYY') || ' (' || (h.on_date - current_date) || ' days)',
               h.entity_type::public.entity_kind, h.entity_id
        from hits h join fresh f on f.key = h.key, unnest(h.recipients) as u
        where u is not null
        "#,
    )
    .execute(db)
    .await?
    .rows_affected();
    if sent > 0 {
        tracing::info!(sent, "renewal reminders sent");
    }
    Ok(sent)
}
