-- ODDLY foundation: identity, RBAC, audit, notifications, files, activity feed, comments.
--
-- Security model
--   * Every table has row level security enabled and NO policies, so the public
--     anon/authenticated keys used by supabase-js cannot read or write business data
--     through PostgREST. All data access goes through the ODDLY Rust API, which
--     connects as the table owner and enforces role-based permissions itself.
--   * auth.users (managed by Supabase Auth) holds credentials; public.profiles holds
--     ODDLY's own user data and is created automatically by a trigger.

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Entity kinds that polymorphic tables (activities, comments, files, notifications)
-- may point at. Extend with ALTER DOMAIN when new modules add entity kinds.
create domain public.entity_kind as text check (value in (
  'profile', 'company', 'contact', 'lead', 'lead_list', 'deal', 'proposal',
  'meeting', 'follow_up', 'client', 'contract', 'project', 'task',
  'content_post', 'website', 'file'
));

-- ---------------------------------------------------------------------------
-- Profiles (one per Supabase Auth user)
-- ---------------------------------------------------------------------------

create table public.profiles (
  id                   uuid primary key references auth.users (id) on delete cascade,
  email                text not null,
  full_name            text not null,
  job_title            text,
  phone                text,
  timezone             text not null default 'Asia/Manila',
  status               text not null default 'active'
                         check (status in ('active', 'suspended')),
  must_change_password boolean not null default false,
  last_seen_at         timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  deactivated_at       timestamptz
);

create unique index profiles_email_key on public.profiles (lower(email));

-- ---------------------------------------------------------------------------
-- Roles & permissions
-- ---------------------------------------------------------------------------

