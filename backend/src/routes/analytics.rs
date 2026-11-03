//! Analytics reports over a date range. Every figure comes from live records and is scoped
//! to what the user may see; money is always per currency (never summed across currencies).

use axum::{
    extract::{Query, State},
    Json,
};
use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

use crate::{
    auth::AuthUser,
    error::{AppError, AppResult},
    state::AppState,
};

#[derive(Deserialize)]
pub struct RangeQuery {
    pub from: Option<NaiveDate>,
    pub to: Option<NaiveDate>,
}

#[derive(Serialize, Clone)]
pub struct Range {
    from: NaiveDate,
    to: NaiveDate,
    bucket: &'static str,
    #[serde(skip)]
    start: DateTime<Utc>,
    #[serde(skip)]
    end: DateTime<Utc>,
    #[serde(skip)]
    prev_start: DateTime<Utc>,
    #[serde(skip)]
    tz: String,
}

/// Resolves the date range in the user's time zone (default: last 90 days).
async fn range(db: &PgPool, user: &AuthUser, q: &RangeQuery) -> AppResult<Range> {
    let tz = user.timezone.clone();
    let today: NaiveDate = sqlx::query_scalar("select (now() at time zone $1)::date").bind(&tz).fetch_one(db).await?;
    let to = q.to.unwrap_or(today);
    let from = q.from.unwrap_or(to - chrono::Duration::days(89));
    if from > to {
        return Err(AppError::BadRequest("The start date must be before the end date.".into()));
    }
    let days = (to - from).num_days() + 1;
    if days > 1100 {
        return Err(AppError::BadRequest("Choose a range of three years or less.".into()));
    }
    let bucket = match days {
        ..=45 => "day",
        46..=200 => "week",
        _ => "month",
    };
    let (start, end): (DateTime<Utc>, DateTime<Utc>) = sqlx::query_as(
        "select ($1::date::timestamp at time zone $3), (($2::date + 1)::timestamp at time zone $3)",
    )
    .bind(from)
    .bind(to)
    .bind(&tz)
    .fetch_one(db)
    .await?;
    Ok(Range { from, to, bucket, start, end, prev_start: start - (end - start), tz })
}

#[derive(Serialize, sqlx::FromRow)]
pub struct Count {
    label: String,
    count: i64,
}

#[derive(Serialize, sqlx::FromRow)]
pub struct Money {
    label: String,
    currency: String,
    amount: Decimal,
    count: i64,
}

#[derive(Serialize, sqlx::FromRow)]
pub struct TrendPoint {
    bucket: NaiveDate,
    series: String,
    value: Decimal,
}

/// Bucketed series: `select date_trunc($1, <ts> at time zone $2)::date as bucket, <series>, <value>`.
async fn trend(db: &PgPool, r: &Range, sql: String, all: bool, uid: Uuid) -> Result<Vec<TrendPoint>, sqlx::Error> {
    sqlx::query_as::<_, TrendPoint>(&sql)
        .bind(r.bucket)
        .bind(&r.tz)
        .bind(r.start)
        .bind(r.end)
        .bind(all)
        .bind(uid)
        .fetch_all(db)
        .await
}

// ---------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------

#[derive(Serialize, sqlx::FromRow)]
pub struct LeadTotals {
    total: i64,
    active: i64,
    new_in_range: i64,
    new_previous: i64,
    contacted: i64,
    converted: i64,
    never_contacted: i64,
}

#[derive(Serialize, sqlx::FromRow)]
pub struct OwnerLeads {
    label: String,
    assigned: i64,
    contacted: i64,
    converted: i64,
    interactions: i64,
}

#[derive(Serialize)]
pub struct LeadReport {
    range: Range,
    totals: LeadTotals,
    by_market: Vec<Count>,
    by_country: Vec<Count>,
    by_industry: Vec<Count>,
    by_source: Vec<Count>,
    by_stage: Vec<Count>,
    by_status: Vec<Count>,
    by_owner: Vec<OwnerLeads>,
    trend: Vec<TrendPoint>,
}

