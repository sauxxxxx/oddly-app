/** Types mirroring the ODDLY API (backend/src/routes). Keep in sync with the Rust structs. */

/** Decimal amounts are serialized as strings to avoid floating-point rounding. */
export type Decimal = string;

export interface Me {
  id: string;
  email: string;
  full_name: string;
  job_title: string | null;
  phone: string | null;
  timezone: string;
  must_change_password: boolean;
  roles: string[];
  /** `["*"]` for Super Admins. */
  permissions: string[];
  ai_configured: boolean;
}

export interface SetupStatus {
  setup_required: boolean;
  setup_token_required: boolean;
}

export interface NotificationItem {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  entity_type: string | null;
  entity_id: string | null;
  read_at: string | null;
  created_at: string;
}

export interface NotificationList {
  items: NotificationItem[];
  unread_count: number;
}

export interface TeamMember {
  id: string;
  email: string;
  full_name: string;
  job_title: string | null;
  status: "active" | "suspended";
  must_change_password: boolean;
  last_seen_at: string | null;
  created_at: string;
  roles: string[];
}

export interface Role {
  id: string;
  key: string;
  name: string;
  description: string | null;
  member_count: number;
}

export interface CreatedMember {
  member: TeamMember;
  temporary_password: string;
}

// ---- Dashboard ------------------------------------------------------------

export interface DashboardSummary {
  range: { from: string; to: string; bucket: "day" | "week" | "month"; timezone: string };
  stats: {
    total_leads: number;
    new_leads: number;
    new_leads_previous: number;
    active_clients: number | null;
    pending_proposals: number | null;
    won_deals: number | null;
    won_deals_previous: number | null;
  };
  lead_trend: { bucket: string; local: number; international: number }[];
  lead_sources: { source: string; count: number }[];
  pipeline: { id: string; name: string; kind: "open" | "won" | "lost"; color: string; count: number }[];
  conversion: { cohort: number; contacted: number; converted: number; deals_won: number; deals_lost: number };
  revenue: { currency: string; amount: Decimal; previous_amount: Decimal; deals: number }[] | null;
  revenue_trend: { currencies: string[]; points: { bucket: string; amounts: Record<string, Decimal> }[] } | null;
  client_growth: { bucket: string; new_clients: number; total_clients: number }[] | null;
  recent_activities: {
    id: string;
    action: string;
    summary: string;
    entity_type: string;
    entity_id: string;
    actor_name: string | null;
    created_at: string;
  }[];
  upcoming_follow_ups:
    | {
        id: string;
        title: string;
        due_at: string;
        priority: Priority;
        overdue: boolean;
        related_type: "lead" | "deal" | "client" | null;
        related_name: string | null;
      }[]
    | null;
  todays_meetings:
    | {
        id: string;
        title: string;
        starts_at: string;
        ends_at: string | null;
        location: string | null;
        meeting_url: string | null;
        status: string;
        related_name: string | null;
      }[]
    | null;
  my_tasks: {
    id: string;
    title: string;
    status: string;
    priority: Priority;
    due_at: string | null;
    overdue: boolean;
    project_name: string | null;
  }[];
  pending_approvals:
    | {
        id: string;
        title: string;
        platform: string;
        publish_at: string | null;
        stage_key: string;
        stage_name: string;
        stage_color: string;
        client_name: string;
      }[]
    | null;
  recent_proposals:
    | {
        id: string;
        number: string;
        title: string;
        status: string;
        total: Decimal;
        currency: string;
        company_name: string;
        updated_at: string;
      }[]
    | null;
  project_progress:
    | {
        id: string;
        name: string;
        status: string;
        deadline: string | null;
        client_name: string | null;
        total_tasks: number;
        done_tasks: number;
      }[]
    | null;
  insights: { configured: boolean; items: string[] };
}

export type Priority = "low" | "medium" | "high" | "urgent";
