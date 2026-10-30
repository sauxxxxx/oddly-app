/** Lead management types — mirror backend/src/routes/leads. */

import type { Decimal, Priority } from "./api";

export type Market = "local" | "international";
export type LeadStatus = "active" | "converted" | "disqualified" | "archived";

export interface Lead {
  id: string;
  company_id: string;
  primary_contact_id: string | null;
  business_name: string;
  industry: string | null;
  category: string | null;
  market: Market;
  country: string | null;
  region: string | null;
  city: string | null;
  address: string | null;
  website_url: string | null;
  facebook_url: string | null;
  instagram_url: string | null;
  linkedin_url: string | null;
  google_maps_url: string | null;
  business_phone: string | null;
  business_email: string | null;
  contact_name: string | null;
  contact_position: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  source_id: string | null;
  source_name: string | null;
  source_detail: string | null;
  stage_id: string;
  stage_name: string;
  stage_color: string;
  stage_kind: "open" | "won" | "lost";
  status: LeadStatus;
  priority: Priority;
  assigned_to: string | null;
  assigned_name: string | null;
  potential_services: string[];
  estimated_value: Decimal | null;
  currency: string;
  research_notes: string | null;
  next_action: string | null;
  next_action_due_at: string | null;
  last_contacted_at: string | null;
  converted_at: string | null;
  lost_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface LeadDetail extends Lead {
  lists: { id: string; name: string; color: string }[];
  timeline: { id: string; action: string; summary: string; actor_name: string | null; created_at: string }[];
  client_id: string | null;
}

/** Fields a form or an imported row can set. */
export type LeadInput = Partial<
  Omit<
    Lead,
    | "id"
    | "company_id"
    | "primary_contact_id"
    | "source_name"
    | "stage_name"
    | "stage_color"
    | "stage_kind"
    | "assigned_name"
    | "last_contacted_at"
    | "converted_at"
    | "created_at"
    | "updated_at"
  >
> & { business_name: string; market: Market };

export interface LeadFilters {
  search?: string;
  market?: Market;
  status?: LeadStatus | "";
  stage_id?: string;
  source_id?: string;
  assigned?: string;
  list_id?: string;
  priority?: Priority | "";
  country?: string;
  industry?: string;
  stale_days?: number;
  researched?: boolean;
  sort?: string;
  dir?: "asc" | "desc";
  page?: number;
  per_page?: number;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  per_page: number;
}

export interface DuplicateMatch {
  lead_id: string;
  business_name: string;
  city: string | null;
  matched_by: string;
}

export type CreateLeadResult =
  | { result: "created"; lead: Lead }
  | { result: "possible_duplicates"; duplicates: DuplicateMatch[] };

export interface Lookups {
  pipeline_stages: { id: string; name: string; kind: "open" | "won" | "lost"; color: string; position: number }[];
  lead_sources: { id: string; name: string }[];
  members: { id: string; name: string }[];
  lead_lists: { id: string; name: string }[];
  services: { id: string; name: string }[];
  content_stages: { id: string; key: string; name: string; color: string; position: number }[];
  clients: { id: string; name: string }[];
}

export interface LeadList {
  id: string;
  name: string;
  description: string | null;
  market: Market | null;
  color: string;
  owner_id: string | null;
  owner_name: string | null;
  total: number;
  contacted: number;
  interested: number;
  won: number;
  assignees: { id: string; name: string }[];
  created_at: string;
  archived_at: string | null;
}

export interface Research {
  website_quality: number | null;
  social_activity: number | null;
  branding_quality: number | null;
  content_consistency: number | null;
  online_presence: number | null;
  marketing_weaknesses: string | null;
  potential_services: string[];
  findings: string | null;
  outreach_strategy: string | null;
  ai_suggestions: unknown;
  ai_generated_at: string | null;
  researched_by_name: string | null;
  updated_at: string | null;
}

export interface DuplicateGroup {
  matched_by: string;
  value: string;
  leads: {
    id: string;
    business_name: string;
    city: string | null;
    market: Market;
    website_url: string | null;
    contact_name: string | null;
    contact_email: string | null;
    stage_name: string;
    status: LeadStatus;
    assigned_name: string | null;
    created_at: string;
  }[];
}

export interface ImportIssue {
  index: number;
  errors: Record<string, string>;
  duplicate: DuplicateMatch | null;
  duplicate_of_row: number | null;
}

export interface ImportRowResult {
  index: number;
  outcome: "created" | "updated" | "skipped" | "failed";
  lead_id: string | null;
  message: string | null;
}

export interface ImportJob {
  id: string;
  file_name: string;
  mode: "skip" | "update" | "create";
  total_rows: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: { row: number; message: string }[];
  user_name: string | null;
  started_at: string;
  finished_at: string | null;
}

export interface SavedFilter {
  id: string;
  name: string;
  filters: LeadFilters;
  is_shared: boolean;
  mine: boolean;
}