/// Visibility filter on `l` (leads alias): $5 = can see all, $6 = user id.
/// Same rule as the leads list: assigned to me, or on a lead list I'm assigned to.
const SCOPE: &str = "($5 or l.assigned_to = $6 or exists (select 1 from public.lead_list_members m
    join public.lead_list_assignees a on a.list_id = m.list_id where m.lead_id = l.id and a.user_id = $6))";

pub async fn leads(State(state): State<AppState>, user: AuthUser, Query(q): Query<RangeQuery>) -> AppResult<Json<LeadReport>> {
    user.require("analytics.view")?;
    let db = &state.db;
    let r = range(db, &user, &q).await?;
    let all = user.can("leads.view_all");
    let uid = user.id;

    let counts = |sql: String| {
        let r = r.clone();
        async move {
            sqlx::query_as::<_, Count>(&sql)
                .bind(r.bucket).bind(r.tz.clone()).bind(r.start).bind(r.end).bind(all).bind(uid)
                .fetch_all(db)
                .await
        }
    };
    // Group-by over leads created in the range.
    let grouped = |expr: &str, limit: i32| {
        format!(
            "select coalesce({expr}, 'Unspecified') as label, count(*) as count
             from public.leads l join public.companies c on c.id = l.company_id
             left join public.lead_sources s on s.id = l.source_id
             where l.deleted_at is null and l.created_at >= $3 and l.created_at < $4 and {SCOPE}
               and $1::text is not null and $2::text is not null
             group by 1 order by 2 desc, 1 limit {limit}"
        )
    };

    let (totals, by_market, by_country, by_industry, by_source, by_stage, by_status, by_owner, trend_rows) = tokio::try_join!(
        async { sqlx::query_as::<_, LeadTotals>(&format!(
            "select count(*) as total,
               count(*) filter (where l.status = 'active') as active,
               count(*) filter (where l.created_at >= $3 and l.created_at < $4) as new_in_range,
               count(*) filter (where l.created_at >= $7 and l.created_at < $3) as new_previous,
               count(*) filter (where l.created_at >= $3 and l.created_at < $4 and l.last_contacted_at is not null) as contacted,
               count(*) filter (where l.created_at >= $3 and l.created_at < $4 and l.status = 'converted') as converted,
               count(*) filter (where l.status = 'active' and l.last_contacted_at is null) as never_contacted
             from public.leads l where l.deleted_at is null and {SCOPE}
               and $1::text is not null and $2::text is not null"
        ))
        .bind(r.bucket).bind(&r.tz).bind(r.start).bind(r.end).bind(all).bind(uid).bind(r.prev_start)
        .fetch_one(db).await },
        counts(grouped("initcap(c.market)", 5)),
        counts(grouped("c.country", 15)),
        counts(grouped("c.industry", 15)),
        counts(grouped("s.name", 15)),
        counts(format!(
            "select st.name as label, count(l.id) as count from public.pipeline_stages st
             left join public.leads l on l.stage_id = st.id and l.deleted_at is null and {SCOPE}
             where st.archived_at is null and $1::text is not null and $2::text is not null
               and $3::timestamptz is not null and $4::timestamptz is not null
             group by st.id order by st.position"
        )),
        counts(format!(
            "select initcap(l.status) as label, count(*) as count from public.leads l
             where l.deleted_at is null and {SCOPE} and $1::text is not null and $2::text is not null
               and $3::timestamptz is not null and $4::timestamptz is not null
             group by 1 order by 2 desc"
        )),
        async { sqlx::query_as::<_, OwnerLeads>(&format!(
            "select coalesce(p.full_name, 'Unassigned') as label,
               count(*) filter (where l.created_at >= $3 and l.created_at < $4) as assigned,
               count(*) filter (where l.created_at >= $3 and l.created_at < $4 and l.last_contacted_at is not null) as contacted,
               count(*) filter (where l.converted_at >= $3 and l.converted_at < $4) as converted,
               coalesce(sum((select count(*) from public.lead_interactions i where i.lead_id = l.id
                 and i.occurred_at >= $3 and i.occurred_at < $4)), 0)::bigint as interactions
             from public.leads l left join public.profiles p on p.id = l.assigned_to
             where l.deleted_at is null and {SCOPE} and $1::text is not null and $2::text is not null
             group by 1 order by 2 desc"
        ))
        .bind(r.bucket).bind(&r.tz).bind(r.start).bind(r.end).bind(all).bind(uid)
        .fetch_all(db).await },
        trend(db, &r, format!(
            "select date_trunc($1, l.created_at at time zone $2)::date as bucket, initcap(c.market) as series, count(*)::numeric as value
             from public.leads l join public.companies c on c.id = l.company_id
             where l.deleted_at is null and l.created_at >= $3 and l.created_at < $4 and {SCOPE}
             group by 1, 2 order by 1"
        ), all, uid),
    )?;

    Ok(Json(LeadReport { range: r, totals, by_market, by_country, by_industry, by_source, by_stage, by_status, by_owner, trend: trend_rows }))
}

