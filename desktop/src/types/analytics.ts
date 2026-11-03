/** Shapes returned by /analytics/*. Money is a decimal string and always paired with its currency. */

export interface ReportRange {
  from: string;
  to: string;
  bucket: "day" | "week" | "month";
}

export interface CountRow {
  label: string;
  count: number;
}

export interface MoneyRow {
  label: string;
  currency: string;
  amount: string;
  count: number;
}

export interface TrendPoint {
  bucket: string;
  series: string;
  value: string;
}

export interface LeadReport {
  range: ReportRange;
  totals: {
    total: number;
    active: number;
    new_in_range: number;
    new_previous: number;
    contacted: number;
    converted: number;
    never_contacted: number;
  };
  by_market: CountRow[];
  by_country: CountRow[];
  by_industry: CountRow[];
  by_source: CountRow[];
  by_stage: CountRow[];
  by_status: CountRow[];
  by_owner: { label: string; assigned: number; contacted: number; converted: number; interactions: number }[];
  trend: TrendPoint[];
}

export interface SalesReport {
  range: ReportRange;
  totals: {
    deals_open: number;
    deals_won: number;
    deals_lost: number;
    proposals_sent: number;
    proposals_accepted: number;
    proposals_rejected: number;
    avg_days_to_decision: number | null;
    interactions: number;
    meetings: number;
  };
  /** Null when the user lacks finance.view. */
  won_by_currency: MoneyRow[] | null;
  pipeline_by_currency: MoneyRow[] | null;
  won_by_owner: MoneyRow[] | null;
  revenue_trend: TrendPoint[] | null;
  lost_reasons: CountRow[];
  outreach_by_channel: CountRow[];
}

export interface ClientReport {
  range: ReportRange;
  totals: {
    current: number;
    new_in_range: number;
    new_previous: number;
    retained_90d: number;
    inactive: number;
    completed: number;
    at_risk: number;
  };
  by_status: CountRow[];
  by_market: CountRow[];
  by_industry: CountRow[];
  services: { label: string; clients: number; active: number }[];
  growth: TrendPoint[];
  by_manager: CountRow[];
}

export interface FinanceReport {
  range: ReportRange;
  won: { currency: string; amount: string; previous_amount: string; deals: number }[];
  recurring_monthly: MoneyRow[];
  active_contracts: MoneyRow[];
  proposals_pending: MoneyRow[];
  revenue_trend: TrendPoint[];
  top_clients: MoneyRow[];
  by_service_category: MoneyRow[];
  note: string;
}

export interface MemberPerformance {
  id: string;
  full_name: string;
  tasks_completed: number;
  tasks_overdue: number;
  tasks_on_time: number;
  leads_handled: number;
  interactions: number;
  follow_ups_done: number;
  deals_won: number;
  projects_completed: number;
  projects_owned: number;
  content_published: number;
  maintenance_done: number;
}

export interface TeamReport {
  range: ReportRange;
  members: MemberPerformance[];
}
