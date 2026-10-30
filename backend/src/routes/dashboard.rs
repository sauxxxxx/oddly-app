//! Dashboard summary: every figure comes from live records, scoped to what the
//! signed-in user may see. Sections the user has no permission for are `null`.

use std::collections::{BTreeMap, BTreeSet};

use axum::{
    extract::{Query, State},
    Json,
};
use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    auth::{perm, AuthUser},
    error::{AppError, AppResult},
    state::AppState,
};

const MAX_RANGE_DAYS: i64 = 731;

#[derive(Deserialize)]
pub struct RangeQuery {
    from: Option<NaiveDate>,
    to: Option<NaiveDate>,
}

#[derive(Serialize)]
pub struct DashboardSummary {
    range: RangeInfo,
    stats: Stats,
    lead_trend: Vec<LeadTrendPoint>,
    lead_sources: Vec<LeadSourceCount>,
    pipeline: Vec<PipelineStageCount>,
    conversion: Conversion,
    revenue: Option<Vec<CurrencyAmount>>,
    revenue_trend: Option<RevenueTrend>,
    client_growth: Option<Vec<ClientGrowthPoint>>,
    recent_activities: Vec<ActivityItem>,
    upcoming_follow_ups: Option<Vec<FollowUpItem>>,
    todays_meetings: Option<Vec<MeetingItem>>,
    my_tasks: Vec<TaskItem>,
    pending_approvals: Option<Vec<ApprovalItem>>,
    recent_proposals: Option<Vec<ProposalItem>>,
    project_progress: Option<Vec<ProjectProgress>>,
    insights: Insights,
}

#[derive(Serialize)]
struct RangeInfo {
    from: NaiveDate,
    to: NaiveDate,
    bucket: &'static str,
    timezone: String,
}

#[derive(Serialize, Default)]
struct Stats {
    total_leads: i64,
    new_leads: i64,
    new_leads_previous: i64,
    active_clients: Option<i64>,
    pending_proposals: Option<i64>,
    won_deals: Option<i64>,
    won_deals_previous: Option<i64>,
}

#[derive(sqlx::FromRow)]
struct StatsRow {
    total_leads: i64,
    new_leads: i64,
    new_leads_previous: i64,
    active_clients: i64,
    pending_proposals: i64,
    won_deals: i64,
    won_deals_previous: i64,
}

#[derive(Serialize, sqlx::FromRow)]
struct LeadTrendPoint {
    bucket: NaiveDate,
    local: i64,
    international: i64,
}

#[derive(Serialize, sqlx::FromRow)]
struct LeadSourceCount {
    source: String,
    count: i64,
}

#[derive(Serialize, sqlx::FromRow)]
struct PipelineStageCount {
    id: Uuid,
    name: String,
    kind: String,
    color: String,
    count: i64,
}

#[derive(Serialize, sqlx::FromRow)]
struct Conversion {
    /// Leads created in the range.
    cohort: i64,
    /// …of which have been contacted at least once.
    contacted: i64,
    /// …of which became clients.
    converted: i64,
    /// Deals closed in the range.
    deals_won: i64,
    deals_lost: i64,
}

/// Revenue is always reported per currency; amounts in different currencies are never summed.
#[derive(Serialize, sqlx::FromRow)]
struct CurrencyAmount {
    currency: String,
    amount: Decimal,
    previous_amount: Decimal,
    deals: i64,
}

#[derive(Serialize)]
struct RevenueTrend {
    currencies: Vec<String>,
    points: Vec<RevenuePoint>,
}

#[derive(Serialize)]
struct RevenuePoint {
    bucket: NaiveDate,
    amounts: BTreeMap<String, Decimal>,
}

#[derive(sqlx::FromRow)]
struct RevenueRow {
    bucket: NaiveDate,
    currency: String,
    amount: Decimal,
}

