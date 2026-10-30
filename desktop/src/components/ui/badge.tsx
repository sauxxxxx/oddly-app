import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11.5px] font-medium leading-4",
  {
    variants: {
      tone: {
        neutral: "border-line bg-raised text-muted",
        accent: "border-accent/25 bg-accent-soft text-accent-fg",
        magenta: "border-magenta/25 bg-magenta-soft text-magenta-fg",
        success: "border-success/25 bg-success-soft text-success-fg",
        warning: "border-warning/25 bg-warning-soft text-warning-fg",
        danger: "border-danger/25 bg-danger-soft text-danger-fg",
        info: "border-info/25 bg-info-soft text-info-fg",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export type BadgeTone = NonNullable<VariantProps<typeof badgeVariants>["tone"]>;

export function Badge({
  className,
  tone,
  dot,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants> & { dot?: boolean }) {
  return (
    <span className={cn(badgeVariants({ tone }), className)} {...props}>
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {props.children}
    </span>
  );
}

const PRIORITY_TONE: Record<string, BadgeTone> = {
  low: "neutral",
  medium: "info",
  high: "warning",
  urgent: "danger",
};

export function PriorityBadge({ priority }: { priority: string }) {
  return (
    <Badge tone={PRIORITY_TONE[priority] ?? "neutral"} dot>
      {priority.charAt(0).toUpperCase() + priority.slice(1)}
    </Badge>
  );
}
