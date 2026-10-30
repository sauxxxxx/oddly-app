/** Client types — mirror backend/src/routes/clients. */

import type { Decimal } from "./api";
import type { BillingType } from "./sales";

export type ClientStatus = "onboarding" | "active" | "awaiting_client" | "needs_attention" | "at_risk" | "completed" | "inactive";

export const CLIENT_STATUS_LABELS: Record<ClientStatus, string> = {
  onboarding: "Onboarding",
  active: "Active",
  awaiting_client: "Awaiting client",
  needs_attention: "Needs attention",
  at_risk: "At risk",
  completed: "Completed",
  inactive: "Inactive",
};

export interface ClientRow {
  id: string;
  company_id: string;
  name: string;
  industry: string | null;
  market: "local" | "international";
  country: string | null;
  city: string | null;
  status: ClientStatus;
  account_manager_id: string | null;
  account_manager_name: string | null;
  client_since: string;
  services_count: number;
  monthly_value: Record<string, Decimal>;
  open_tasks: number;
  primary_contact: string | null;
  created_at: string;
}

export interface Company {
  id: string;
  name: string;
  industry: string | null;
  category: string | null;
  market: "local" | "international";
  country: string | null;
  region: string | null;
  city: string | null;
  address: string | null;
  website_url: string | null;
  facebook_url: string | null;
  instagram_url: string | null;
  linkedin_url: string | null;
  google_maps_url: string | null;
  phone: string | null;
  email: string | null;
}

export interface Contact {
  id: string;
  full_name: string;
  position: string | null;
  email: string | null;
  phone: string | null;
  is_primary: boolean;
  notes: string | null;
}

export interface ClientService {
  id: string;
  service_id: string | null;
  name: string;
  price: Decimal;
  currency: string;
  billing_type: BillingType;
  status: "active" | "paused" | "cancelled" | "completed";
  start_date: string | null;
  end_date: string | null;
  notes: string | null;
}

export interface ClientDetail {
  id: string;
  status: ClientStatus;
  account_manager_id: string | null;
  account_manager_name: string | null;
  client_since: string;
  billing_email: string | null;
  billing_address: string | null;
  billing_notes: string | null;
  notes: string | null;
  lead_id: string | null;
  deal_id: string | null;
  proposal_id: string | null;
  proposal_number: string | null;
  created_at: string;
  company: Company;
  contacts: Contact[];
  services: ClientService[];
  onboarding: { id: string; title: string; status: string; assignee_name: string | null; due_at: string | null }[];
  monthly_value: Record<string, Decimal>;
  counts: { contracts: number; projects: number; open_tasks: number; websites: number; files: number; content_posts: number };
}

export interface Contract {
  id: string;
  client_id: string;
  client_name: string;
  title: string;
  status: "draft" | "sent" | "signed" | "active" | "expired" | "terminated";
  start_date: string | null;
  end_date: string | null;
  value: Decimal | null;
  currency: string;
  billing_cycle: string | null;
  signed_at: string | null;
  notes: string | null;
  proposal_id: string | null;
  documents: number;
  days_left: number | null;
  created_at: string;
}

export interface HistoryItem {
  id: string;
  kind: "activity" | "interaction";
  summary: string;
  detail: string | null;
  actor_name: string | null;
  client_id: string | null;
  client_name: string | null;
  occurred_at: string;
}

export interface Service {
  id: string;
  name: string;
  category: string;
  description: string | null;
  billing_type: BillingType;
  default_price: Decimal | null;
  currency: string;
  is_package: boolean;
  is_active: boolean;
  active_clients: number;
  created_at: string;
}

export interface FileRow {
  id: string;
  bucket: "media" | "documents";
  original_name: string;
  content_type: string;
  size_bytes: number;
  category: string | null;
  entity_type: string | null;
  entity_id: string | null;
  uploaded_by_name: string | null;
  created_at: string;
}
