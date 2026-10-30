import { ArrowDownRight, ArrowUpRight, Briefcase, Building2, FileText, Trophy, UserPlus, Users, Wallet } from "lucide-react";
import type * as React from "react";

import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/misc";
import { changeRatio, formatMoney, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { DashboardSummary } from "@/types/api";

function Delta({ current, previous }: { current: number; previous: number }) {
  const ratio = changeRatio(current, previous);
  if (ratio === null) return <span className="text-xs text-subtle">New this period</span>;
  if (ratio === 0) return <span className="text-xs text-subtle">No change vs previous period</span>;
  const up = ratio > 0;
  return (
    <span className="flex items-center gap-1 text-xs">
      <span
        className={cn(
          "inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 font-medium",
          up ? "bg-success-soft text-[#86efac]" : "bg-danger-soft text-[#fca5a5]",
        )}
      >
        {up ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
        {Math.abs(Math.round(ratio * 100))}%
      </span>
      <span className="text-subtle">vs previous period</span>
    </span>
  );
}

function StatCard({
  label,
  icon: Icon,
  value,
  footer,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  value: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <Card className="min-w-0 gap-3 p-5">
      <div className="flex items-center justify-between">
        <p className="text-[13px] font-medium text-muted">{label}</p>
        <span className="flex size-8 items-center justify-center rounded-[10px] border border-line bg-raised text-subtle">
          <Icon className="size-4" />
        </span>
      </div>
      <div className="truncate text-[30px] font-semibold leading-none tracking-[-0.03em] tabular-nums">{value}</div>
      <div className="min-h-5">{footer}</div>
    </Card>
  );
}

export function StatCards({ data }: { data: DashboardSummary }) {
  const s = data.stats;
  const revenue = data.revenue;
  const [primary, ...others] = revenue ?? [];

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 2xl:grid-cols-6">
      <StatCard
        label="Total leads"
        icon={Users}
        value={formatNumber(s.total_leads)}
        footer={<span className="text-xs text-subtle">All leads you can see</span>}
      />
      <StatCard
        label="New leads"
        icon={UserPlus}
        value={formatNumber(s.new_leads)}
        footer={<Delta current={s.new_leads} previous={s.new_leads_previous} />}
      />
      {s.active_clients !== null && (
        <StatCard
          label="Active clients"
          icon={Building2}
          value={formatNumber(s.active_clients)}
          footer={<span className="text-xs text-subtle">Onboarding through at-risk</span>}
        />
      )}
      {s.pending_proposals !== null && (
        <StatCard
          label="Pending proposals"
          icon={FileText}
          value={formatNumber(s.pending_proposals)}
          footer={<span className="text-xs text-subtle">Ready or sent, awaiting reply</span>}
        />
      )}
      {s.won_deals !== null && (
        <StatCard
          label="Won deals"
          icon={Trophy}
          value={formatNumber(s.won_deals)}
          footer={<Delta current={s.won_deals} previous={s.won_deals_previous ?? 0} />}
        />
      )}
      {revenue && (
        <StatCard
          label="Won revenue"
          icon={revenue.length ? Wallet : Briefcase}
          value={primary ? formatMoney(primary.amount, primary.currency, { compact: Number(primary.amount) >= 100_000 }) : "—"}
          footer={
            !primary ? (
              <span className="text-xs text-subtle">No deals won in this period</span>
            ) : others.length > 0 ? (
              <span className="truncate text-xs text-subtle" title={others.map((o) => formatMoney(o.amount, o.currency)).join(" · ")}>
                + {others.map((o) => formatMoney(o.amount, o.currency, { compact: true })).join(" · ")}
              </span>
            ) : (
              <Delta current={Number(primary.amount)} previous={Number(primary.previous_amount)} />
            )
          }
        />
      )}
    </div>
  );
}

export function StatCardsSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 2xl:grid-cols-6">
      {Array.from({ length: 6 }, (_, i) => (
        <Card key={i} className="gap-4 p-5">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-3 w-32" />
        </Card>
      ))}
    </div>
  );
}
