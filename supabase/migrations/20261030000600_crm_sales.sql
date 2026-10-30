-- Phase 3: reminders, proposal templates, faster CRM queries.

-- Reminder bookkeeping: the API's reminder job notifies once per item.
alter table public.follow_ups add column notified_at timestamptz;
alter table public.meetings add column notified_at timestamptz;

create index follow_ups_due_unnotified_idx on public.follow_ups (due_at)
  where status = 'pending' and notified_at is null;
create index meetings_upcoming_unnotified_idx on public.meetings (starts_at)
  where deleted_at is null and status = 'scheduled' and notified_at is null;

-- Proposals flagged as templates are reusable starting points, never sent.
alter table public.proposals add column is_template boolean not null default false;
alter table public.proposals alter column company_id drop not null;
alter table public.proposals add constraint proposals_company_unless_template
  check (is_template or company_id is not null);

create index proposals_template_idx on public.proposals (is_template) where deleted_at is null;
create index meetings_lead_idx on public.meetings (lead_id) where deleted_at is null;
create index meetings_client_idx on public.meetings (client_id) where deleted_at is null;
create index follow_ups_deal_idx on public.follow_ups (deal_id);
create index proposals_lead_idx on public.proposals (lead_id);

-- Link a client to the proposal that won it (shown in the client's history).
alter table public.clients add column proposal_id uuid references public.proposals (id) on delete set null;
