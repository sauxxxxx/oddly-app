-- Phase 2: lead management helpers — duplicate detection keys, saved filters,
-- import history and a flattened lead view for the API.

-- ---------------------------------------------------------------------------
-- Normalization used for duplicate detection
-- ---------------------------------------------------------------------------

-- "https://www.Example.com/about?x=1" -> "example.com"
create or replace function public.normalize_domain(url text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select nullif(
    regexp_replace(
      regexp_replace(lower(trim(coalesce(url, ''))), '^[a-z]+://', ''),
      '^www\.|[/?#:].*$', '', 'g'),
    '')
$$;

-- Keeps the last 10 digits so "+63 917 123 4567" and "0917-123-4567" match.
create or replace function public.normalize_phone(phone text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select nullif(right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10), '')
$$;

-- Lowercase, collapse punctuation and spaces: "Barili  Bakery, Inc." -> "barili bakery inc"
create or replace function public.normalize_name(name text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select nullif(trim(regexp_replace(lower(coalesce(name, '')), '[^a-z0-9]+', ' ', 'g')), '')
$$;

revoke execute on function public.normalize_domain(text) from anon, authenticated;
revoke execute on function public.normalize_phone(text) from anon, authenticated;
revoke execute on function public.normalize_name(text) from anon, authenticated;

create index companies_domain_idx on public.companies (public.normalize_domain(website_url))
  where deleted_at is null and website_url is not null;
create index companies_phone_idx on public.companies (public.normalize_phone(phone))
  where deleted_at is null and phone is not null;
create index companies_norm_name_idx on public.companies (public.normalize_name(name), lower(coalesce(city, '')))
  where deleted_at is null;
create index contacts_phone_idx on public.contacts (public.normalize_phone(phone))
  where deleted_at is null and phone is not null;

-- ---------------------------------------------------------------------------
-- Saved filters (per user, optionally shared with the team)
-- ---------------------------------------------------------------------------

create table public.saved_filters (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  module     text not null check (module in ('leads', 'clients', 'tasks', 'content')),
  name       text not null check (length(trim(name)) between 1 and 80),
  filters    jsonb not null default '{}'::jsonb,
  is_shared  boolean not null default false,
  created_at timestamptz not null default now()
);

create index saved_filters_user_idx on public.saved_filters (user_id, module);

-- ---------------------------------------------------------------------------
-- Import history (one row per spreadsheet import)
-- ---------------------------------------------------------------------------

create table public.import_jobs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references public.profiles (id) on delete set null,
  module      text not null default 'leads',
  file_name   text not null,
  mode        text not null check (mode in ('skip', 'update', 'create')),
  total_rows  integer not null default 0,
  created     integer not null default 0,
  updated     integer not null default 0,
  skipped     integer not null default 0,
  failed      integer not null default 0,
  errors      jsonb not null default '[]'::jsonb,
  started_at  timestamptz not null default now(),
  finished_at timestamptz
);

create index import_jobs_started_idx on public.import_jobs (started_at desc);

-- ---------------------------------------------------------------------------
-- Flattened lead view used by the API's list, detail and export endpoints.
-- security_invoker: anyone querying it is subject to the base tables' RLS
-- (which denies anon/authenticated), so the view can't leak data through the REST API.
-- ---------------------------------------------------------------------------

create view public.lead_overview
with (security_invoker = true)
as
select
  l.id,
  l.company_id,
  l.primary_contact_id,
  c.name             as business_name,
  c.industry,
  c.category,
  c.market,
  c.country,
  c.region,
  c.city,
  c.address,
  c.website_url,
  c.facebook_url,
  c.instagram_url,
  c.linkedin_url,
  c.google_maps_url,
  c.phone            as business_phone,
  c.email            as business_email,
  ct.full_name       as contact_name,
  ct.position        as contact_position,
  ct.email           as contact_email,
  ct.phone           as contact_phone,
  l.source_id,
  src.name           as source_name,
  l.source_detail,
  l.stage_id,
  st.name            as stage_name,
  st.color           as stage_color,
  st.kind            as stage_kind,
  l.status,
  l.priority,
  l.assigned_to,
  a.full_name        as assigned_name,
  l.potential_services,
  l.estimated_value,
  l.currency,
  l.research_notes,
  l.next_action,
  l.next_action_due_at,
  l.last_contacted_at,
  l.converted_at,
  l.lost_reason,
  l.created_by,
  l.created_at,
  l.updated_at,
  l.deleted_at
from public.leads l
join public.companies c on c.id = l.company_id
left join public.contacts ct on ct.id = l.primary_contact_id
left join public.lead_sources src on src.id = l.source_id
join public.pipeline_stages st on st.id = l.stage_id
left join public.profiles a on a.id = l.assigned_to;

revoke all on public.lead_overview from anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['saved_filters', 'import_jobs'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end;
$$;
