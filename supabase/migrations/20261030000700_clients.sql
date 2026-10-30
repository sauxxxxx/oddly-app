-- Phase 4: clients — service catalog starter set, search indexes, onboarding tasks.

-- Starter catalog of the agency's own services (no prices: set them in Services & Packages).
insert into public.services (name, category, billing_type, description)
select v.name, v.category, v.billing_type, v.description
from (values
  ('Social media management', 'social_media',    'monthly',  'Planning, posting and community management'),
  ('Content creation',        'content',         'monthly',  'Photos, videos, captions and copy'),
  ('Graphic design',          'graphic_design',  'one_time', 'Posts, flyers, menus and marketing materials'),
  ('Branding',                'branding',        'one_time', 'Logo, colors, typography and brand guidelines'),
  ('Website development',     'web_development', 'one_time', 'Design and build of a business website'),
  ('Website maintenance',     'web_maintenance', 'monthly',  'Updates, backups, security and monitoring'),
  ('SEO',                     'seo',             'monthly',  'Search visibility and Google Business Profile'),
  ('Paid ads management',     'ads',             'monthly',  'Facebook, Instagram and Google ads (ad spend billed separately)')
) as v (name, category, billing_type, description)
where not exists (select 1 from public.services);

create index clients_since_idx on public.clients (client_since) where deleted_at is null;
create index client_services_status_idx on public.client_services (status, billing_type);
create index contracts_end_idx on public.contracts (end_date) where deleted_at is null;
create index tasks_client_idx on public.tasks (client_id) where deleted_at is null;
create index files_uploaded_idx on public.files (created_at desc) where deleted_at is null;
