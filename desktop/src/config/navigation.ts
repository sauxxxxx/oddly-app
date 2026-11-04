import {
  Building2,
  ChartColumn,
  FolderKanban,
  Globe,
  Handshake,
  LayoutDashboard,
  Palette,
  Settings,
  Bot,
  Users,
  type LucideIcon,
} from "lucide-react";

/**
 * Single source of truth for the sidebar, the command palette and the route table.
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
        icon: Bot,
        path: "/ai",
        permission: "ai.use",
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
        children: [
          { label: "My Profile", path: "/settings/profile" },
          { label: "Team Members", path: "/settings/team", permission: "team.view" },
          { label: "Roles & Permissions", path: "/settings/roles", permission: "team.view" },
          { label: "Activity Log", path: "/settings/activity", permission: "audit.view" },
          { label: "Services & Packages", path: "/settings/services", permission: "settings.manage" },
          { label: "Integrations", path: "/settings/integrations", permission: "settings.manage" },
        ],
      },
    ],
  },
];

export const ALL_MODULES = NAV_SECTIONS.flatMap((s) => s.modules);