create table public.roles (
  id          uuid primary key default gen_random_uuid(),
  key         text not null unique,
  name        text not null,
  description text,
  is_system   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.permissions (
  id          uuid primary key default gen_random_uuid(),
  key         text not null unique,
  module      text not null,
  description text not null
);

create table public.role_permissions (
  role_id       uuid not null references public.roles (id) on delete cascade,
  permission_id uuid not null references public.permissions (id) on delete cascade,
  primary key (role_id, permission_id)
);

create table public.user_roles (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  role_id     uuid not null references public.roles (id) on delete restrict,
  assigned_by uuid references public.profiles (id) on delete set null,
  assigned_at timestamptz not null default now(),
  primary key (user_id, role_id)
);

create index user_roles_role_id_idx on public.user_roles (role_id);

insert into public.roles (key, name, description, is_system) values
  ('super_admin',     'Super Admin',          'Full access, including managing other administrators.', true),
  ('admin',           'Administrator',        'Manages the agency workspace, team and settings.',      true),
  ('sales_rep',       'Sales Representative', 'Finds leads, runs outreach and closes deals.',          true),
  ('account_manager', 'Account Manager',      'Owns client relationships and delivery.',               true),
  ('designer',        'Designer',             'Produces graphics and creative assets.',                true),
  ('content_creator', 'Content Creator',      'Plans and writes client content.',                      true),
  ('developer',       'Developer',            'Builds and maintains client websites.',                 true);

insert into public.permissions (key, module, description) values
  ('dashboard.view',    'dashboard', 'View the dashboard'),
  ('leads.view',        'leads',     'View leads assigned to them'),
  ('leads.view_all',    'leads',     'View every lead in the workspace'),
  ('leads.create',      'leads',     'Create leads'),
  ('leads.edit',        'leads',     'Edit leads'),
  ('leads.delete',      'leads',     'Delete leads'),
  ('leads.import',      'leads',     'Import leads from spreadsheets'),
  ('leads.export',      'leads',     'Export leads'),
  ('pipeline.manage',   'sales',     'Customize pipeline stages'),
  ('sales.view',        'sales',     'View pipeline, interactions, follow-ups and meetings'),
  ('sales.manage',      'sales',     'Log interactions, schedule follow-ups and meetings, manage deals'),
  ('proposals.view',    'sales',     'View proposals'),
  ('proposals.manage',  'sales',     'Create and edit proposals'),
  ('clients.view',      'clients',   'View clients'),
  ('clients.manage',    'clients',   'Create and edit clients, services and contracts'),
  ('content.view',      'content',   'View the content studio'),
  ('content.manage',    'content',   'Create and edit content and media'),
  ('content.approve',   'content',   'Approve or reject content'),
  ('websites.view',     'websites',  'View client websites'),
  ('websites.manage',   'websites',  'Edit websites and maintenance'),
  ('websites.secrets',  'websites',  'Reveal encrypted website credentials'),
  ('projects.view',     'projects',  'View projects and tasks'),
  ('projects.manage',   'projects',  'Create and edit projects and assign tasks'),
  ('analytics.view',    'analytics', 'View analytics'),
  ('finance.view',      'analytics', 'View revenue and financial figures'),
  ('ai.use',            'ai',        'Use the AI assistant'),
  ('activity.view_all', 'team',      'View the whole team''s activity feed'),
  ('team.view',         'team',      'View team members'),
  ('team.manage',       'team',      'Add, edit and suspend team members'),
  ('roles.manage',      'team',      'Edit roles and permissions'),
  ('settings.manage',   'settings',  'Change workspace settings'),
  ('audit.view',        'settings',  'View audit logs');

-- Administrators get every permission.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.key in ('super_admin', 'admin');

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from (values
  ('sales_rep', 'dashboard.view'), ('sales_rep', 'leads.view'), ('sales_rep', 'leads.create'),
  ('sales_rep', 'leads.edit'), ('sales_rep', 'leads.import'), ('sales_rep', 'leads.export'),
  ('sales_rep', 'sales.view'), ('sales_rep', 'sales.manage'), ('sales_rep', 'proposals.view'),
  ('sales_rep', 'proposals.manage'), ('sales_rep', 'clients.view'), ('sales_rep', 'analytics.view'),
  ('sales_rep', 'ai.use'), ('sales_rep', 'team.view'),

  ('account_manager', 'dashboard.view'), ('account_manager', 'leads.view'), ('account_manager', 'leads.view_all'),
  ('account_manager', 'sales.view'), ('account_manager', 'sales.manage'), ('account_manager', 'proposals.view'),
  ('account_manager', 'proposals.manage'), ('account_manager', 'clients.view'), ('account_manager', 'clients.manage'),
  ('account_manager', 'content.view'), ('account_manager', 'content.approve'), ('account_manager', 'websites.view'),
  ('account_manager', 'projects.view'), ('account_manager', 'projects.manage'), ('account_manager', 'analytics.view'),
  ('account_manager', 'finance.view'), ('account_manager', 'ai.use'), ('account_manager', 'activity.view_all'),
  ('account_manager', 'team.view'),

  ('designer', 'dashboard.view'), ('designer', 'clients.view'), ('designer', 'content.view'),
  ('designer', 'content.manage'), ('designer', 'projects.view'), ('designer', 'ai.use'), ('designer', 'team.view'),

  ('content_creator', 'dashboard.view'), ('content_creator', 'clients.view'), ('content_creator', 'content.view'),
  ('content_creator', 'content.manage'), ('content_creator', 'projects.view'), ('content_creator', 'ai.use'),
  ('content_creator', 'team.view'),

  ('developer', 'dashboard.view'), ('developer', 'clients.view'), ('developer', 'websites.view'),
  ('developer', 'websites.manage'), ('developer', 'websites.secrets'), ('developer', 'projects.view'),
  ('developer', 'ai.use'), ('developer', 'team.view')
) as m (role_key, permission_key)
join public.roles r on r.key = m.role_key
join public.permissions p on p.key = m.permission_key;

-- ---------------------------------------------------------------------------
-- Sync Supabase Auth users into profiles
-- ---------------------------------------------------------------------------

-- Creates a profile for every new auth user. The very first account in the
-- workspace becomes Super Admin; everyone after that gets roles from an admin.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  is_first boolean;
begin
  perform pg_advisory_xact_lock(hashtext('oddly.bootstrap_owner'));

  select not exists (select 1 from public.profiles) into is_first;

  insert into public.profiles (id, email, full_name, must_change_password)
  values (
    new.id,
    new.email,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1)),
    coalesce((new.raw_user_meta_data ->> 'must_change_password')::boolean, false)
  );

  if is_first then
    insert into public.user_roles (user_id, role_id)
    select new.id, r.id from public.roles r where r.key = 'super_admin';
  end if;

  return new;
