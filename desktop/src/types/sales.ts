/** CRM & sales types — mirror backend/src/routes/sales. */

import type { Decimal, Priority } from "./api";

export interface PipelineCard {
  id: string;
  stage_id: string;
  business_name: string;
  city: string | null;
  market: "local" | "international";
  contact_name: string | null;
  status: string;
  priority: Priority;
  assigned_to: string | null;
  assigned_name: string | null;
  estimated_value: Decimal | null;
  currency: string;
  next_action: string | null;
  next_action_due_at: string | null;
  last_contacted_at: string | null;
}

export interface PipelineColumn {
  id: string;
  name: string;
  kind: "open" | "won" | "lost";
  color: string;
  position: number;
  count: number;
  totals: Record<string, Decimal>;
  cards: PipelineCard[];
}

export type Channel =
  | "phone" | "email" | "facebook" | "instagram" | "linkedin" | "whatsapp" | "sms" | "in_person"
  | "online_meeting" | "note" | "other";

export interface Interaction {
  id: string;
  lead_id: string;
  business_name: string;
  channel: Channel;
  direction: "outbound" | "inbound" | "internal";
  subject: string | null;
  body: string | null;
  outcome: string | null;
  occurred_at: string;
  user_id: string | null;
  user_name: string | null;
}

export interface FollowUp {
  id: string;
  title: string;
  notes: string | null;
  due_at: string;
  priority: Priority;
  status: "pending" | "done" | "cancelled";
  recurrence: "daily" | "weekly" | "biweekly" | "monthly" | null;
  overdue: boolean;
  lead_id: string | null;
  deal_id: string | null;
  client_id: string | null;
  related_name: string | null;
  assigned_to: string | null;
  assigned_name: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface Meeting {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string | null;
  location: string | null;
  meeting_url: string | null;
  status: "scheduled" | "completed" | "cancelled" | "no_show";
  notes: string | null;
  outcome: string | null;
  next_action: string | null;
  lead_id: string | null;
  client_id: string | null;
  deal_id: string | null;
  related_name: string | null;
  organizer_id: string | null;
  organizer_name: string | null;
  participants: { user_id: string | null; name: string | null; email: string | null }[];
}

export interface Deal {
  id: string;
  title: string;
  company_id: string;
  company_name: string;
  lead_id: string | null;
  client_id: string | null;
  value: Decimal;
  currency: string;
  status: "open" | "won" | "lost";
  owner_id: string | null;
  owner_name: string | null;
  expected_close_date: string | null;
  won_at: string | null;
  lost_at: string | null;
  lost_reason: string | null;
  proposals: number;
  created_at: string;
}

export type ProposalStatus = "draft" | "ready" | "sent" | "accepted" | "rejected" | "expired";
export type BillingType = "one_time" | "monthly" | "quarterly" | "yearly" | "hourly";

export interface ProposalSummary {
  id: string;
  number: string;
  title: string;
  status: ProposalStatus;
  is_template: boolean;
  company_id: string | null;
  company_name: string | null;
  lead_id: string | null;
  deal_id: string | null;
  total: Decimal;
  currency: string;
  valid_until: string | null;
  sent_at: string | null;
  responded_at: string | null;
  current_version: number;
  created_by_name: string | null;
  updated_at: string;
}

export interface ProposalItem {
  service_id: string | null;
  name: string;
  description: string | null;
  deliverables: string[];
  quantity: Decimal;
  unit_price: Decimal;
  billing_type: BillingType;
}

export interface ProposalDetail extends ProposalSummary {
  subtotal: Decimal;
  discount_type: "none" | "percent" | "fixed";
  discount_value: Decimal;
  tax_rate: Decimal;
  introduction: string | null;
  terms: string | null;
  discount_amount: Decimal;
  tax_amount: Decimal;
  items: ProposalItem[];
  recipient: {
    company_name: string | null;
    address: string | null;
    city: string | null;
    region: string | null;
    country: string | null;
    contact_name: string | null;
    contact_position: string | null;
    contact_email: string | null;
    contact_phone: string | null;
  };
  versions: { version: number; created_at: string; created_by_name: string | null }[];
}

export const CHANNEL_LABELS: Record<Channel, string> = {
  phone: "Phone call",
  email: "Email",
  facebook: "Facebook message",
  instagram: "Instagram message",
  linkedin: "LinkedIn message",
  whatsapp: "WhatsApp",
  sms: "SMS / text",
  in_person: "In-person visit",
  online_meeting: "Online meeting",
  note: "Internal note",
  other: "Other",
};

export const BILLING_LABELS: Record<BillingType, string> = {
  one_time: "One-time",
  monthly: "Monthly",
  quarterly: "Quarterly",
  yearly: "Yearly",
  hourly: "Hourly",
};