#[derive(Serialize)]
struct ClientGrowthPoint {
    bucket: NaiveDate,
    new_clients: i64,
    total_clients: i64,
}

#[derive(sqlx::FromRow)]
struct ClientGrowthRow {
    bucket: NaiveDate,
    new_clients: i64,
}

#[derive(Serialize, sqlx::FromRow)]
struct ActivityItem {
    id: Uuid,
    action: String,
    summary: String,
    entity_type: String,
    entity_id: Uuid,
    actor_name: Option<String>,
    created_at: DateTime<Utc>,
}

#[derive(Serialize, sqlx::FromRow)]
struct FollowUpItem {
    id: Uuid,
    title: String,
    due_at: DateTime<Utc>,
    priority: String,
    overdue: bool,
    related_type: Option<String>,
    related_name: Option<String>,
}

#[derive(Serialize, sqlx::FromRow)]
struct MeetingItem {
    id: Uuid,
    title: String,
    starts_at: DateTime<Utc>,
    ends_at: Option<DateTime<Utc>>,
    location: Option<String>,
    meeting_url: Option<String>,
    status: String,
    related_name: Option<String>,
}

#[derive(Serialize, sqlx::FromRow)]
struct TaskItem {
    id: Uuid,
    title: String,
    status: String,
    priority: String,
    due_at: Option<DateTime<Utc>>,
    overdue: bool,
    project_name: Option<String>,
}

#[derive(Serialize, sqlx::FromRow)]
struct ApprovalItem {
    id: Uuid,
    title: String,
    platform: String,
    publish_at: Option<DateTime<Utc>>,
    stage_key: String,
    stage_name: String,
    stage_color: String,
    client_name: String,
}

#[derive(Serialize, sqlx::FromRow)]
struct ProposalItem {
    id: Uuid,
    number: String,
    title: String,
    status: String,
    total: Decimal,
    currency: String,
    company_name: String,
    updated_at: DateTime<Utc>,
}

#[derive(Serialize, sqlx::FromRow)]
struct ProjectProgress {
    id: Uuid,
    name: String,
    status: String,
    deadline: Option<NaiveDate>,
    client_name: Option<String>,
    total_tasks: i64,
    done_tasks: i64,
}

#[derive(Serialize)]
struct Insights {
    configured: bool,
    items: Vec<String>,
}

#[derive(sqlx::FromRow)]
struct Clock {
    today: NaiveDate,
    today_start: DateTime<Utc>,
    today_end: DateTime<Utc>,
}

#[derive(sqlx::FromRow)]
struct Bounds {
    start_at: DateTime<Utc>,
    end_at: DateTime<Utc>,
}

