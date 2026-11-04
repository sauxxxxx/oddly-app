import * as React from "react";
import { Link } from "react-router";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { EmptyState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { useAuth } from "@/features/auth/auth-context";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { DashboardSummary } from "@/types/api";

import { axisProps, bucketLabel, CHART, ChartTooltip, LegendDot } from "./chart-kit";

type Props = { data: DashboardSummary };

export function LeadAcquisitionChart({ data }: Props) {
  const { can } = useAuth();
  const unit = data.range.bucket;
  const total = data.lead_trend.reduce((n, p) => n + p.local + p.international, 0);

  return (
    <Card>
      <CardHeader
        title="New leads"
        action={
          total > 0 && (
            <div className="flex items-center gap-3">
              <LegendDot color={CHART.accent} label="Local" />
              <LegendDot color={CHART.neutral} label="International" />
            </div>
          )
        }
      />
      <CardBody className="pt-2">
        {total === 0 ? (
          <EmptyState
            title="No new leads in this period."
            action={
              can("leads.import") && (
                <Button asChild variant="secondary" size="sm">
                  <Link to="/leads/import">Import leads</Link>
                </Button>
              )
            }
            compact
          />
        ) : (
          <ResponsiveContainer width="100%" height={230}>
            <BarChart data={data.lead_trend} barCategoryGap="24%" margin={{ top: 8, right: 4, left: -18, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={CHART.grid} />
              <XAxis dataKey="bucket" {...axisProps} tickFormatter={(b: string) => bucketLabel(b, unit)} minTickGap={18} />
              <YAxis {...axisProps} allowDecimals={false} width={44} />
              <Tooltip
                cursor={{ fill: "rgba(127,127,127,0.08)" }}
                content={(p) => (
                  <ChartTooltip active={p.active} payload={p.payload} label={p.label} labelFormatter={(b) => bucketLabel(b, unit)} />
                )}
              />
              <Bar isAnimationActive={false} dataKey="local" name="Local" stackId="m" fill={CHART.accent} maxBarSize={32} />
              <Bar isAnimationActive={false} dataKey="international" name="International" stackId="m" fill={CHART.neutral} maxBarSize={32} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardBody>
    </Card>
  );
}

export function RevenueChart({ data }: Props) {
  const trend = data.revenue_trend;
  const totals = data.revenue ?? [];
  const unit = data.range.bucket;
  const [currency, setCurrency] = React.useState<string | null>(null);
  const active = currency && totals.some((t) => t.currency === currency) ? currency : (totals[0]?.currency ?? null);

  if (!trend) return null;
  const current = totals.find((t) => t.currency === active);
  const points = trend.points.map((p) => ({ bucket: p.bucket, amount: Number(p.amounts[active ?? ""] ?? 0) }));

  return (
    <Card>
      <CardHeader
        title="Won revenue"
        action={
          totals.length > 1 && (
            <div className="flex rounded-control border border-line bg-raised p-0.5" role="tablist" aria-label="Currency">
              {totals.map((t) => (
                <button
                  key={t.currency}
                  role="tab"
                  aria-selected={t.currency === active}
                  onClick={() => setCurrency(t.currency)}
                  className={cn(
                    "rounded-sm px-2.5 py-1 text-xs font-medium transition-colors",
                    t.currency === active ? "bg-card text-fg" : "text-subtle hover:text-fg",
                  )}
                >
                  {t.currency}
                </button>
              ))}
            </div>
          )
        }
      />
      <CardBody className="pt-2">
        {!current ? (
          <EmptyState title="No deals won in this period." compact />
        ) : (
          <ResponsiveContainer width="100%" height={230}>
            <BarChart data={points} barCategoryGap="24%" margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={CHART.grid} />
              <XAxis dataKey="bucket" {...axisProps} tickFormatter={(b: string) => bucketLabel(b, unit)} minTickGap={18} />
              <YAxis {...axisProps} width={64} tickFormatter={(v: number) => formatMoney(v, current.currency, { compact: true })} />
              <Tooltip
                cursor={{ fill: "rgba(127,127,127,0.08)" }}
                content={(p) => (
                  <ChartTooltip
                    active={p.active}
                    payload={p.payload}
                    label={p.label}
                    labelFormatter={(b) => bucketLabel(b, unit)}
                    valueFormatter={(v) => formatMoney(v, current.currency)}
                  />
                )}
              />
              <Bar isAnimationActive={false} dataKey="amount" name={current.currency} fill={CHART.accent} maxBarSize={32} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardBody>
    </Card>
  );
}
