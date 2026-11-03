import {
  Building2,
  ChartColumn,
  FolderKanban,
  Globe,
  Handshake,
  LayoutDashboard,
  Palette,
  Settings,
  Sparkles,
  Users,
  type LucideIcon,
} from "lucide-react";

/**
 * Single source of truth for the sidebar, the command palette and the route table.
 * A module with `phase` > 1 renders its roadmap page until it is built.
 */
export interface NavChild {
  label: string;
  path: string;
  permission?: string;
}

export interface NavModule {
  id: string;
  label: string;
  icon: LucideIcon;
  path: string;
  /** Permission needed to see the module at all. */
  permission?: string;
  phase: number;
  summary: string;
  planned: string[];
  children?: NavChild[];
}

export interface NavSection {
  label: string;
  modules: NavModule[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    label: "Main menu",
    modules: [
      {
        id: "dashboard",
        label: "Dashboard",
        icon: LayoutDashboard,
        path: "/",
        permission: "dashboard.view",
        phase: 1,
        summary: "Overview of agency operations.",
        planned: [],
      },
    ],
  },
  {
    label: "Sales",
    modules: [
      {
        id: "leads",
        label: "Lead Management",
        icon: Users,
        path: "/leads",
        permission: "leads.view",
        phase: 2,
        summary: "Replace the lead spreadsheets: collect, research and organize every business you prospect.",
        planned: [
          "Lead records with business, contact, social and market details",
          "XLSX / CSV import with column mapping, preview, validation and error report",
          "Duplicate detection, and updating existing leads during import",
          "Named lead lists and campaigns with their own team and progress",
          "Research workspace with an AI opportunity analyzer (clearly labeled as suggestions)",
          "Bulk edit, bulk assignment, saved filters and export",
        ],
        children: [
          { label: "All Leads", path: "/leads" },
          { label: "Local Leads", path: "/leads/local" },
          { label: "International Leads", path: "/leads/international" },
          { label: "Lead Lists", path: "/leads/lists" },
          { label: "Lead Research", path: "/leads/research" },
          { label: "Import / Export", path: "/leads/import", permission: "leads.import" },
          { label: "Duplicate Management", path: "/leads/duplicates", permission: "leads.edit" },
        ],
      },
      {
        id: "sales",
        label: "CRM & Sales",
        icon: Handshake,
        path: "/sales",
        permission: "sales.view",
        phase: 3,
        summary: "Move prospects through the pipeline, log every touchpoint and close deals.",
        planned: [
          "Kanban pipeline with admin-customizable stages",
          "Activity timeline: calls, emails, Facebook / Instagram messages, visits, notes",
          "Follow-up reminders with due dates, recurrence and overdue flags",
          "Meetings with participants, notes, outcomes and next actions",
          "Proposal builder with pricing, discounts, taxes, versions and PDF export",
          "One-click lead → client conversion when a deal is won",
        ],
        children: [
          { label: "Sales Pipeline", path: "/sales/pipeline" },
          { label: "Outreach History", path: "/sales/outreach" },
          { label: "Follow-ups", path: "/sales/follow-ups" },
          { label: "Meetings", path: "/sales/meetings" },
          { label: "Proposals", path: "/sales/proposals", permission: "proposals.view" },
          { label: "Deals", path: "/sales/deals" },
        ],
      },
      {
        id: "clients",
        label: "Clients",
        icon: Building2,
        path: "/clients",
        permission: "clients.view",
        phase: 4,
        summary: "A workspace for every client: contacts, services, contracts, files and history.",
        planned: [
          "Client profiles created from won leads without re-entering data",
          "Services, packages, pricing and billing information",
          "Contracts with files and renewal dates",
          "Communication history and activity timeline",
          "Client statuses: onboarding, active, awaiting client, at risk…",
        ],
        children: [
          { label: "Active Clients", path: "/clients" },
          { label: "Client Profiles", path: "/clients/profiles" },
          { label: "Services & Packages", path: "/clients/services" },
          { label: "Contracts", path: "/clients/contracts" },
          { label: "Client History", path: "/clients/history" },
        ],
      },
    ],
  },
  {
    label: "Operations",
    modules: [
      {
        id: "content",
        label: "Content Studio",
        icon: Palette,
        path: "/content",
        permission: "content.view",
        phase: 5,
        summary: "Plan, design, approve and publish client content.",
        planned: [
          "Monthly, weekly and daily content calendar",
          "Posts with platform, caption, hashtags, media and assignments",
          "Customizable workflow from Idea to Published",
          "Client-organized media library with previews and upload progress",
          "Internal approvals with feedback and revision history",
        ],
        children: [
          { label: "Content Calendar", path: "/content/calendar" },
          { label: "Content Planner", path: "/content/planner" },
          { label: "Graphics & Media", path: "/content/media" },
          { label: "Captions", path: "/content/captions" },
          { label: "Post Approvals", path: "/content/approvals" },
          { label: "Published Content", path: "/content/published" },
        ],
      },
      {
        id: "websites",
        label: "Website Management",
        icon: Globe,
        path: "/websites",
        permission: "websites.view",
        phase: 5,
        summary: "Every client website, its domain, hosting, SSL and maintenance in one place.",
        planned: [
          "Website records with domain, hosting, stack and renewal dates",
          "Maintenance tasks, schedules and history",
          "Domain, hosting and SSL expiry reminders",
          "Uptime and SSL monitoring",
          "Encrypted credential vault (never stored in plain text)",
        ],
        children: [
          { label: "Client Websites", path: "/websites" },
          { label: "Website Maintenance", path: "/websites/maintenance" },
          { label: "Domain Management", path: "/websites/domains" },
          { label: "Hosting Information", path: "/websites/hosting" },
          { label: "Website Monitoring", path: "/websites/monitoring" },
        ],
      },
      {
        id: "projects",
        label: "Projects & Tasks",
        icon: FolderKanban,
        path: "/projects",
        permission: "projects.view",
        phase: 5,
        summary: "Run client projects and the team's day-to-day tasks.",
        planned: [
          "Projects per client with deliverables, files and comments",
          "Tasks with subtasks, assignees, priorities and deadlines",
          "Kanban board and calendar views",
          "Personal task dashboard",
          "Reusable project templates for common services",
        ],
        children: [
          { label: "All Projects", path: "/projects" },
          { label: "My Tasks", path: "/projects/my-tasks" },
          { label: "Team Tasks", path: "/projects/team-tasks" },
          { label: "Kanban Board", path: "/projects/board" },
          { label: "Calendar", path: "/projects/calendar" },
        ],
      },
    ],
  },
  {
    label: "Insights",
    modules: [
      {
        id: "analytics",
        label: "Analytics",
        icon: ChartColumn,
        path: "/analytics",
        permission: "analytics.view",
        phase: 6,
        summary: "Lead, sales, client, financial and team reports with CSV and PDF export.",
        planned: [
          "Leads by market, country, industry and source; conversion rates",
          "Won / lost deals, proposal acceptance, pipeline value",
          "Revenue by period and by currency (never mixed without a documented rate)",
          "Client retention and services purchased",
          "Team workload, overdue tasks and deals closed",
        ],
        children: [
          { label: "Lead Analytics", path: "/analytics/leads" },
          { label: "Sales Analytics", path: "/analytics/sales" },
          { label: "Client Analytics", path: "/analytics/clients", permission: "clients.view" },
          { label: "Financial Reports", path: "/analytics/finance", permission: "finance.view" },
          { label: "Team Performance", path: "/analytics/team", permission: "team.view" },
        ],
      },
      {
        id: "ai",
        label: "AI Assistant",
        icon: Sparkles,
        path: "/ai",
        permission: "ai.use",
        phase: 6,
        summary: "An assistant that understands the agency data you're allowed to see.",
        planned: [
          "Lead opportunity analysis and suggested services",
          "Personalized outreach and follow-up drafts",
          "Meeting, client-history and pipeline summaries",
          "Content ideas and caption suggestions",
          "Weekly agency summary — nothing is sent or changed without your confirmation",
        ],
        children: [
          { label: "Assistant", path: "/ai" },
          { label: "Draft Writer", path: "/ai/drafts" },
        ],
      },
    ],
  },
  {
    label: "Workspace",
    modules: [
      {
        id: "settings",
        label: "Settings",
        icon: Settings,
        path: "/settings",
        phase: 1,
        summary: "Your profile, the team, roles and workspace preferences.",
        planned: [],
        children: [
          { label: "My Profile", path: "/settings/profile" },
          { label: "Team Members", path: "/settings/team", permission: "team.view" },
          { label: "Roles & Permissions", path: "/settings/roles", permission: "team.view" },
          { label: "Activity Log", path: "/settings/activity", permission: "audit.view" },
          { label: "Services & Packages", path: "/settings/services", permission: "settings.manage" },
          { label: "Integrations", path: "/settings/integrations", permission: "settings.manage" },
          { label: "System Preferences", path: "/settings/preferences", permission: "settings.manage" },
        ],
      },
    ],
  },
];

export const ALL_MODULES = NAV_SECTIONS.flatMap((s) => s.modules);

/** Planned features for Settings pages that aren't built yet. */
export const SETTINGS_ROADMAP: Record<string, { phase: number; summary: string; planned: string[] }> = {
  "/settings/services": {
    phase: 4,
    summary: "The agency's service catalog, used in proposals and client services.",
    planned: ["Services with category, billing type and default price", "Packages that bundle services"],
  },
  "/settings/integrations": {
    phase: 6,
    summary: "Connect ODDLY to other tools through their official APIs.",
    planned: [
      "OpenAI for the AI assistant (configured on the server)",
      "Email and calendar integrations",
      "Each integration shows its real connection status — nothing is shown as connected until it is",
    ],
  },
  "/settings/preferences": {
    phase: 7,
    summary: "Workspace-wide defaults.",
    planned: ["Default currency and markets", "Pipeline and content workflow stages", "Notification preferences"],
  },
};
