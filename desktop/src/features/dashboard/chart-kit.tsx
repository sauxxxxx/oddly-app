import type * as React from "react";

import { formatPlainDate } from "@/lib/format";

/** Chart colors, aligned with the design tokens. Recharts needs literal values. */
export const CHART = {
  accent: "#A855F7",
  accentLight: "#C084FC",
  magenta: "#D946EF",
  // Neutral greys that read on both dark and light cards.
  grid: "rgba(127,127,127,0.18)",
  axis: "#85858f",
  categorical: ["#A855F7", "#D946EF", "#6366F1", "#F472B6", "#C084FC", "#818CF8", "#E879F9", "#71717A"],
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

/** SVG <defs> for the reference design's diagonal hatching and soft gradients. */
export function ChartDefs({ id }: { id: string }) {
  return (
    <defs>
      <pattern id={`${id}-hatch`} width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="7" height="7" fill="rgba(217,70,239,0.10)" />
        <line x1="0" y1="0" x2="0" y2="7" stroke="rgba(240,171,252,0.75)" strokeWidth="1.6" />
      </pattern>
      <pattern id={`${id}-hatch-muted`} width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="7" height="7" fill="rgba(127,127,127,0.06)" />
        <line x1="0" y1="0" x2="0" y2="7" stroke="rgba(127,127,127,0.55)" strokeWidth="1.4" />
      </pattern>
      <linearGradient id={`${id}-bar`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={CHART.accentLight} />
        <stop offset="100%" stopColor={CHART.accent} />
      </linearGradient>
      <linearGradient id={`${id}-area`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={CHART.accent} stopOpacity={0.35} />
        <stop offset="100%" stopColor={CHART.accent} stopOpacity={0} />
      </linearGradient>
    </defs>
  );
}

interface TooltipEntry {
  name?: unknown;
  value?: unknown;
  color?: string;
  dataKey?: unknown;
}

/** Dark tooltip shared by every chart. */
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
    <div className="min-w-36 rounded-xl border border-line bg-overlay px-3 py-2.5 text-xs shadow-pop">
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

export function LegendDot({ color, hatch, label }: { color?: string; hatch?: boolean; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted">
      <span
        className={hatch ? "hatch size-2.5 rounded-[3px] bg-magenta/30" : "size-2.5 rounded-[3px]"}
        style={hatch ? undefined : { background: color }}
      />
      {label}
    </span>
  );
}
