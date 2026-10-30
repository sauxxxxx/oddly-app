import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TriangleAlert } from "lucide-react";
import { createHashRouter, Navigate, RouterProvider } from "react-router";

import { AppShell } from "@/components/layout/app-shell";
import { RouteError } from "@/components/route-error";
import { TooltipProvider } from "@/components/ui/misc";
import { AuthProvider } from "@/features/auth/auth-context";
import { AuthLayout } from "@/features/auth/auth-layout";
import { ChangePasswordPage } from "@/features/auth/change-password-page";
import { LoginPage } from "@/features/auth/login-page";
import { RequireAuth } from "@/features/auth/require-auth";
import { SetupPage } from "@/features/auth/setup-page";
import { DashboardPage } from "@/features/dashboard/dashboard-page";
import { ModuleRoadmapPage } from "@/features/roadmap/module-roadmap-page";
import { ProfilePage } from "@/features/settings/profile-page";
import { RolesPage } from "@/features/settings/roles-page";
import { TeamPage } from "@/features/settings/team-page";
import { ApiError } from "@/lib/api";
import { missingEnv } from "@/lib/env";

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
              { path: "settings", element: <Navigate to="/settings/profile" replace /> },
              { path: "settings/profile", element: <ProfilePage /> },
              { path: "settings/team", element: <TeamPage /> },
              { path: "settings/roles", element: <RolesPage /> },
              { path: "*", element: <ModuleRoadmapPage /> },
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
      <div className="flex gap-3 rounded-card border border-warning/25 bg-warning-soft p-4 text-sm text-[#fde047]">
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
