import { LogOut, ShieldAlert } from "lucide-react";
import { Navigate, Outlet, useLocation } from "react-router";

import { ErrorState, FullScreenLoader } from "@/components/states";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";

import { useAuth } from "./auth-context";
import { AuthLayout } from "./auth-layout";

/** Gate for every signed-in route. */
export function RequireAuth() {
  const { session, me, meLoading, meError, retryMe, signOut } = useAuth();
  const location = useLocation();

  if (session === undefined) return <FullScreenLoader />;
  if (!session) return <Navigate to="/login" replace />;
  if (meLoading) return <FullScreenLoader label="Loading your workspace…" />;

  if (meError || !me) {
    const blocked = meError instanceof ApiError && meError.status === 403;
    return (
      <AuthLayout
        title={blocked ? "Access unavailable" : "Can't load your workspace"}
        subtitle={session.user.email ?? ""}
      >
        {blocked ? (
          <div className="flex flex-col gap-5">
            <div className="flex gap-3 rounded-card border border-warning/25 bg-warning-soft p-4 text-sm text-warning-fg">
              <ShieldAlert className="mt-0.5 size-5 shrink-0" />
              <p>{(meError as ApiError).message}</p>
            </div>
            <Button variant="secondary" onClick={() => void signOut()}>
              <LogOut /> Sign out
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <ErrorState error={meError} onRetry={retryMe} compact />
            <Button variant="ghost" onClick={() => void signOut()}>
              <LogOut /> Sign out
            </Button>
          </div>
        )}
      </AuthLayout>
    );
  }

  if (me.must_change_password && location.pathname !== "/change-password") {
    return <Navigate to="/change-password" replace />;
  }

  return <Outlet />;
}
