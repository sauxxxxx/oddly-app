import type * as React from "react";

import { formatPlainDate } from "@/lib/format";

/** Chart colors, aligned with the design tokens. Recharts needs literal values. */
export const CHART = {
  accent: "#A855F7",
  neutral: "#85858f",
  // Neutral greys that read on both dark and light cards.
  grid: "rgba(127,127,127,0.18)",
  axis: "#85858f",
  categorical: ["#A855F7", "#85858f", "#C084FC", "#5f5f69", "#7C3AED", "#b4b4bc", "#E9D5FF", "#3f3f46"],
};

export const axisProps = {
  stroke: CHART.axis,
  tick: { fill: CHART.axis, fontSize: 12 },
  tickLine: false,
  axisLine: false,
} as const;

export function bucketLabel(bucket: string, unit: "day" | "week" | "month") {
  return unit === "month"
    ? formatPlainDate(bucket, { month: "short", year: "2-digit" })
    : formatPlainDate(bucket, { month: "short", day: "numeric" });
}

interface TooltipEntry {
  name?: unknown;
  value?: unknown;
  color?: string;
  dataKey?: unknown;
}

/** Tooltip shared by every chart. */
export function ChartTooltip({
  active,
  payload,
  label,
  labelFormatter,
  valueFormatter = (v) => String(v),
}: {
  active?: boolean;
  payload?: ReadonlyArray<TooltipEntry>;
  label?: unknown;
  labelFormatter?: (label: string) => string;
  valueFormatter?: (value: number, entry: TooltipEntry) => React.ReactNode;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="min-w-36 rounded-md border border-line bg-overlay px-3 py-2.5 text-xs shadow-pop">
      {label !== undefined && (
        <p className="mb-1.5 font-medium text-fg">{labelFormatter ? labelFormatter(String(label)) : String(label)}</p>
      )}
      <ul className="flex flex-col gap-1">
        {payload.map((entry) => (
          <li key={String(entry.dataKey ?? entry.name)} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-muted">
              <span className="size-2 rounded-full" style={{ background: entry.color }} />
              {String(entry.name)}
            </span>
            <span className="font-medium tabular-nums text-fg">{valueFormatter(Number(entry.value), entry)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function LegendDot({ color, label }: { color?: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted">
      <span className="size-2.5 rounded-sm" style={{ background: color }} />
      {label}
    </span>
  );
}