// ---------------------------------------------------------------------------
// Sales
// ---------------------------------------------------------------------------

#[derive(Serialize, sqlx::FromRow)]
pub struct SalesTotals {
    deals_open: i64,
    deals_won: i64,
    deals_lost: i64,
    proposals_sent: i64,
    proposals_accepted: i64,
    proposals_rejected: i64,
    avg_days_to_decision: Option<f64>,
    interactions: i64,
    meetings: i64,
}

#[derive(Serialize)]
pub struct SalesReport {
    range: Range,
    totals: SalesTotals,
    /// Only with finance.view.
    won_by_currency: Option<Vec<Money>>,
    pipeline_by_currency: Option<Vec<Money>>,
    won_by_owner: Option<Vec<Money>>,
    revenue_trend: Option<Vec<TrendPoint>>,
    lost_reasons: Vec<Count>,
    outreach_by_channel: Vec<Count>,
}

pub async fn sales(State(state): State<AppState>, user: AuthUser, Query(q): Query<RangeQuery>) -> AppResult<Json<SalesReport>> {
    user.require("analytics.view")?;
    let db = &state.db;
    let r = range(db, &user, &q).await?;
    let all = user.can("leads.view_all");
    let uid = user.id;
    let finance = user.can("finance.view");
    // Deal scope: owner, or everything for users who see all leads.
    let dscope = "($5 or d.owner_id = $6)";

    let money = |sql: String| {
        let r = r.clone();
        async move {
            if !finance {
                return Ok(None);
            }
            sqlx::query_as::<_, Money>(&sql)
                .bind(r.bucket).bind(r.tz.clone()).bind(r.start).bind(r.end).bind(all).bind(uid)
                .fetch_all(db)
                .await
                .map(Some)
        }
    };
    let counts = |sql: String| {
        let r = r.clone();
        async move {
            sqlx::query_as::<_, Count>(&sql)
                .bind(r.bucket).bind(r.tz.clone()).bind(r.start).bind(r.end).bind(all).bind(uid)
                .fetch_all(db)
                .await
        }
    };
    let guard = "$1::text is not null and $2::text is not null";

    let (totals, won_by_currency, pipeline_by_currency, won_by_owner, revenue_trend, lost_reasons, outreach_by_channel) = tokio::try_join!(
        async { sqlx::query_as::<_, SalesTotals>(&format!(
            "select
               (select count(*) from public.deals d where d.deleted_at is null and d.status = 'open' and {dscope}) as deals_open,
               (select count(*) from public.deals d where d.deleted_at is null and d.status = 'won' and d.won_at >= $3 and d.won_at < $4 and {dscope}) as deals_won,
               (select count(*) from public.deals d where d.deleted_at is null and d.status = 'lost' and d.lost_at >= $3 and d.lost_at < $4 and {dscope}) as deals_lost,
               (select count(*) from public.proposals p where p.deleted_at is null and not p.is_template and p.sent_at >= $3 and p.sent_at < $4) as proposals_sent,
               (select count(*) from public.proposals p where p.deleted_at is null and p.status = 'accepted' and p.responded_at >= $3 and p.responded_at < $4) as proposals_accepted,
               (select count(*) from public.proposals p where p.deleted_at is null and p.status = 'rejected' and p.responded_at >= $3 and p.responded_at < $4) as proposals_rejected,
               (select avg(extract(epoch from (p.responded_at - p.sent_at)) / 86400)::float8 from public.proposals p
                  where p.deleted_at is null and p.status in ('accepted','rejected') and p.responded_at >= $3 and p.responded_at < $4 and p.sent_at is not null) as avg_days_to_decision,
               (select count(*) from public.lead_interactions i join public.leads l on l.id = i.lead_id
                  where i.occurred_at >= $3 and i.occurred_at < $4 and i.direction <> 'internal' and {SCOPE}) as interactions,
               (select count(*) from public.meetings m where m.deleted_at is null and m.starts_at >= $3 and m.starts_at < $4
                  and m.status <> 'cancelled' and ($5 or m.organizer_id = $6)) as meetings
             where {guard}"
        ))
        .bind(r.bucket).bind(&r.tz).bind(r.start).bind(r.end).bind(all).bind(uid)
        .fetch_one(db).await },
        money(format!(
            "select 'Won' as label, d.currency, sum(d.value) as amount, count(*) as count from public.deals d
             where d.deleted_at is null and d.status = 'won' and d.won_at >= $3 and d.won_at < $4 and {dscope} and {guard}
             group by d.currency order by 3 desc"
        )),
        money(format!(
            "select label, currency, sum(amount) as amount, sum(count)::bigint as count from (
               select 'Open deals' as label, d.currency, d.value as amount, 1 as count from public.deals d
                 where d.deleted_at is null and d.status = 'open' and {dscope}
               union all
               select 'Active leads (estimated)', l.currency, l.estimated_value, 1 from public.leads l
                 where l.deleted_at is null and l.status = 'active' and l.estimated_value is not null and {SCOPE}
                   and not exists (select 1 from public.deals d2 where d2.lead_id = l.id and d2.status = 'open' and d2.deleted_at is null)
             ) x where {guard} and $3::timestamptz is not null and $4::timestamptz is not null
             group by label, currency order by label, 3 desc"
        )),
        money(format!(
            "select coalesce(p.full_name, 'Unassigned') as label, d.currency, sum(d.value) as amount, count(*) as count
             from public.deals d left join public.profiles p on p.id = d.owner_id
             where d.deleted_at is null and d.status = 'won' and d.won_at >= $3 and d.won_at < $4 and {dscope} and {guard}
             group by 1, 2 order by 3 desc"
        )),
        async {
            if !finance {
                return Ok(None);
            }
            trend(db, &r, format!(
                "select date_trunc($1, d.won_at at time zone $2)::date as bucket, d.currency as series, sum(d.value) as value
                 from public.deals d where d.deleted_at is null and d.status = 'won' and d.won_at >= $3 and d.won_at < $4 and {dscope}
                 group by 1, 2 order by 1"
            ), all, uid).await.map(Some)
        },
        counts(format!(
            "select coalesce(nullif(trim(d.lost_reason), ''), 'No reason given') as label, count(*) as count from public.deals d
             where d.deleted_at is null and d.status = 'lost' and d.lost_at >= $3 and d.lost_at < $4 and {dscope} and {guard}
             group by 1 order by 2 desc limit 10"
        )),
        counts(format!(
            "select initcap(replace(i.channel, '_', ' ')) as label, count(*) as count
             from public.lead_interactions i join public.leads l on l.id = i.lead_id
             where i.occurred_at >= $3 and i.occurred_at < $4 and {SCOPE} and {guard}
             group by 1 order by 2 desc"
        )),
    )?;

    Ok(Json(SalesReport { range: r, totals, won_by_currency, pipeline_by_currency, won_by_owner, revenue_trend, lost_reasons, outreach_by_channel }))
}

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

