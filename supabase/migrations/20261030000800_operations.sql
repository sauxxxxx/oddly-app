-- Phase 5: agency operations — project deliverables, website monitoring history,
-- de-duplicated reminder alerts.

alter table public.projects add column deliverables text[] not null default '{}';

-- One row per uptime check (kept 30 days by the API's monitor).
create table public.website_checks (
  id          bigint generated always as identity primary key,
  website_id  uuid not null references public.websites (id) on delete cascade,
  checked_at  timestamptz not null default now(),
  ok          boolean not null,
  status_code integer,
  response_ms integer,
  error       text
);

create index website_checks_website_idx on public.website_checks (website_id, checked_at desc);

-- Remembers which renewal/expiry reminders were sent so they go out once per threshold.
create table public.sent_alerts (
  key     text primary key,
  sent_at timestamptz not null default now()
);

create index content_posts_designer_idx on public.content_posts (designer_id) where deleted_at is null;
create index content_posts_creator_idx on public.content_posts (creator_id) where deleted_at is null;
create index websites_expiry_idx on public.websites (domain_expires_on, hosting_renews_on, ssl_expires_on) where deleted_at is null;
create index comments_task_idx on public.comments (entity_id) where entity_type = 'task' and deleted_at is null;

alter table public.website_checks enable row level security;
alter table public.sent_alerts enable row level security;