end;
$$;

create or replace function public.handle_auth_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end;
$$;

revoke execute on function public.handle_new_auth_user() from public, anon, authenticated;
revoke execute on function public.handle_auth_user_email_change() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row
  when (old.email is distinct from new.email)
  execute function public.handle_auth_user_email_change();

-- ---------------------------------------------------------------------------
-- Files (objects live in Supabase Storage; this table is the access-controlled index)
-- ---------------------------------------------------------------------------

create table public.files (
  id              uuid primary key default gen_random_uuid(),
  bucket          text not null,
  storage_path    text not null,
  original_name   text not null,
  content_type    text not null,
  size_bytes      bigint not null check (size_bytes >= 0),
  checksum_sha256 text,
  category        text,
  entity_type     public.entity_kind,
  entity_id       uuid,
  uploaded_by     uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  unique (bucket, storage_path)
);

create index files_entity_idx on public.files (entity_type, entity_id) where deleted_at is null;

-- ---------------------------------------------------------------------------
-- Activity feed, comments, notifications, audit log
-- ---------------------------------------------------------------------------

-- Human-readable timeline events ("Anna moved Cebu Resort to Interested").
create table public.activities (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid references public.profiles (id) on delete set null,
  entity_type public.entity_kind not null,
  entity_id   uuid not null,
  action      text not null,
  summary     text not null,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index activities_entity_idx on public.activities (entity_type, entity_id, created_at desc);
create index activities_created_at_idx on public.activities (created_at desc);
create index activities_actor_idx on public.activities (actor_id, created_at desc);

create table public.comments (
  id          uuid primary key default gen_random_uuid(),
  entity_type public.entity_kind not null,
  entity_id   uuid not null,
  parent_id   uuid references public.comments (id) on delete cascade,
  author_id   uuid references public.profiles (id) on delete set null,
  body        text not null check (length(body) between 1 and 10000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create index comments_entity_idx on public.comments (entity_type, entity_id, created_at) where deleted_at is null;

create table public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  kind        text not null,
  title       text not null,
  body        text,
  entity_type public.entity_kind,
  entity_id   uuid,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index notifications_user_idx on public.notifications (user_id, created_at desc);
create index notifications_unread_idx on public.notifications (user_id) where read_at is null;

-- Security audit trail: who changed what. Append-only from the API.
create table public.audit_logs (
  id          bigint generated always as identity primary key,
  actor_id    uuid references public.profiles (id) on delete set null,
  action      text not null,
  entity_type text,
  entity_id   uuid,
  changes     jsonb,
  ip_address  text,
  created_at  timestamptz not null default now()
);

create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id);
create index audit_logs_actor_idx on public.audit_logs (actor_id, created_at desc);
create index audit_logs_created_at_idx on public.audit_logs (created_at desc);

-- ---------------------------------------------------------------------------
-- updated_at triggers + RLS
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['profiles', 'roles', 'comments'] loop
    execute format(
      'create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t);
  end loop;

  foreach t in array array[
    'profiles', 'roles', 'permissions', 'role_permissions', 'user_roles', 'files',
    'activities', 'comments', 'notifications', 'audit_logs'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end;
$$;
