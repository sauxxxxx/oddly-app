import { RefreshCw } from "lucide-react";
import { useRouteError } from "react-router";

import { Button } from "@/components/ui/button";

/** Shown instead of a blank screen when a page crashes while rendering. */
export function RouteError() {
  const error = useRouteError();
  const message = error instanceof Error ? error.message : "An unexpected error occurred.";
  console.error(error);

  return (
    <div className="flex h-full items-center justify-center bg-canvas p-8">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <div>
          <h1 className="text-lg font-semibold">Something went wrong on this screen</h1>
          <p className="mt-1.5 text-sm text-muted">Your data is safe. Reload to continue.</p>
          <p className="mt-3 rounded-control border border-line bg-raised px-3 py-2 font-mono text-xs text-subtle">{message}</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => window.location.reload()}>
            <RefreshCw /> Reload
          </Button>
          <Button variant="secondary" onClick={() => window.location.assign("#/")}>
            Go to dashboard
          </Button>
        </div>
      </div>
    </div>
  );
}
