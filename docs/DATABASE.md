# ODDLY — Database

Supabase Postgres. Migrations live in `supabase/migrations/` and are applied in filename order.

| Migration | Contents |
|---|---|
| `…0100_foundation` | `profiles` (linked to `auth.users`), `roles`, `permissions`, `role_permissions`, `user_roles`, `files`, `activities`, `comments`, `notifications`, `audit_logs`, auth-user trigger |
| `…0200_crm_sales` | `companies`, `contacts`, `lead_sources`, `pipeline_stages`, `leads`, `lead_lists`, `lead_list_members`, `lead_list_assignees`, `lead_research`, `lead_interactions`, `services`, `deals`, `proposals`, `proposal_items`, `proposal_versions` |
| `…0300_clients_projects` | `clients`, `client_services`, `contracts`, `follow_ups`, `meetings`, `meeting_participants`, `projects`, `project_members`, `tasks`, `subtasks` |
| `…0400_content_websites_ai` | `content_workflow_stages`, `content_posts`, `content_assets`, `content_approvals`, `websites`, `website_secrets`, `website_maintenance`, `ai_conversations`, `ai_messages`, storage buckets |

## Entity map

```
auth.users ─1:1─ profiles ─< user_roles >─ roles ─< role_permissions >─ permissions

companies ─< contacts
    │
    ├─< leads ─< lead_interactions          leads >─ pipeline_stages
    │     ├── lead_research (1:1)           leads >─ lead_sources
    │     ├─< lead_list_members >─ lead_lists ─< lead_list_assignees
    │     └─< follow_ups / meetings
    ├─< deals ─< proposals ─< proposal_items
    │                     └─< proposal_versions
    └── clients (1 per company) ─< client_services >─ services
              ├─< contracts
              ├─< projects ─< tasks ─< subtasks
              │          └─< project_members
              ├─< content_posts ─< content_approvals
              │        └─< content_assets >─ files
              └─< websites ─< website_maintenance
                         └─< website_secrets (encrypted)
```

## Lead → client conversion

1. Deal is marked **won** (and its proposal **accepted**).
2. API creates a `clients` row with the **same `company_id`**, plus `lead_id` and `deal_id`
   for history. Contacts already belong to the company — nothing is copied.
3. Lead `status` becomes `converted`, `converted_at` is set.
4. `clients_company_key` (unique per live company) prevents a second client for the same business.

## Conventions

- Primary keys: `uuid` via `gen_random_uuid()`. Audit log uses a bigint identity.
- Timestamps: `timestamptz`, `created_at` / `updated_at` (trigger-maintained).
- Soft delete: `deleted_at` on user-facing records; partial indexes ignore deleted rows.
- Enumerations: `text` + `check` constraints (easy to evolve) except where admins customize
  values — those are tables (`pipeline_stages`, `content_workflow_stages`, `lead_sources`).
- Money: `numeric(14,2)` + `currency` (ISO 4217, `^[A-Z]{3}$`) on every amount.
- RLS enabled on every table, no policies: only the ODDLY API (table owner) reads/writes.