#[derive(Serialize, sqlx::FromRow)]
pub struct ClientTotals {
    current: i64,
    new_in_range: i64,
    new_previous: i64,
    retained_90d: i64,
    inactive: i64,
    completed: i64,
    at_risk: i64,
}

#[derive(Serialize, sqlx::FromRow)]
pub struct ServiceUse {
    label: String,
    clients: i64,
    active: i64,
}

#[derive(Serialize)]
pub struct ClientReport {
    range: Range,
    totals: ClientTotals,
    by_status: Vec<Count>,
    by_market: Vec<Count>,
    by_industry: Vec<Count>,
    services: Vec<ServiceUse>,
    growth: Vec<TrendPoint>,
    by_manager: Vec<Count>,
}

pub async fn clients(State(state): State<AppState>, user: AuthUser, Query(q): Query<RangeQuery>) -> AppResult<Json<ClientReport>> {
    user.require("analytics.view")?;
    user.require("clients.view")?;
    let db = &state.db;
    let r = range(db, &user, &q).await?;
    let current = "('onboarding','active','awaiting_client','needs_attention','at_risk')";
    let counts = |sql: String| {
        let r = r.clone();
        async move { sqlx::query_as::<_, Count>(&sql).bind(r.from).bind(r.to).fetch_all(db).await }
    };
    let (totals, by_status, by_market, by_industry, services, growth, by_manager) = tokio::try_join!(
        async { sqlx::query_as::<_, ClientTotals>(&format!(
            "select count(*) filter (where status in {current}) as current,
               count(*) filter (where client_since between $1 and $2) as new_in_range,
               count(*) filter (where client_since between $1 - ($2 - $1 + 1) and $1 - 1) as new_previous,
               count(*) filter (where status in {current} and client_since <= $2 - 90) as retained_90d,
               count(*) filter (where status = 'inactive') as inactive,
               count(*) filter (where status = 'completed') as completed,
               count(*) filter (where status in ('at_risk','needs_attention')) as at_risk
             from public.clients where deleted_at is null"
        ))
        .bind(r.from).bind(r.to)
        .fetch_one(db).await },
        counts("select initcap(replace(status, '_', ' ')) as label, count(*) as count from public.clients
                where deleted_at is null and $1::date is not null and $2::date is not null group by 1 order by 2 desc".into()),
        counts("select initcap(c.market) as label, count(*) as count from public.clients cl join public.companies c on c.id = cl.company_id
                where cl.deleted_at is null and $1::date is not null and $2::date is not null group by 1 order by 2 desc".into()),
        counts("select coalesce(c.industry, 'Unspecified') as label, count(*) as count from public.clients cl join public.companies c on c.id = cl.company_id
                where cl.deleted_at is null and $1::date is not null and $2::date is not null group by 1 order by 2 desc limit 15".into()),
        sqlx::query_as::<_, ServiceUse>(
            "select s.name as label, count(distinct s.client_id) as clients,
                    count(*) filter (where s.status = 'active') as active
             from public.client_services s join public.clients cl on cl.id = s.client_id
             where cl.deleted_at is null group by 1 order by 2 desc limit 20",
        )
        .fetch_all(db),
        sqlx::query_as::<_, TrendPoint>(
            "select date_trunc($3, client_since::timestamp)::date as bucket, 'New clients' as series, count(*)::numeric as value
             from public.clients where deleted_at is null and client_since between $1 and $2 group by 1 order by 1",
        )
        .bind(r.from).bind(r.to).bind(r.bucket)
        .fetch_all(db),
        counts(format!("select coalesce(p.full_name, 'No manager') as label, count(*) as count from public.clients cl
                left join public.profiles p on p.id = cl.account_manager_id
                where cl.deleted_at is null and cl.status in {current} and $1::date is not null and $2::date is not null group by 1 order by 2 desc")),
    )?;
    Ok(Json(ClientReport { range: r, totals, by_status, by_market, by_industry, services, growth, by_manager }))
}

// ---------------------------------------------------------------------------
// Finance (finance.view)
// ---------------------------------------------------------------------------

#[derive(Serialize, sqlx::FromRow)]
pub struct CurrencyCompare {
    currency: String,
    amount: Decimal,
    previous_amount: Decimal,
    deals: i64,
}

#[derive(Serialize)]
pub struct FinanceReport {
    range: Range,
    won: Vec<CurrencyCompare>,
    recurring_monthly: Vec<Money>,
    active_contracts: Vec<Money>,
    proposals_pending: Vec<Money>,
    revenue_trend: Vec<TrendPoint>,
    top_clients: Vec<Money>,
    by_service_category: Vec<Money>,
    note: &'static str,
}

pub async fn finance(State(state): State<AppState>, user: AuthUser, Query(q): Query<RangeQuery>) -> AppResult<Json<FinanceReport>> {
    user.require("analytics.view")?;
    user.require("finance.view")?;
    let db = &state.db;
    let r = range(db, &user, &q).await?;
    let money = |sql: &'static str| {
        let r = r.clone();
        async move { sqlx::query_as::<_, Money>(sql).bind(r.start).bind(r.end).fetch_all(db).await }
    };
    let (won, recurring_monthly, active_contracts, proposals_pending, revenue_trend, top_clients, by_service_category) = tokio::try_join!(
        sqlx::query_as::<_, CurrencyCompare>(
            "select currency,
               coalesce(sum(value) filter (where won_at >= $1), 0) as amount,
               coalesce(sum(value) filter (where won_at < $1), 0) as previous_amount,
               count(*) filter (where won_at >= $1) as deals
             from public.deals where deleted_at is null and status = 'won' and won_at >= $3 and won_at < $2
             group by currency order by amount desc",
        )
        .bind(r.start).bind(r.end).bind(r.prev_start)
        .fetch_all(db),
        money(
            "select 'Recurring per month' as label, s.currency,
                    sum(case s.billing_type when 'monthly' then s.price when 'quarterly' then round(s.price / 3, 2)
                        when 'yearly' then round(s.price / 12, 2) else 0 end) as amount, count(*) as count
             from public.client_services s join public.clients cl on cl.id = s.client_id
             where cl.deleted_at is null and s.status = 'active' and s.billing_type in ('monthly','quarterly','yearly')
               and $1::timestamptz is not null and $2::timestamptz is not null
             group by s.currency order by 3 desc",
        ),
        money(
            "select 'Active contracts' as label, k.currency, coalesce(sum(k.value), 0) as amount, count(*) as count
             from public.contracts k join public.clients cl on cl.id = k.client_id
             where k.deleted_at is null and cl.deleted_at is null and k.status in ('signed','active')
               and (k.end_date is null or k.end_date >= current_date)
               and $1::timestamptz is not null and $2::timestamptz is not null
             group by k.currency order by 3 desc",
        ),
        money(
            "select 'Awaiting decision' as label, currency, sum(total) as amount, count(*) as count from public.proposals
             where deleted_at is null and not is_template and status in ('ready','sent')
               and $1::timestamptz is not null and $2::timestamptz is not null
             group by currency order by 3 desc",
        ),
        sqlx::query_as::<_, TrendPoint>(
            "select date_trunc('month', won_at at time zone $3)::date as bucket, currency as series, sum(value) as value
             from public.deals where deleted_at is null and status = 'won' and won_at >= $1 and won_at < $2
             group by 1, 2 order by 1",
        )
        .bind(r.start).bind(r.end).bind(&r.tz)
        .fetch_all(db),
        money(
            "select c.name as label, d.currency, sum(d.value) as amount, count(*) as count
             from public.deals d join public.companies c on c.id = d.company_id
             where d.deleted_at is null and d.status = 'won' and d.won_at >= $1 and d.won_at < $2
             group by 1, 2 order by 3 desc limit 15",
        ),
        money(
            "select initcap(replace(coalesce(sv.category, 'other'), '_', ' ')) as label, s.currency,
                    sum(case s.billing_type when 'monthly' then s.price when 'quarterly' then round(s.price / 3, 2)
                        when 'yearly' then round(s.price / 12, 2) else 0 end) as amount, count(*) as count
             from public.client_services s join public.clients cl on cl.id = s.client_id
             left join public.services sv on sv.id = s.service_id
             where cl.deleted_at is null and s.status = 'active' and $1::timestamptz is not null and $2::timestamptz is not null
             group by 1, 2 order by 3 desc",
        ),
    )?;
    Ok(Json(FinanceReport {
        range: r,
        won,
        recurring_monthly,
        active_contracts,
        proposals_pending,
        revenue_trend,
        top_clients,
        by_service_category,
        note: "Amounts are shown per currency. ODDLY never adds different currencies together without a documented conversion rate.",
    }))
}

// ---------------------------------------------------------------------------
// Team performance
// ---------------------------------------------------------------------------

#[derive(Serialize, sqlx::FromRow)]
pub struct MemberPerformance {
    id: Uuid,
    full_name: String,
    tasks_completed: i64,
    tasks_overdue: i64,
    tasks_on_time: i64,
    leads_handled: i64,
    interactions: i64,
    follow_ups_done: i64,
    deals_won: i64,
    projects_completed: i64,
    projects_owned: i64,
    content_published: i64,
    maintenance_done: i64,
}

#[derive(Serialize)]
pub struct TeamReport {
    range: Range,
    members: Vec<MemberPerformance>,
}

pub async fn team(State(state): State<AppState>, user: AuthUser, Query(q): Query<RangeQuery>) -> AppResult<Json<TeamReport>> {
    user.require("analytics.view")?;
    user.require("team.view")?;
    let db = &state.db;
    let r = range(db, &user, &q).await?;
    let members = sqlx::query_as::<_, MemberPerformance>(
        "select p.id, p.full_name,
           (select count(*) from public.tasks t where t.assignee_id = p.id and t.deleted_at is null and t.completed_at >= $1 and t.completed_at < $2) as tasks_completed,
           (select count(*) from public.tasks t where t.assignee_id = p.id and t.deleted_at is null and t.status <> 'done' and t.due_at < now()) as tasks_overdue,
           (select count(*) from public.tasks t where t.assignee_id = p.id and t.deleted_at is null and t.completed_at >= $1 and t.completed_at < $2
              and (t.due_at is null or t.completed_at <= t.due_at)) as tasks_on_time,
           (select count(distinct i.lead_id) from public.lead_interactions i where i.user_id = p.id and i.occurred_at >= $1 and i.occurred_at < $2) as leads_handled,
           (select count(*) from public.lead_interactions i where i.user_id = p.id and i.occurred_at >= $1 and i.occurred_at < $2) as interactions,
           (select count(*) from public.follow_ups f where f.completed_by = p.id and f.completed_at >= $1 and f.completed_at < $2) as follow_ups_done,
           (select count(*) from public.deals d where d.owner_id = p.id and d.deleted_at is null and d.status = 'won' and d.won_at >= $1 and d.won_at < $2) as deals_won,
           (select count(*) from public.projects pr where pr.owner_id = p.id and pr.deleted_at is null and pr.completed_at >= $1 and pr.completed_at < $2) as projects_completed,
           (select count(*) from public.projects pr where pr.owner_id = p.id and pr.deleted_at is null) as projects_owned,
           (select count(*) from public.content_posts c where (c.creator_id = p.id or c.designer_id = p.id) and c.deleted_at is null
              and c.published_at >= $1 and c.published_at < $2) as content_published,
           (select count(*) from public.website_maintenance m where m.completed_by = p.id and m.completed_at >= $1 and m.completed_at < $2) as maintenance_done
         from public.profiles p where p.status = 'active' order by lower(p.full_name)",
    )
    .bind(r.start)
    .bind(r.end)
    .fetch_all(db)
    .await?;
    Ok(Json(TeamReport { range: r, members }))
}
