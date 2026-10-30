/** Agency operations types — mirror backend/src/routes/{projects,content,websites}. */

import type { Priority } from "./api";

export type ProjectStatus = "planning" | "active" | "on_hold" | "completed" | "cancelled";
export type TaskStatus = "todo" | "in_progress" | "in_review" | "blocked" | "done";

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "To do",
  in_progress: "In progress",
  in_review: "In review",
  blocked: "Blocked",
  done: "Done",
};

export interface Project {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  status: ProjectStatus;
  priority: Priority;
  client_id: string | null;
  client_name: string | null;
  start_date: string | null;
  deadline: string | null;
  completed_at: string | null;
  owner_id: string | null;
  owner_name: string | null;
  deliverables: string[];
  total_tasks: number;
  done_tasks: number;
  overdue_tasks: number;
  members: { id: string; name: string; role: string | null }[];
  created_at: string;
}

export interface ProjectTemplate {
  key: string;
  name: string;
  category: string;
  tasks: string[];
}

export interface Task {
  id: string;
  project_id: string | null;
  project_name: string | null;
  client_id: string | null;
  client_name: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: Priority;
  assignee_id: string | null;
  assignee_name: string | null;
  reporter_id: string | null;
  reporter_name: string | null;
  due_at: string | null;
  overdue: boolean;
  position: number;
  completed_at: string | null;
  subtasks_total: number;
  subtasks_done: number;
  comments: number;
  created_at: string;
}

export interface TaskDetail extends Task {
  subtasks: { id: string; title: string; is_done: boolean; position: number }[];
  comment_list: { id: string; body: string; author_id: string | null; author_name: string | null; created_at: string }[];
}

export type Platform = "facebook" | "instagram" | "tiktok" | "linkedin" | "x" | "youtube" | "google_business" | "website" | "other";

export const PLATFORM_LABELS: Record<Platform, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
  x: "X",
  youtube: "YouTube",
  google_business: "Google Business",
  website: "Website / blog",
  other: "Other",
};

export const CONTENT_TYPES = ["image", "carousel", "video", "reel", "story", "text", "article", "other"] as const;

export interface Post {
  id: string;
  client_id: string;
  client_name: string;
  title: string;
  platform: Platform;
  content_type: (typeof CONTENT_TYPES)[number];
  category: string | null;
  campaign: string | null;
  caption: string | null;
  hashtags: string[];
  stage_id: string;
  stage_key: string;
  stage_name: string;
  stage_color: string;
  designer_id: string | null;
  designer_name: string | null;
  creator_id: string | null;
  creator_name: string | null;
  due_at: string | null;
  publish_at: string | null;
  published_at: string | null;
  published_url: string | null;
  assets: number;
  last_feedback: string | null;
  created_at: string;
  updated_at: string;
}

export interface Asset {
  id: string;
  client_id: string;
  client_name: string;
  post_id: string | null;
  file_id: string;
  asset_type: string;
  title: string | null;
  tags: string[];
  original_name: string;
  content_type: string;
  size_bytes: number;
  uploaded_by_name: string | null;
  created_at: string;
  preview_url: string | null;
}

export interface PostDetail extends Post {
  approvals: {
    id: string;
    decision: "approved" | "changes_requested" | "rejected";
    feedback: string | null;
    reviewer_type: string;
    reviewer_name: string | null;
    revision: number;
    created_at: string;
  }[];
  asset_list: Asset[];
}

export interface Website {
  id: string;
  client_id: string;
  client_name: string;
  name: string;
  domain: string;
  url: string | null;
  status: "in_development" | "active" | "paused" | "archived";
  hosting_provider: string | null;
  tech_stack: string[];
  domain_registrar: string | null;
  domain_expires_on: string | null;
  hosting_renews_on: string | null;
  ssl_expires_on: string | null;
  maintenance_frequency: "none" | "weekly" | "monthly" | "quarterly";
  developer_id: string | null;
  developer_name: string | null;
  backup_notes: string | null;
  notes: string | null;
  last_checked_at: string | null;
  last_status_code: number | null;
  is_up: boolean | null;
  uptime_7d: number | null;
  avg_response_ms: number | null;
  open_maintenance: number;
  last_maintenance_at: string | null;
  created_at: string;
}

export interface WebsiteDetail extends Website {
  checks: { checked_at: string; ok: boolean; status_code: number | null; response_ms: number | null; error: string | null }[];
  secrets: { id: string; label: string; login_url: string | null; username: string | null; created_by_name: string | null; updated_at: string }[];
  vault_configured: boolean;
}

export const MAINTENANCE_TYPES: Record<string, string> = {
  content_update: "Content update",
  plugin_update: "Plugin / core update",
  security_check: "Security check",
  backup: "Backup",
  performance_check: "Performance check",
  uptime_check: "Uptime check",
  ssl_renewal: "SSL renewal",
  domain_renewal: "Domain renewal",
  hosting_renewal: "Hosting renewal",
  other: "Other",
};

export interface Maintenance {
  id: string;
  website_id: string;
  website_name: string;
  domain: string;
  client_name: string;
  task_type: string;
  title: string;
  notes: string | null;
  status: "scheduled" | "in_progress" | "done" | "skipped";
  scheduled_for: string | null;
  assigned_to: string | null;
  assigned_name: string | null;
  completed_at: string | null;
  completed_by_name: string | null;
  overdue: boolean;
  created_at: string;
}

export interface Workload {
  id: string;
  full_name: string;
  roles: string[];
  open_tasks: number;
  overdue_tasks: number;
  done_last_30d: number;
  active_leads: number;
  open_deals: number;
  won_last_30d: number;
  pending_follow_ups: number;
  open_content: number;
  open_maintenance: number;
}

export interface AuditRow {
  id: number;
  actor_name: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  changes: Record<string, unknown> | null;
  created_at: string;
}
