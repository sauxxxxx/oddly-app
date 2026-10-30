-- ODDLY CRM & sales: companies, contacts, leads, lead lists, research, interactions,
-- pipeline, services catalog, deals and proposals.
--
-- Data model
--   companies  - the business itself. Shared by its lead, deal(s) and, once won, its client,
--                so converting a lead never re-creates or duplicates business data.
--   contacts   - people at a company.
--   leads      - the prospecting record for a company: source, owner, pipeline stage,
--                next action. The sales pipeline board shows leads by stage.
--   deals      - a priced opportunity for a company (usually created when a proposal is
--                prepared). Won deals drive revenue figures.

create table public.companies (
  id              uuid primary key default gen_random_uuid(),
  name            text not null check (length(trim(name)) > 0),
  industry        text,
  category        text,
  market          text not null check (market in ('local', 'international')),
  country         text,
  region          text,
  city            text,
  address         text,
  postal_code     text,
  website_url     text,
  facebook_url    text,
  instagram_url   text,
  linkedin_url    text,
  google_maps_url text,
  phone           text,
  email           text,
  notes           text,
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

create index companies_name_idx on public.companies (lower(name)) where deleted_at is null;
create index companies_market_country_idx on public.companies (market, country) where deleted_at is null;

create table public.contacts (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  full_name   text not null check (length(trim(full_name)) > 0),
  position    text,
  email       text,
  phone       text,
  is_primary  boolean not null default false,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create index contacts_company_idx on public.contacts (company_id) where deleted_at is null;
create index contacts_email_idx on public.contacts (lower(email)) where deleted_at is null and email is not null;

create table public.lead_sources (
  id         uuid primary key default gen_random_uuid(),
  key        text not null unique,
  name       text not null,
  is_active  boolean not null default true,
  sort_order integer not null default 0
);

insert into public.lead_sources (key, name, sort_order) values
  ('google_search',  'Google Search',     10),
  ('google_maps',    'Google Maps',       20),
  ('facebook',       'Facebook',          30),
  ('instagram',      'Instagram',         40),
  ('linkedin',       'LinkedIn',          50),
  ('website',        'Business website',  60),
  ('purchased_list', 'Purchased list',    70),
  ('manual',         'Manual research',   80),
  ('referral',       'Referral',          90),
  ('other',          'Other',            100);

-- Customizable by admins (pipeline.manage). `kind` tells reports which stages
-- count as won/lost regardless of what they are renamed to.
create table public.pipeline_stages (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  kind        text not null default 'open' check (kind in ('open', 'won', 'lost')),
  position    integer not null,
  color       text not null default '#A855F7',
  is_default  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  archived_at timestamptz
);

create index pipeline_stages_position_idx on public.pipeline_stages (position) where archived_at is null;

insert into public.pipeline_stages (name, kind, position, color, is_default) values
  ('New Prospect',  'open', 10, '#71717A', true),
  ('To Contact',    'open', 20, '#3B82F6', false),
  ('Contacted',     'open', 30, '#6366F1', false),
  ('Interested',    'open', 40, '#A855F7', false),
  ('Proposal Sent', 'open', 50, '#C026D3', false),
  ('Negotiation',   'open', 60, '#D946EF', false),
  ('Won',           'won',  70, '#22C55E', false),
  ('Lost',          'lost', 80, '#EF4444', false);

create table public.leads (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies (id) on delete restrict,
  primary_contact_id uuid references public.contacts (id) on delete set null,
  source_id          uuid references public.lead_sources (id) on delete set null,
  source_detail      text,
  stage_id           uuid not null references public.pipeline_stages (id) on delete restrict,
  status             text not null default 'active'
                       check (status in ('active', 'converted', 'disqualified', 'archived')),
  priority           text not null default 'medium'
                       check (priority in ('low', 'medium', 'high', 'urgent')),
  assigned_to        uuid references public.profiles (id) on delete set null,
  potential_services text[] not null default '{}',
  estimated_value    numeric(14, 2) check (estimated_value >= 0),
  currency           text not null default 'PHP' check (currency ~ '^[A-Z]{3}$'),
  research_notes     text,
  next_action        text,
  next_action_due_at timestamptz,
  last_contacted_at  timestamptz,
  converted_at       timestamptz,
  lost_reason        text,
  created_by         uuid references public.profiles (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz
);

create index leads_company_idx on public.leads (company_id);
create index leads_assigned_idx on public.leads (assigned_to, status) where deleted_at is null;
create index leads_stage_idx on public.leads (stage_id) where deleted_at is null;
create index leads_created_at_idx on public.leads (created_at desc) where deleted_at is null;
create index leads_next_action_idx on public.leads (next_action_due_at) where deleted_at is null and status = 'active';
create index leads_last_contacted_idx on public.leads (last_contacted_at) where deleted_at is null and status = 'active';

create table public.lead_lists (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) > 0),
  description text,
  market      text check (market in ('local', 'international')),
  color       text not null default '#A855F7',
  owner_id    uuid references public.profiles (id) on delete set null,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  archived_at timestamptz,
  deleted_at  timestamptz
);

create unique index lead_lists_name_key on public.lead_lists (lower(name)) where deleted_at is null;

create table public.lead_list_members (
  list_id  uuid not null references public.lead_lists (id) on delete cascade,
  lead_id  uuid not null references public.leads (id) on delete cascade,
  added_by uuid references public.profiles (id) on delete set null,
  added_at timestamptz not null default now(),
  primary key (list_id, lead_id)
);

create index lead_list_members_lead_idx on public.lead_list_members (lead_id);

create table public.lead_list_assignees (
  list_id uuid not null references public.lead_lists (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  primary key (list_id, user_id)
);

-- Scores are 1 (poor) to 5 (excellent). AI output is stored separately from the
-- researcher's own findings so it is always shown as a suggestion.
create table public.lead_research (
  id                    uuid primary key default gen_random_uuid(),
  lead_id               uuid not null unique references public.leads (id) on delete cascade,
  website_quality       smallint check (website_quality between 1 and 5),
  social_activity       smallint check (social_activity between 1 and 5),
  branding_quality      smallint check (branding_quality between 1 and 5),
  content_consistency   smallint check (content_consistency between 1 and 5),
  online_presence       smallint check (online_presence between 1 and 5),
  marketing_weaknesses  text,
  potential_services    text[] not null default '{}',
  findings              text,
  outreach_strategy     text,
  ai_suggestions        jsonb,
  ai_generated_at       timestamptz,
  researched_by         uuid references public.profiles (id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create table public.lead_interactions (
  id          uuid primary key default gen_random_uuid(),
  lead_id     uuid not null references public.leads (id) on delete cascade,
  user_id     uuid references public.profiles (id) on delete set null,
  channel     text not null check (channel in (
                'phone', 'email', 'facebook', 'instagram', 'linkedin', 'whatsapp', 'sms',
                'in_person', 'online_meeting', 'note', 'other')),
  direction   text not null default 'outbound' check (direction in ('outbound', 'inbound', 'internal')),
  subject     text,
  body        text,
  outcome     text,
  occurred_at timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

create index lead_interactions_lead_idx on public.lead_interactions (lead_id, occurred_at desc);
create index lead_interactions_user_idx on public.lead_interactions (user_id, occurred_at desc);

-- Agency services catalog (also used as proposal line-item presets and client services).
create table public.services (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  category      text not null check (category in (
                  'graphic_design', 'social_media', 'content', 'web_development',
                  'web_maintenance', 'branding', 'seo', 'ads', 'other')),
  description   text,
  billing_type  text not null default 'one_time'
                  check (billing_type in ('one_time', 'monthly', 'quarterly', 'yearly', 'hourly')),
  default_price numeric(14, 2) check (default_price >= 0),
  currency      text not null default 'PHP' check (currency ~ '^[A-Z]{3}$'),
  is_package    boolean not null default false,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table public.deals (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies (id) on delete restrict,
  lead_id             uuid references public.leads (id) on delete set null,
  title               text not null,
  value               numeric(14, 2) not null default 0 check (value >= 0),
  currency            text not null default 'PHP' check (currency ~ '^[A-Z]{3}$'),
  status              text not null default 'open' check (status in ('open', 'won', 'lost')),
  owner_id            uuid references public.profiles (id) on delete set null,
  expected_close_date date,
  won_at              timestamptz,
  lost_at             timestamptz,
  lost_reason         text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz,
  check (status <> 'won' or won_at is not null),
  check (status <> 'lost' or lost_at is not null)
);

create index deals_company_idx on public.deals (company_id);
create index deals_lead_idx on public.deals (lead_id);
create index deals_status_idx on public.deals (status, won_at) where deleted_at is null;
create index deals_owner_idx on public.deals (owner_id) where deleted_at is null;

create sequence public.proposal_number_seq;

create table public.proposals (
  id              uuid primary key default gen_random_uuid(),
  number          text not null unique
                    default ('P-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.proposal_number_seq')::text, 4, '0')),
  company_id      uuid not null references public.companies (id) on delete restrict,
  lead_id         uuid references public.leads (id) on delete set null,
  deal_id         uuid references public.deals (id) on delete set null,
  title           text not null,
  status          text not null default 'draft'
                    check (status in ('draft', 'ready', 'sent', 'accepted', 'rejected', 'expired')),
  currency        text not null default 'PHP' check (currency ~ '^[A-Z]{3}$'),
  subtotal        numeric(14, 2) not null default 0,
  discount_type   text not null default 'none' check (discount_type in ('none', 'percent', 'fixed')),
  discount_value  numeric(14, 2) not null default 0 check (discount_value >= 0),
  tax_rate        numeric(5, 2) not null default 0 check (tax_rate between 0 and 100),
  total           numeric(14, 2) not null default 0,
  valid_until     date,
  introduction    text,
  terms           text,
  current_version integer not null default 1,
  sent_at         timestamptz,
  responded_at    timestamptz,
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

create index proposals_company_idx on public.proposals (company_id);
create index proposals_deal_idx on public.proposals (deal_id);
create index proposals_status_idx on public.proposals (status, updated_at desc) where deleted_at is null;

create table public.proposal_items (
  id           uuid primary key default gen_random_uuid(),
  proposal_id  uuid not null references public.proposals (id) on delete cascade,
  service_id   uuid references public.services (id) on delete set null,
  name         text not null,
  description  text,
  deliverables text[] not null default '{}',
  quantity     numeric(10, 2) not null default 1 check (quantity > 0),
  unit_price   numeric(14, 2) not null default 0 check (unit_price >= 0),
  billing_type text not null default 'one_time'
                 check (billing_type in ('one_time', 'monthly', 'quarterly', 'yearly', 'hourly')),
  position     integer not null default 0
);

create index proposal_items_proposal_idx on public.proposal_items (proposal_id, position);

-- Immutable snapshot of a proposal each time it is versioned (e.g. before sending).
create table public.proposal_versions (
  id          uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.proposals (id) on delete cascade,
  version     integer not null,
  snapshot    jsonb not null,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (proposal_id, version)
);

do $$
declare
  t text;
begin
  foreach t in array array[
    'companies', 'contacts', 'pipeline_stages', 'leads', 'lead_lists', 'lead_research',
    'services', 'deals', 'proposals'
  ] loop
    execute format(
      'create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t);
  end loop;

  foreach t in array array[
    'companies', 'contacts', 'lead_sources', 'pipeline_stages', 'leads', 'lead_lists',
    'lead_list_members', 'lead_list_assignees', 'lead_research', 'lead_interactions',
    'services', 'deals', 'proposals', 'proposal_items', 'proposal_versions'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end;
$$;
