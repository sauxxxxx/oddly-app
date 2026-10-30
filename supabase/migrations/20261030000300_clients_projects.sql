-- ODDLY clients, follow-ups, meetings, projects and tasks.

-- A client is the same company as the lead it came from (company_id is unique),
-- so lead -> client conversion links records instead of copying them.
create table public.clients (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies (id) on delete restrict,
  lead_id            uuid references public.leads (id) on delete set null,
  deal_id            uuid references public.deals (id) on delete set null,
  status             text not null default 'onboarding' check (status in (
                       'onboarding', 'active', 'awaiting_client', 'needs_attention',
                       'at_risk', 'completed', 'inactive')),
  account_manager_id uuid references public.profiles (id) on delete set null,
  client_since       date not null default current_date,
  billing_email      text,
  billing_address    text,
  billing_notes      text,
  notes              text,
  created_by         uuid references public.profiles (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz
);

create unique index clients_company_key on public.clients (company_id) where deleted_at is null;
create unique index clients_lead_key on public.clients (lead_id) where deleted_at is null and lead_id is not null;
create index clients_status_idx on public.clients (status) where deleted_at is null;
create index clients_account_manager_idx on public.clients (account_manager_id) where deleted_at is null;

create table public.client_services (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references public.clients (id) on delete cascade,
  service_id   uuid references public.services (id) on delete set null,
  name         text not null,
  price        numeric(14, 2) not null default 0 check (price >= 0),
  currency     text not null default 'PHP' check (currency ~ '^[A-Z]{3}$'),
  billing_type text not null default 'monthly'
                 check (billing_type in ('one_time', 'monthly', 'quarterly', 'yearly', 'hourly')),
  status       text not null default 'active' check (status in ('active', 'paused', 'cancelled', 'completed')),
  start_date   date,
  end_date     date,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (end_date is null or start_date is null or end_date >= start_date)
);

create index client_services_client_idx on public.client_services (client_id);

create table public.contracts (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references public.clients (id) on delete cascade,
  deal_id       uuid references public.deals (id) on delete set null,
  proposal_id   uuid references public.proposals (id) on delete set null,
  title         text not null,
  status        text not null default 'draft'
                  check (status in ('draft', 'sent', 'signed', 'active', 'expired', 'terminated')),
  start_date    date,
  end_date      date,
  value         numeric(14, 2) check (value >= 0),
  currency      text not null default 'PHP' check (currency ~ '^[A-Z]{3}$'),
  billing_cycle text check (billing_cycle in ('one_time', 'monthly', 'quarterly', 'yearly')),
  file_id       uuid references public.files (id) on delete set null,
  signed_at     timestamptz,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

create index contracts_client_idx on public.contracts (client_id) where deleted_at is null;

-- ---------------------------------------------------------------------------
-- Follow-ups & meetings (attach to a lead, deal or client)
-- ---------------------------------------------------------------------------

create table public.follow_ups (
  id           uuid primary key default gen_random_uuid(),
  lead_id      uuid references public.leads (id) on delete cascade,
  deal_id      uuid references public.deals (id) on delete cascade,
  client_id    uuid references public.clients (id) on delete cascade,
  title        text not null,
  notes        text,
  due_at       timestamptz not null,
  priority     text not null default 'medium' check (priority in ('low', 'medium', 'high', 'urgent')),
  status       text not null default 'pending' check (status in ('pending', 'done', 'cancelled')),
  recurrence   text check (recurrence in ('daily', 'weekly', 'biweekly', 'monthly')),
  assigned_to  uuid references public.profiles (id) on delete set null,
  completed_at timestamptz,
  completed_by uuid references public.profiles (id) on delete set null,
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index follow_ups_assignee_due_idx on public.follow_ups (assigned_to, due_at) where status = 'pending';
create index follow_ups_lead_idx on public.follow_ups (lead_id);
create index follow_ups_client_idx on public.follow_ups (client_id);

create table public.meetings (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  starts_at    timestamptz not null,
  ends_at      timestamptz,
  location     text,
  meeting_url  text,
  lead_id      uuid references public.leads (id) on delete set null,
  deal_id      uuid references public.deals (id) on delete set null,
  client_id    uuid references public.clients (id) on delete set null,
  organizer_id uuid references public.profiles (id) on delete set null,
  status       text not null default 'scheduled'
                 check (status in ('scheduled', 'completed', 'cancelled', 'no_show')),
  notes        text,
  outcome      text,
  next_action  text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  check (ends_at is null or ends_at >= starts_at)
);

create index meetings_starts_at_idx on public.meetings (starts_at) where deleted_at is null;
create index meetings_organizer_idx on public.meetings (organizer_id, starts_at) where deleted_at is null;

-- Participants are team members (user_id) or external people (contact_id or name/email).
create table public.meeting_participants (
  id         uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings (id) on delete cascade,
  user_id    uuid references public.profiles (id) on delete cascade,
  contact_id uuid references public.contacts (id) on delete cascade,
  name       text,
  email      text,
  check (user_id is not null or contact_id is not null or name is not null)
);

create index meeting_participants_meeting_idx on public.meeting_participants (meeting_id);
create index meeting_participants_user_idx on public.meeting_participants (user_id);

-- ---------------------------------------------------------------------------
-- Projects & tasks
-- ---------------------------------------------------------------------------

create table public.projects (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid references public.clients (id) on delete restrict,
  name         text not null check (length(trim(name)) > 0),
  description  text,
  category     text,
  status       text not null default 'planning'
                 check (status in ('planning', 'active', 'on_hold', 'completed', 'cancelled')),
  priority     text not null default 'medium' check (priority in ('low', 'medium', 'high', 'urgent')),
  start_date   date,
  deadline     date,
  completed_at timestamptz,
  owner_id     uuid references public.profiles (id) on delete set null,
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

create index projects_client_idx on public.projects (client_id) where deleted_at is null;
create index projects_status_idx on public.projects (status, deadline) where deleted_at is null;

create table public.project_members (
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  role       text,
  added_at   timestamptz not null default now(),
  primary key (project_id, user_id)
);

create index project_members_user_idx on public.project_members (user_id);

create table public.tasks (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid references public.projects (id) on delete cascade,
  client_id    uuid references public.clients (id) on delete set null,
  title        text not null check (length(trim(title)) > 0),
  description  text,
  status       text not null default 'todo'
                 check (status in ('todo', 'in_progress', 'in_review', 'blocked', 'done')),
  priority     text not null default 'medium' check (priority in ('low', 'medium', 'high', 'urgent')),
  assignee_id  uuid references public.profiles (id) on delete set null,
  reporter_id  uuid references public.profiles (id) on delete set null,
  due_at       timestamptz,
  position     double precision not null default 0,
  completed_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

create index tasks_assignee_idx on public.tasks (assignee_id, status) where deleted_at is null;
create index tasks_project_idx on public.tasks (project_id, status, position) where deleted_at is null;
create index tasks_due_idx on public.tasks (due_at) where deleted_at is null and status <> 'done';

create table public.subtasks (
  id           uuid primary key default gen_random_uuid(),
  task_id      uuid not null references public.tasks (id) on delete cascade,
  title        text not null,
  is_done      boolean not null default false,
  position     integer not null default 0,
  completed_at timestamptz,
  created_at   timestamptz not null default now()
);

create index subtasks_task_idx on public.subtasks (task_id, position);

do $$
declare
  t text;
begin
  foreach t in array array[
    'clients', 'client_services', 'contracts', 'follow_ups', 'meetings', 'projects', 'tasks'
  ] loop
    execute format(
      'create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t);
  end loop;

  foreach t in array array[
    'clients', 'client_services', 'contracts', 'follow_ups', 'meetings', 'meeting_participants',
    'projects', 'project_members', 'tasks', 'subtasks'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end;
$$;
