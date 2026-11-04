import type * as React from "react";

import { changeRatio, formatMoney, formatNumber } from "@/lib/format";
import type { DashboardSummary } from "@/types/api";

function Delta({ current, previous }: { current: number; previous: number }) {
  const ratio = changeRatio(current, previous);
  if (ratio === null || ratio === 0) return null;
  return (
    <span className={ratio > 0 ? "text-success-fg" : "text-danger-fg"}>
      {ratio > 0 ? "+" : ""}
      {Math.round(ratio * 100)}%
    </span>
  );
}

function Stat({ label, value, note }: { label: string; value: React.ReactNode; note?: React.ReactNode }) {
  return (
    <div className="min-w-[150px] flex-1 bg-card px-4 py-3">
      <p className="text-[13px] text-muted">{label}</p>
      <p className="mt-1 flex items-baseline gap-2">
        <span className="text-xl font-semibold tabular-nums">{value}</span>
        {note && <span className="whitespace-nowrap text-xs tabular-nums">{note}</span>}
      </p>
    </div>
  );
}

export function StatCards({ data }: { data: DashboardSummary }) {
  const s = data.stats;
  const revenue = data.revenue;
  const [primary, ...others] = revenue ?? [];

  return (
    <div className="flex flex-wrap gap-px overflow-hidden rounded-card border border-line bg-line">
      <Stat label="Total leads" value={formatNumber(s.total_leads)} />
      <Stat
        label="New leads"
        value={formatNumber(s.new_leads)}
        note={<Delta current={s.new_leads} previous={s.new_leads_previous} />}
      />
      {s.active_clients !== null && <Stat label="Active clients" value={formatNumber(s.active_clients)} />}
      {s.pending_proposals !== null && <Stat label="Pending proposals" value={formatNumber(s.pending_proposals)} />}
      {s.won_deals !== null && (
        <Stat
          label="Won deals"
          value={formatNumber(s.won_deals)}
          note={<Delta current={s.won_deals} previous={s.won_deals_previous ?? 0} />}
        />
      )}
      {revenue && (
        <Stat
          label="Won revenue"
          value={primary ? formatMoney(primary.amount, primary.currency, { compact: Number(primary.amount) >= 100_000 }) : "None"}
          note={
            primary &&
            (others.length > 0 ? (
              <span className="text-subtle" title={others.map((o) => formatMoney(o.amount, o.currency)).join(", ")}>
                +{others.length} more
              </span>
            ) : (
              <Delta current={Number(primary.amount)} previous={Number(primary.previous_amount)} />
            ))
          }
        />
      )}
    </div>
  );
}
