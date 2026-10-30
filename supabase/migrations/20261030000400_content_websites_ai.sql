-- ODDLY content studio, website management, AI assistant history, storage buckets.

-- ---------------------------------------------------------------------------
-- Content studio
-- ---------------------------------------------------------------------------

-- Customizable workflow. `key` is stable for system logic (e.g. which stage means
-- "waiting for client approval"); `name` and `color` are free to change.
create table public.content_workflow_stages (
  id          uuid primary key default gen_random_uuid(),
  key         text not null unique,
  name        text not null,
  position    integer not null,
  color       text not null default '#A855F7',
  is_terminal boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  archived_at timestamptz
);

insert into public.content_workflow_stages (key, name, position, color, is_terminal) values
  ('idea',              'Idea',              10, '#71717A', false),
  ('planned',           'Planned',           20, '#3B82F6', false),
  ('in_design',         'In Design',         30, '#6366F1', false),
  ('internal_review',   'Internal Review',   40, '#A855F7', false),
  ('client_approval',   'Client Approval',   50, '#D946EF', false),
  ('approved',          'Approved',          60, '#14B8A6', false),
  ('scheduled',         'Scheduled',         70, '#EAB308', false),
  ('published',         'Published',         80, '#22C55E', true),
  ('revision_required', 'Revision Required', 90, '#EF4444', false);

create table public.content_posts (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references public.clients (id) on delete cascade,
  title         text not null check (length(trim(title)) > 0),
  platform      text not null check (platform in (
                  'facebook', 'instagram', 'tiktok', 'linkedin', 'x', 'youtube',
                  'google_business', 'website', 'other')),
  content_type  text not null default 'image' check (content_type in (
                  'image', 'carousel', 'video', 'reel', 'story', 'text', 'article', 'other')),
  category      text,
  campaign      text,
  caption       text,
  hashtags      text[] not null default '{}',
  stage_id      uuid not null references public.content_workflow_stages (id) on delete restrict,
  designer_id   uuid references public.profiles (id) on delete set null,
  creator_id    uuid references public.profiles (id) on delete set null,
  due_at        timestamptz,
  publish_at    timestamptz,
  published_at  timestamptz,
  published_url text,
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

create index content_posts_client_publish_idx on public.content_posts (client_id, publish_at) where deleted_at is null;
create index content_posts_stage_idx on public.content_posts (stage_id) where deleted_at is null;
create index content_posts_publish_idx on public.content_posts (publish_at) where deleted_at is null;

create table public.content_assets (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients (id) on delete cascade,
  post_id     uuid references public.content_posts (id) on delete set null,
  file_id     uuid not null references public.files (id) on delete cascade,
  asset_type  text not null default 'image' check (asset_type in (
                'graphic', 'video', 'logo', 'brand_guideline', 'font', 'image',
                'marketing_material', 'other')),
  title       text,
  tags        text[] not null default '{}',
  uploaded_by uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create index content_assets_client_idx on public.content_assets (client_id, asset_type) where deleted_at is null;
create index content_assets_post_idx on public.content_assets (post_id);

-- Review history. reviewer_type 'client' is reserved for the future client portal.
create table public.content_approvals (
  id            uuid primary key default gen_random_uuid(),
  post_id       uuid not null references public.content_posts (id) on delete cascade,
  reviewer_id   uuid references public.profiles (id) on delete set null,
  reviewer_type text not null default 'internal' check (reviewer_type in ('internal', 'client')),
  reviewer_name text,
  decision      text not null check (decision in ('approved', 'changes_requested', 'rejected')),
  feedback      text,
  revision      integer not null default 1,
  created_at    timestamptz not null default now()
);

create index content_approvals_post_idx on public.content_approvals (post_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Website management
-- ---------------------------------------------------------------------------

create table public.websites (
  id                    uuid primary key default gen_random_uuid(),
  client_id             uuid not null references public.clients (id) on delete cascade,
  name                  text not null,
  domain                text not null,
  url                   text,
  status                text not null default 'active'
                          check (status in ('in_development', 'active', 'paused', 'archived')),
  hosting_provider      text,
  tech_stack            text[] not null default '{}',
  domain_registrar      text,
  domain_expires_on     date,
  hosting_renews_on     date,
  ssl_expires_on        date,
  maintenance_frequency text not null default 'monthly'
                          check (maintenance_frequency in ('none', 'weekly', 'monthly', 'quarterly')),
  developer_id          uuid references public.profiles (id) on delete set null,
  backup_notes          text,
  notes                 text,
  last_checked_at       timestamptz,
  last_status_code      integer,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz
);

create unique index websites_domain_key on public.websites (lower(domain)) where deleted_at is null;
create index websites_client_idx on public.websites (client_id) where deleted_at is null;

-- Access credentials. The API encrypts secrets with AES-256-GCM using a key held only
-- in the API's environment; the database never sees plaintext.
create table public.website_secrets (
  id                uuid primary key default gen_random_uuid(),
  website_id        uuid not null references public.websites (id) on delete cascade,
  label             text not null,
  login_url         text,
  username          text,
  secret_ciphertext bytea not null,
  secret_nonce      bytea not null,
  key_version       integer not null default 1,
  created_by        uuid references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index website_secrets_website_idx on public.website_secrets (website_id);

create table public.website_maintenance (
  id            uuid primary key default gen_random_uuid(),
  website_id    uuid not null references public.websites (id) on delete cascade,
  task_type     text not null check (task_type in (
                  'content_update', 'plugin_update', 'security_check', 'backup',
                  'performance_check', 'uptime_check', 'ssl_renewal', 'domain_renewal',
                  'hosting_renewal', 'other')),
  title         text not null,
  notes         text,
  status        text not null default 'scheduled'
                  check (status in ('scheduled', 'in_progress', 'done', 'skipped')),
  scheduled_for date,
  assigned_to   uuid references public.profiles (id) on delete set null,
  completed_at  timestamptz,
  completed_by  uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index website_maintenance_website_idx on public.website_maintenance (website_id, scheduled_for desc);
create index website_maintenance_assignee_idx on public.website_maintenance (assigned_to, status);

-- ---------------------------------------------------------------------------
-- AI assistant history
-- ---------------------------------------------------------------------------

create table public.ai_conversations (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  title        text,
  context_type public.entity_kind,
  context_id   uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

create index ai_conversations_user_idx on public.ai_conversations (user_id, updated_at desc) where deleted_at is null;

create table public.ai_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.ai_conversations (id) on delete cascade,
  role            text not null check (role in ('system', 'user', 'assistant', 'tool')),
  content         text not null,
  model           text,
  token_usage     jsonb,
  created_at      timestamptz not null default now()
);

create index ai_messages_conversation_idx on public.ai_messages (conversation_id, created_at);

-- ---------------------------------------------------------------------------
-- Storage buckets (private; the API hands out short-lived signed URLs)
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit)
values
  ('media',     'media',     false, 524288000),  -- graphics, videos, brand assets (500 MB)
  ('documents', 'documents', false, 52428800)    -- contracts, proposals, reports (50 MB)
on conflict (id) do nothing;

do $$
declare
  t text;
begin
  foreach t in array array[
    'content_workflow_stages', 'content_posts', 'websites', 'website_secrets',
    'website_maintenance', 'ai_conversations'
  ] loop
    execute format(
      'create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t);
  end loop;

  foreach t in array array[
    'content_workflow_stages', 'content_posts', 'content_assets', 'content_approvals',
    'websites', 'website_secrets', 'website_maintenance', 'ai_conversations', 'ai_messages'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end;
$$;
