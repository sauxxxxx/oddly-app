import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TriangleAlert } from "lucide-react";
import * as React from "react";
import { createHashRouter, Navigate, RouterProvider } from "react-router";

import { AppShell } from "@/components/layout/app-shell";
import { registerAiExtensions } from "@/features/ai/extensions";
import { RouteError } from "@/components/route-error";
import { TooltipProvider } from "@/components/ui/misc";
import { AuthProvider } from "@/features/auth/auth-context";
import { AuthLayout } from "@/features/auth/auth-layout";
import { ChangePasswordPage } from "@/features/auth/change-password-page";
import { LoginPage } from "@/features/auth/login-page";
import { RequireAuth } from "@/features/auth/require-auth";
import { SetupPage } from "@/features/auth/setup-page";
import { DashboardPage } from "@/features/dashboard/dashboard-page";
import { registerClientOpsExtensions } from "@/features/ops/client-extensions";
import { NotFoundPage } from "@/components/not-found-page";
import { registerLeadSalesExtensions } from "@/features/sales/lead-extensions";
import { ApiError } from "@/lib/api";
import { missingEnv } from "@/lib/env";

/** Route pages load on first visit, keeping the startup bundle small. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- props are kept via M[K]
function page<M extends Record<K, React.ComponentType<any>>, K extends string>(load: () => Promise<M>, name: K) {
  return React.lazy<M[K]>(() => load().then((m) => ({ default: m[name] })));
}

const IntegrationsPage = page(() => import("@/features/settings/integrations-page"), "IntegrationsPage");
const AssistantPage = page(() => import("@/features/ai/assistant-page"), "AssistantPage");
const DraftWriterPage = page(() => import("@/features/ai/assistant-page"), "DraftWriterPage");
const ClientAnalyticsPage = page(() => import("@/features/analytics/analytics-pages"), "ClientAnalyticsPage");
const FinanceReportsPage = page(() => import("@/features/analytics/analytics-pages"), "FinanceReportsPage");
const LeadAnalyticsPage = page(() => import("@/features/analytics/analytics-pages"), "LeadAnalyticsPage");
const SalesAnalyticsPage = page(() => import("@/features/analytics/analytics-pages"), "SalesAnalyticsPage");
const TeamPerformancePage = page(() => import("@/features/analytics/analytics-pages"), "TeamPerformancePage");
const ClientDetailPage = page(() => import("@/features/clients/client-detail-page"), "ClientDetailPage");
const ClientHistoryPage = page(() => import("@/features/clients/clients-page"), "ClientHistoryPage");
const ClientProfilesPage = page(() => import("@/features/clients/clients-page"), "ClientProfilesPage");
const ClientsPage = page(() => import("@/features/clients/clients-page"), "ClientsPage");
const ContractsPage = page(() => import("@/features/clients/contracts-page"), "ContractsPage");
const ServicesCatalogPage = page(() => import("@/features/clients/services-page"), "ServicesCatalogPage");
const ApprovalsPage = page(() => import("@/features/content/content-pages"), "ApprovalsPage");
const CaptionsPage = page(() => import("@/features/content/content-pages"), "CaptionsPage");
const ContentCalendarPage = page(() => import("@/features/content/content-pages"), "ContentCalendarPage");
const ContentPlannerPage = page(() => import("@/features/content/content-pages"), "ContentPlannerPage");
const MediaLibraryPage = page(() => import("@/features/content/content-pages"), "MediaLibraryPage");
const PublishedPage = page(() => import("@/features/content/content-pages"), "PublishedPage");
const DuplicatesPage = page(() => import("@/features/leads/duplicates-page"), "DuplicatesPage");
const ImportExportPage = page(() => import("@/features/leads/import-export-page"), "ImportExportPage");
const LeadDetailPage = page(() => import("@/features/leads/lead-detail-page"), "LeadDetailPage");
const LeadListDetailPage = page(() => import("@/features/leads/lead-lists-page"), "LeadListDetailPage");
const LeadListsPage = page(() => import("@/features/leads/lead-lists-page"), "LeadListsPage");
const LeadsPage = page(() => import("@/features/leads/leads-page"), "LeadsPage");
const LeadResearchPage = page(() => import("@/features/leads/research-page"), "LeadResearchPage");
const MyTasksPage = page(() => import("@/features/projects/projects-pages"), "MyTasksPage");
const ProjectDetailPage = page(() => import("@/features/projects/projects-pages"), "ProjectDetailPage");
const ProjectsPage = page(() => import("@/features/projects/projects-pages"), "ProjectsPage");
const TaskBoardPage = page(() => import("@/features/projects/projects-pages"), "TaskBoardPage");
const TaskCalendarPage = page(() => import("@/features/projects/projects-pages"), "TaskCalendarPage");
const TeamTasksPage = page(() => import("@/features/projects/projects-pages"), "TeamTasksPage");
const FollowUpsPage = page(() => import("@/features/sales/activity-pages"), "FollowUpsPage");
const MeetingsPage = page(() => import("@/features/sales/activity-pages"), "MeetingsPage");
const OutreachPage = page(() => import("@/features/sales/activity-pages"), "OutreachPage");
const DealsPage = page(() => import("@/features/sales/deals-page"), "DealsPage");
const PipelinePage = page(() => import("@/features/sales/pipeline-page"), "PipelinePage");
const ProposalEditorPage = page(() => import("@/features/sales/proposal-editor-page"), "ProposalEditorPage");
const ProposalsPage = page(() => import("@/features/sales/proposals-page"), "ProposalsPage");
const ProfilePage = page(() => import("@/features/settings/profile-page"), "ProfilePage");
const RolesPage = page(() => import("@/features/settings/roles-page"), "RolesPage");
const AuditLogPage = page(() => import("@/features/settings/team-extras"), "AuditLogPage");
const TeamPage = page(() => import("@/features/settings/team-page"), "TeamPage");
const DomainsPage = page(() => import("@/features/websites/websites-pages"), "DomainsPage");
const HostingPage = page(() => import("@/features/websites/websites-pages"), "HostingPage");
const MaintenancePage = page(() => import("@/features/websites/websites-pages"), "MaintenancePage");
const MonitoringPage = page(() => import("@/features/websites/websites-pages"), "MonitoringPage");
const WebsiteDetailPage = page(() => import("@/features/websites/websites-pages"), "WebsiteDetailPage");
const WebsitesPage = page(() => import("@/features/websites/websites-pages"), "WebsitesPage");

registerLeadSalesExtensions();
registerClientOpsExtensions();
registerAiExtensions();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      // Don't hammer the API on permission or validation errors.
      retry: (count, err) => count < 2 && !(err instanceof ApiError && err.status >= 400 && err.status < 500),
    },
  },
});

// Hash routing: the desktop app is served from local files, where deep paths can't be resolved.
const router = createHashRouter([
  {
    errorElement: <RouteError />,
    children: [
      { path: "/login", element: <LoginPage /> },
      { path: "/setup", element: <SetupPage /> },
      {
        element: <RequireAuth />,
        children: [
          { path: "/change-password", element: <ChangePasswordPage /> },
          {
            element: <AppShell />,
            children: [
              { index: true, element: <DashboardPage /> },
              { path: "leads", element: <LeadsPage key="all" /> },
              { path: "leads/local", element: <LeadsPage key="local" market="local" /> },
              { path: "leads/international", element: <LeadsPage key="intl" market="international" /> },
              { path: "leads/lists", element: <LeadListsPage /> },
              { path: "leads/lists/:id", element: <LeadListDetailPage /> },
              { path: "leads/research", element: <LeadResearchPage /> },
              { path: "leads/import", element: <ImportExportPage /> },
              { path: "leads/duplicates", element: <DuplicatesPage /> },
              { path: "leads/record/:id", element: <LeadDetailPage /> },
              { path: "sales", element: <Navigate to="/sales/pipeline" replace /> },
              { path: "sales/pipeline", element: <PipelinePage /> },
              { path: "sales/outreach", element: <OutreachPage /> },
              { path: "sales/follow-ups", element: <FollowUpsPage /> },
              { path: "sales/meetings", element: <MeetingsPage /> },
              { path: "sales/proposals", element: <ProposalsPage /> },
              { path: "sales/proposals/:id", element: <ProposalEditorPage /> },
              { path: "sales/deals", element: <DealsPage /> },
              { path: "clients", element: <ClientsPage /> },
              { path: "clients/profiles", element: <ClientProfilesPage /> },
              { path: "clients/services", element: <ServicesCatalogPage /> },
              { path: "clients/contracts", element: <ContractsPage /> },
              { path: "clients/history", element: <ClientHistoryPage /> },
              { path: "clients/record/:id", element: <ClientDetailPage /> },
              { path: "settings/services", element: <ServicesCatalogPage /> },
              { path: "settings/activity", element: <AuditLogPage /> },
              { path: "settings/integrations", element: <IntegrationsPage /> },
              { path: "projects", element: <ProjectsPage /> },
              { path: "projects/record/:id", element: <ProjectDetailPage /> },
              { path: "projects/my-tasks", element: <MyTasksPage /> },
              { path: "projects/team-tasks", element: <TeamTasksPage /> },
              { path: "projects/board", element: <TaskBoardPage /> },
              { path: "projects/calendar", element: <TaskCalendarPage /> },
              { path: "content", element: <Navigate to="/content/calendar" replace /> },
              { path: "content/calendar", element: <ContentCalendarPage /> },
              { path: "content/planner", element: <ContentPlannerPage /> },
              { path: "content/media", element: <MediaLibraryPage /> },
              { path: "content/captions", element: <CaptionsPage /> },
              { path: "content/approvals", element: <ApprovalsPage /> },
              { path: "content/published", element: <PublishedPage /> },
              { path: "websites", element: <WebsitesPage /> },
              { path: "websites/record/:id", element: <WebsiteDetailPage /> },
              { path: "websites/maintenance", element: <MaintenancePage /> },
              { path: "websites/domains", element: <DomainsPage /> },
              { path: "websites/hosting", element: <HostingPage /> },
              { path: "websites/monitoring", element: <MonitoringPage /> },
              { path: "ai", element: <AssistantPage /> },
              { path: "ai/chat/:id", element: <AssistantPage /> },
              { path: "ai/drafts", element: <DraftWriterPage /> },
              { path: "analytics", element: <Navigate to="/analytics/leads" replace /> },
              { path: "analytics/leads", element: <LeadAnalyticsPage /> },
              { path: "analytics/sales", element: <SalesAnalyticsPage /> },
              { path: "analytics/clients", element: <ClientAnalyticsPage /> },
              { path: "analytics/finance", element: <FinanceReportsPage /> },
              { path: "analytics/team", element: <TeamPerformancePage /> },
              { path: "settings", element: <Navigate to="/settings/profile" replace /> },
              { path: "settings/profile", element: <ProfilePage /> },
              { path: "settings/team", element: <TeamPage /> },
              { path: "settings/roles", element: <RolesPage /> },
              { path: "*", element: <NotFoundPage /> },
            ],
          },
        ],
      },
    ],
  },
]);

export function App() {
  if (missingEnv.length > 0) return <MissingConfig keys={missingEnv} />;

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <RouterProvider router={router} />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

function MissingConfig({ keys }: { keys: string[] }) {
  return (
    <AuthLayout title="ODDLY isn't configured yet" subtitle="This build is missing settings it needs to connect.">
      <div className="flex gap-3 rounded-card border border-warning/25 bg-warning-soft p-4 text-sm text-warning-fg">
        <TriangleAlert className="mt-0.5 size-5 shrink-0" />
        <div>
          <p>
            Add these to <code className="font-mono">desktop/.env</code> and restart:
          </p>
          <ul className="mt-2 list-disc pl-5 font-mono text-[13px]">
            {keys.map((k) => (
              <li key={k}>{k}</li>
            ))}
          </ul>
        </div>
      </div>
    </AuthLayout>
  );
}