pub async fn summary(
    State(state): State<AppState>,
    user: AuthUser,
    Query(q): Query<RangeQuery>,
) -> AppResult<Json<DashboardSummary>> {
    user.require(perm::DASHBOARD_VIEW)?;
    let db = &state.db;
    let tz = user.timezone.as_str();

    let clock = sqlx::query_as::<_, Clock>(
        "select (now() at time zone $1)::date as today,
                ((now() at time zone $1)::date::timestamp at time zone $1) as today_start,
                (((now() at time zone $1)::date + 1)::timestamp at time zone $1) as today_end",
    )
    .bind(tz)
    .fetch_one(db)
    .await?;

    let to = q.to.unwrap_or(clock.today);
    let from = q.from.unwrap_or(to - chrono::Duration::days(29));
    if from > to {
        return Err(AppError::BadRequest("The start date must be before the end date.".into()));
    }
    let days = (to - from).num_days() + 1;
    if days > MAX_RANGE_DAYS {
        return Err(AppError::BadRequest("Choose a date range of two years or less.".into()));
    }
    let bucket: &'static str = match days {
        ..=45 => "day",
        46..=200 => "week",
        _ => "month",
    };

    let bounds = sqlx::query_as::<_, Bounds>(
        "select ($1::date::timestamp at time zone $3) as start_at,
                (($2::date + 1)::timestamp at time zone $3) as end_at",
    )
    .bind(from)
    .bind(to)
    .bind(tz)
    .fetch_one(db)
    .await?;
    let (start, end) = (bounds.start_at, bounds.end_at);
    let prev_start = start - (end - start);

    // Record-level scoping: without leads.view_all a user only sees their own leads.
    let all_leads = user.can(perm::LEADS_VIEW_ALL);
    let uid = user.id;

    let can_finance = user.can(perm::FINANCE_VIEW);
    let can_clients = user.can(perm::CLIENTS_VIEW);
    let can_proposals = user.can(perm::PROPOSALS_VIEW);
    let can_sales = user.can(perm::SALES_VIEW);
    let can_content = user.can(perm::CONTENT_VIEW);
    let can_projects = user.can(perm::PROJECTS_VIEW);
    let all_activity = user.can(perm::ACTIVITY_VIEW_ALL);

    let stats_q = sqlx::query_as::<_, StatsRow>(
        r#"
        with scoped_leads as (
          select l.created_at from public.leads l
          where l.deleted_at is null and ($1 or l.assigned_to = $2)
        )
        select
          (select count(*) from scoped_leads) as total_leads,
          (select count(*) from scoped_leads where created_at >= $3 and created_at < $4) as new_leads,
          (select count(*) from scoped_leads where created_at >= $5 and created_at < $3) as new_leads_previous,
          (select count(*) from public.clients c
             where c.deleted_at is null
               and c.status in ('onboarding', 'active', 'awaiting_client', 'needs_attention', 'at_risk')) as active_clients,
          (select count(*) from public.proposals p
             where p.deleted_at is null and p.status in ('ready', 'sent')) as pending_proposals,
          (select count(*) from public.deals d
             where d.deleted_at is null and d.status = 'won' and d.won_at >= $3 and d.won_at < $4) as won_deals,
          (select count(*) from public.deals d
             where d.deleted_at is null and d.status = 'won' and d.won_at >= $5 and d.won_at < $3) as won_deals_previous
        "#,
    )
    .bind(all_leads)
    .bind(uid)
    .bind(start)
    .bind(end)
    .bind(prev_start)
    .fetch_one(db);

    let lead_trend_q = sqlx::query_as::<_, LeadTrendPoint>(
        r#"
        with buckets as (
          select generate_series(date_trunc($1, $2::date::timestamp),
                                 date_trunc($1, $3::date::timestamp),
                                 ('1 ' || $1)::interval) as bucket
        ),
        scoped as (
          select date_trunc($1, l.created_at at time zone $4) as bucket, c.market
          from public.leads l
          join public.companies c on c.id = l.company_id
          where l.deleted_at is null and l.created_at >= $5 and l.created_at < $6
            and ($7 or l.assigned_to = $8)
        )
        select b.bucket::date as bucket,
               count(s.bucket) filter (where s.market = 'local') as local,
               count(s.bucket) filter (where s.market = 'international') as international
        from buckets b
        left join scoped s on s.bucket = b.bucket
        group by b.bucket
        order by b.bucket
        "#,
    )
    .bind(bucket)
    .bind(from)
    .bind(to)
    .bind(tz)
    .bind(start)
    .bind(end)
    .bind(all_leads)
    .bind(uid)
    .fetch_all(db);

    let sources_q = sqlx::query_as::<_, LeadSourceCount>(
        "select coalesce(s.name, 'Unspecified') as source, count(*) as count
         from public.leads l
         left join public.lead_sources s on s.id = l.source_id
         where l.deleted_at is null and l.created_at >= $1 and l.created_at < $2
           and ($3 or l.assigned_to = $4)
         group by 1
         order by 2 desc, 1",
    )
    .bind(start)
    .bind(end)
    .bind(all_leads)
    .bind(uid)
    .fetch_all(db);

    let pipeline_q = sqlx::query_as::<_, PipelineStageCount>(
        "select s.id, s.name, s.kind, s.color, count(l.id) as count
         from public.pipeline_stages s
         left join public.leads l on l.stage_id = s.id and l.deleted_at is null
                                  and ($1 or l.assigned_to = $2)
         where s.archived_at is null
         group by s.id
         order by s.position",
    )
    .bind(all_leads)
    .bind(uid)
    .fetch_all(db);

    let conversion_q = sqlx::query_as::<_, Conversion>(
        r#"
        select
          count(*) as cohort,
          count(*) filter (where l.last_contacted_at is not null) as contacted,
          count(*) filter (where l.status = 'converted') as converted,
          (select count(*) from public.deals d
             where d.deleted_at is null and d.status = 'won' and d.won_at >= $1 and d.won_at < $2) as deals_won,
          (select count(*) from public.deals d
             where d.deleted_at is null and d.status = 'lost' and d.lost_at >= $1 and d.lost_at < $2) as deals_lost
        from public.leads l
        where l.deleted_at is null and l.created_at >= $1 and l.created_at < $2
          and ($3 or l.assigned_to = $4)
        "#,
    )
    .bind(start)
    .bind(end)
    .bind(all_leads)
    .bind(uid)
    .fetch_one(db);

    let revenue_q = async {
        if !can_finance {
            return Ok(None);
        }
        sqlx::query_as::<_, CurrencyAmount>(
            "select currency,
                    coalesce(sum(value) filter (where won_at >= $1), 0) as amount,
                    coalesce(sum(value) filter (where won_at < $1), 0) as previous_amount,
                    count(*) filter (where won_at >= $1) as deals
             from public.deals
             where deleted_at is null and status = 'won' and won_at >= $3 and won_at < $2
             group by currency
             order by amount desc, currency",
        )
        .bind(start)
        .bind(end)
        .bind(prev_start)
        .fetch_all(db)
        .await
        .map(Some)
    };

    let revenue_trend_q = async {
        if !can_finance {
            return Ok(None);
        }
        sqlx::query_as::<_, RevenueRow>(
            "select date_trunc($1, d.won_at at time zone $2)::date as bucket, d.currency,
                    sum(d.value) as amount
             from public.deals d
             where d.deleted_at is null and d.status = 'won' and d.won_at >= $3 and d.won_at < $4
             group by 1, 2
             order by 1, 2",
        )
        .bind(bucket)
        .bind(tz)
        .bind(start)
        .bind(end)
        .fetch_all(db)
        .await
        .map(Some)
    };

    let client_growth_q = async {
        if !can_clients {
            return Ok(None);
        }
        let base: i64 = sqlx::query_scalar(
            "select count(*) from public.clients where deleted_at is null and client_since < $1",
        )
        .bind(from)
        .fetch_one(db)
        .await?;
        let rows = sqlx::query_as::<_, ClientGrowthRow>(
            r#"
            with buckets as (
              select generate_series(date_trunc($1, $2::date::timestamp),
                                     date_trunc($1, $3::date::timestamp),
                                     ('1 ' || $1)::interval) as bucket
            )
            select b.bucket::date as bucket, count(c.id) as new_clients
            from buckets b
            left join public.clients c
              on c.deleted_at is null
             and c.client_since between $2 and $3
             and date_trunc($1, c.client_since::timestamp) = b.bucket
            group by b.bucket
            order by b.bucket
            "#,
        )
        .bind(bucket)
        .bind(from)
        .bind(to)
        .fetch_all(db)
        .await?;

        let mut total = base;
        Ok::<_, sqlx::Error>(Some(
            rows.into_iter()
                .map(|r| {
                    total += r.new_clients;
                    ClientGrowthPoint { bucket: r.bucket, new_clients: r.new_clients, total_clients: total }
                })
                .collect::<Vec<_>>(),
        ))
    };

    let activities_q = sqlx::query_as::<_, ActivityItem>(
        "select a.id, a.action, a.summary, a.entity_type::text as entity_type, a.entity_id,
                p.full_name as actor_name, a.created_at
         from public.activities a
         left join public.profiles p on p.id = a.actor_id
         where ($1 or a.actor_id = $2)
         order by a.created_at desc
         limit 8",
    )
    .bind(all_activity)
    .bind(uid)
    .fetch_all(db);

    let follow_ups_q = async {
        if !can_sales {
            return Ok(None);
        }
        sqlx::query_as::<_, FollowUpItem>(
            r#"
            select f.id, f.title, f.due_at, f.priority, (f.due_at < now()) as overdue,
                   case when f.lead_id is not null then 'lead'
                        when f.deal_id is not null then 'deal'
                        when f.client_id is not null then 'client' end as related_type,
                   coalesce(lc.name, dc.name, cc.name) as related_name
            from public.follow_ups f
            left join public.leads l on l.id = f.lead_id
            left join public.companies lc on lc.id = l.company_id
            left join public.deals d on d.id = f.deal_id
            left join public.companies dc on dc.id = d.company_id
            left join public.clients c on c.id = f.client_id
            left join public.companies cc on cc.id = c.company_id
            where f.status = 'pending' and f.assigned_to = $1
            order by f.due_at
            limit 8
            "#,
        )
        .bind(uid)
        .fetch_all(db)
        .await
        .map(Some)
    };

    let meetings_q = async {
        if !can_sales {
            return Ok(None);
        }
        sqlx::query_as::<_, MeetingItem>(
            r#"
            select m.id, m.title, m.starts_at, m.ends_at, m.location, m.meeting_url, m.status,
                   coalesce(lc.name, cc.name) as related_name
            from public.meetings m
            left join public.leads l on l.id = m.lead_id
            left join public.companies lc on lc.id = l.company_id
            left join public.clients c on c.id = m.client_id
            left join public.companies cc on cc.id = c.company_id
            where m.deleted_at is null and m.status <> 'cancelled'
              and m.starts_at >= $2 and m.starts_at < $3
              and (m.organizer_id = $1 or exists (
                    select 1 from public.meeting_participants mp
                    where mp.meeting_id = m.id and mp.user_id = $1))
            order by m.starts_at
            "#,
        )
        .bind(uid)
        .bind(clock.today_start)
        .bind(clock.today_end)
        .fetch_all(db)
        .await
        .map(Some)
    };

    let tasks_q = sqlx::query_as::<_, TaskItem>(
        "select t.id, t.title, t.status, t.priority, t.due_at,
                (t.due_at is not null and t.due_at < now()) as overdue,
                p.name as project_name
         from public.tasks t
         left join public.projects p on p.id = t.project_id
         where t.deleted_at is null and t.assignee_id = $1 and t.status <> 'done'
         order by t.due_at asc nulls last, t.created_at desc
         limit 8",
    )
    .bind(uid)
    .fetch_all(db);

    let approvals_q = async {
        if !can_content {
            return Ok(None);
        }
        sqlx::query_as::<_, ApprovalItem>(
            "select cp.id, cp.title, cp.platform, cp.publish_at,
                    s.key as stage_key, s.name as stage_name, s.color as stage_color,
                    co.name as client_name
             from public.content_posts cp
             join public.content_workflow_stages s on s.id = cp.stage_id
             join public.clients c on c.id = cp.client_id
             join public.companies co on co.id = c.company_id
             where cp.deleted_at is null and s.key in ('internal_review', 'client_approval')
             order by cp.publish_at asc nulls last
             limit 6",
        )
        .fetch_all(db)
        .await
        .map(Some)
    };

    let proposals_q = async {
        if !can_proposals {
            return Ok(None);
        }
        sqlx::query_as::<_, ProposalItem>(
            "select p.id, p.number, p.title, p.status, p.total, p.currency,
                    co.name as company_name, p.updated_at
             from public.proposals p
             join public.companies co on co.id = p.company_id
             where p.deleted_at is null
             order by p.updated_at desc
             limit 6",
        )
        .fetch_all(db)
        .await
        .map(Some)
    };

    let projects_q = async {
        if !can_projects {
            return Ok(None);
        }
        sqlx::query_as::<_, ProjectProgress>(
            "select pr.id, pr.name, pr.status, pr.deadline, co.name as client_name,
                    count(t.id) as total_tasks,
                    count(t.id) filter (where t.status = 'done') as done_tasks
             from public.projects pr
             left join public.clients c on c.id = pr.client_id
             left join public.companies co on co.id = c.company_id
             left join public.tasks t on t.project_id = pr.id and t.deleted_at is null
             where pr.deleted_at is null and pr.status in ('planning', 'active', 'on_hold')
             group by pr.id, co.name
             order by pr.deadline asc nulls last, pr.created_at desc
             limit 6",
        )
        .fetch_all(db)
        .await
        .map(Some)
    };

    let (
        stats,
        lead_trend,
        lead_sources,
        pipeline,
        conversion,
        revenue,
        revenue_rows,
        client_growth,
        recent_activities,
        upcoming_follow_ups,
        todays_meetings,
        my_tasks,
        pending_approvals,
        recent_proposals,
        project_progress,
    ) = tokio::try_join!(
        stats_q,
        lead_trend_q,
        sources_q,
        pipeline_q,
        conversion_q,
        revenue_q,
        revenue_trend_q,
        client_growth_q,
        activities_q,
        follow_ups_q,
        meetings_q,
        tasks_q,
        approvals_q,
        proposals_q,
        projects_q,
    )?;

    let revenue_trend = revenue_rows.map(|rows| pivot_revenue(&lead_trend, rows));

    Ok(Json(DashboardSummary {
        range: RangeInfo { from, to, bucket, timezone: user.timezone.clone() },
        stats: Stats {
            total_leads: stats.total_leads,
            new_leads: stats.new_leads,
            new_leads_previous: stats.new_leads_previous,
            active_clients: can_clients.then_some(stats.active_clients),
            pending_proposals: can_proposals.then_some(stats.pending_proposals),
            won_deals: can_sales.then_some(stats.won_deals),
            won_deals_previous: can_sales.then_some(stats.won_deals_previous),
        },
        lead_trend,
        lead_sources,
        pipeline,
        conversion,
        revenue,
        revenue_trend,
        client_growth,
        recent_activities,
        upcoming_follow_ups,
        todays_meetings,
        my_tasks,
        pending_approvals,
        recent_proposals,
        project_progress,
        insights: Insights {
            configured: state.config.openai_api_key.is_some() && user.can(perm::AI_USE),
            items: Vec::new(),
        },
    }))
}

/// Turns sparse (bucket, currency, amount) rows into one point per bucket with a zero
/// for every currency that had no revenue in it.
fn pivot_revenue(buckets: &[LeadTrendPoint], rows: Vec<RevenueRow>) -> RevenueTrend {
    let currencies: BTreeSet<String> = rows.iter().map(|r| r.currency.clone()).collect();
    let mut by_bucket: BTreeMap<NaiveDate, BTreeMap<String, Decimal>> = buckets
        .iter()
        .map(|b| (b.bucket, currencies.iter().map(|c| (c.clone(), Decimal::ZERO)).collect()))
        .collect();
    for row in rows {
        by_bucket.entry(row.bucket).or_default().insert(row.currency, row.amount);
    }
    RevenueTrend {
        currencies: currencies.into_iter().collect(),
        points: by_bucket.into_iter().map(|(bucket, amounts)| RevenuePoint { bucket, amounts }).collect(),
    }
}
