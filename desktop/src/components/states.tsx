import { RefreshCw } from "lucide-react";
import type * as React from "react";

import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";

/** Shown when a section has loaded but has no records yet. */
export function EmptyState({
  title,
  description,
  action,
  className,
  compact,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div className={cn("flex flex-col items-start gap-3 text-sm", compact ? "py-3" : "px-5 py-8", className)}>
      <div>
        <p className="text-muted">{title}</p>
        {description && <p className="mt-1 max-w-md text-[13px] text-subtle">{description}</p>}
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
      className={cn("flex flex-col items-start gap-3 text-sm", compact ? "py-3" : "px-5 py-8", className)}
    >
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

/** Plain loading line, used wherever a list or page is fetching. */
export function ListSkeleton(_: { rows?: number }) {
  return (
    <p className="text-sm text-subtle" aria-busy="true">
      Loading…
    </p>
  );
}

export function FullScreenLoader({ label = "Loading ODDLY…" }: { label?: string }) {
  return (
    <div className="flex h-full items-center justify-center bg-canvas">
      <p className="text-sm text-subtle">{label}</p>
    </div>
  );
}
