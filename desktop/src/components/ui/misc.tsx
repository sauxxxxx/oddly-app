import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import * as React from "react";

import { cn, initials } from "@/lib/utils";

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("animate-pulse rounded-lg bg-raised", className)} {...props} />;
}

export function Avatar({ name, className }: { name: string; className?: string }) {
  // Stable hue per name so teammates are recognisable at a glance.
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  const hues = [270, 290, 310, 250, 330, 230];
  const hue = hues[Math.abs(hash) % hues.length] ?? 270;
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-9 shrink-0 select-none items-center justify-center rounded-full text-[13px] font-semibold text-white ring-2 ring-card",
        className,
      )}
      style={{ background: `linear-gradient(135deg, hsl(${hue} 70% 58%), hsl(${hue + 30} 75% 45%))` }}
    >
      {initials(name)}
    </span>
  );
}

export const TooltipProvider = TooltipPrimitive.Provider;

export function Tooltip({
  content,
  children,
  side = "right",
  disabled,
}: {
  content: React.ReactNode;
  children: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  disabled?: boolean;
}) {
  if (disabled) return <>{children}</>;
  return (
    <TooltipPrimitive.Root delayDuration={250}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={8}
          className="z-50 animate-fade-in rounded-lg border border-line bg-overlay px-2.5 py-1.5 text-xs font-medium text-fg shadow-pop"
        >
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-6 min-w-6 items-center justify-center rounded-md border border-line bg-raised px-1.5 font-sans text-[11px] font-medium text-muted",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

/** Thin progress bar; the unfilled track uses the reference design's hatching. */
export function Progress({ value, className }: { value: number; className?: string }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div
      className={cn("hatch h-1.5 w-full overflow-hidden rounded-full bg-raised", className)}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="h-full rounded-full bg-gradient-to-r from-accent to-magenta transition-[width] duration-500"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
