import type { LucideIcon } from "lucide-react";
import { RefreshCw, TriangleAlert } from "lucide-react";
import type * as React from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/misc";
import { errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";

/** Shown when a section has loaded but has no records yet. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  compact,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        compact ? "gap-2 py-6" : "gap-3 py-12",
        className,
      )}
    >
      <div className="flex size-11 items-center justify-center rounded-2xl border border-line bg-raised text-subtle">
        <Icon className="size-5" />
      </div>
      <div className="max-w-xs">
        <p className="text-sm font-medium text-fg">{title}</p>
        {description && <p className="mt-1 text-[13px] leading-relaxed text-subtle">{description}</p>}
      </div>
      {action}
    </div>
  );
}

/** Shown when a request failed; always offers a retry. */
export function ErrorState({
  error,
  onRetry,
  className,
  compact,
}: {
  error: unknown;
  onRetry?: () => void;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      role="alert"
      className={cn("flex flex-col items-center justify-center gap-3 text-center", compact ? "py-6" : "py-12", className)}
    >
      <div className="flex size-11 items-center justify-center rounded-2xl border border-danger/25 bg-danger-soft text-danger">
        <TriangleAlert className="size-5" />
      </div>
      <div className="max-w-sm">
        <p className="text-sm font-medium text-fg">Couldn't load this</p>
        <p className="mt-1 text-[13px] leading-relaxed text-muted">{errorMessage(error)}</p>
      </div>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          <RefreshCw /> Try again
        </Button>
      )}
    </div>
  );
}

/** Placeholder rows matching a list's rhythm while it loads. */
export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="size-9 rounded-xl" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-3.5 w-3/5" />
            <Skeleton className="h-3 w-2/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function FullScreenLoader({ label = "Loading ODDLY…" }: { label?: string }) {
  return (
    <div className="flex h-full items-center justify-center bg-canvas">
      <div className="flex flex-col items-center gap-4">
        <div className="size-8 animate-spin rounded-full border-2 border-line border-t-accent" />
        <p className="text-sm text-subtle">{label}</p>
      </div>
    </div>
  );
}
