import { ChartColumn, ChartPie, TrendingUp, Wallet } from "lucide-react";
import * as React from "react";
import { Link } from "react-router";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { EmptyState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { useAuth } from "@/features/auth/auth-context";
import { changeRatio, formatMoney, formatNumber, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { DashboardSummary } from "@/types/api";

import { axisProps, bucketLabel, CHART, ChartDefs, ChartTooltip, LegendDot } from "./chart-kit";

type Props = { data: DashboardSummary };

function useChartId() {
  return React.useId().replace(/:/g, "");
}

// ---------------------------------------------------------------------------

export function LeadAcquisitionChart({ data }: Props) {
  const id = useChartId();
  const { can } = useAuth();
  const unit = data.range.bucket;
  const total = data.lead_trend.reduce((n, p) => n + p.local + p.international, 0);

  return (
    <Card className="min-h-[340px]">
      <CardHeader
        title="Lead acquisition"
        description={`${formatNumber(total)} new leads · by ${unit}`}
        action={
          total > 0 && (
            <div className="flex items-center gap-3">
              <LegendDot color={CHART.accent} label="Local" />
              <LegendDot hatch label="International" />
            </div>
          )
        }
      />
      <CardBody className="pt-2">
        {total === 0 ? (
          <EmptyState
            icon={ChartColumn}
            title="No new leads in this period"
            description="Leads you add or import will be charted here by market."
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
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={data.lead_trend} barCategoryGap="22%" margin={{ top: 8, right: 4, left: -18, bottom: 0 }}>
              <ChartDefs id={id} />
              <CartesianGrid vertical={false} stroke={CHART.grid} />
              <XAxis
                dataKey="bucket"
                {...axisProps}
                tickFormatter={(b: string) => bucketLabel(b, unit)}
                minTickGap={18}
              />
              <YAxis {...axisProps} allowDecimals={false} width={44} />
              <Tooltip
                cursor={{ fill: "rgba(255,255,255,0.03)" }}
                content={(p) => (
                  <ChartTooltip active={p.active} payload={p.payload} label={p.label} labelFormatter={(b) => bucketLabel(b, unit)} valueFormatter={formatNumber} />
                )}
              />
              <Bar dataKey="local" name="Local" stackId="m" fill={`url(#${id}-bar)`} radius={[0, 0, 6, 6]} maxBarSize={36} />
              <Bar
                dataKey="international"
                name="International"
                stackId="m"
                fill={`url(#${id}-hatch)`}
                stroke="rgba(217,70,239,0.55)"
                radius={[6, 6, 0, 0]}
                maxBarSize={36}
              />
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardBody>
    </Card>
  );
}

// ---------------------------------------------------------------------------

export function LeadSourcesChart({ data }: Props) {
  const id = useChartId();
  const total = data.lead_sources.reduce((n, s) => n + s.count, 0);

  // Top four sources, the rest folded into "Other" so the legend stays readable.
  const top = data.lead_sources.slice(0, 4);
  const rest = data.lead_sources.slice(4).reduce((n, s) => n + s.count, 0);
  const slices = rest > 0 ? [...top, { source: "Other", count: rest }] : top;
  const fills = [`url(#${id}-bar)`, CHART.magenta, `url(#${id}-hatch-muted)`, "#6366F1", "#52525B"];
  const legendColors = [CHART.accent, CHART.magenta, "hatch", "#6366F1", "#52525B"];

  return (
    <Card className="min-h-[340px]">
      <CardHeader title="Lead sources" description="Where this period's leads came from" />
      <CardBody className="flex items-center gap-4 pt-2">
        {total === 0 ? (
          <EmptyState
            icon={ChartPie}
            title="No sources to show"
            description="Each lead's source (Google Maps, Facebook, referrals…) is tracked when it's added."
            className="w-full"
            compact
          />
        ) : (
          <>
            <div className="relative size-[180px] shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <ChartDefs id={id} />
                  <Pie
                    data={slices}
                    dataKey="count"
                    nameKey="source"
                    innerRadius={58}
                    outerRadius={86}
                    paddingAngle={3}
                    cornerRadius={6}
                    stroke="none"
                    startAngle={90}
                    endAngle={-270}
                  >
                    {slices.map((s, i) => (
                      <Cell key={s.source} fill={fills[i]} />
                    ))}
                  </Pie>
                  <Tooltip content={(p) => <ChartTooltip active={p.active} payload={p.payload} label={p.label} valueFormatter={formatNumber} />} />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-2xl font-semibold tabular-nums">{formatNumber(total)}</span>
                <span className="text-xs text-subtle">leads</span>
              </div>
            </div>
            <ul className="flex min-w-0 flex-1 flex-col gap-3">
              {slices.map((s, i) => (
                <li key={s.source} className="border-l-2 pl-3" style={{ borderColor: legendColors[i] === "hatch" ? "#71717A" : legendColors[i] }}>
                  <p className="text-xl font-semibold leading-none tabular-nums">{formatPercent(s.count, total)}</p>
                  <p className="mt-1 truncate text-xs text-muted">
                    {s.source} · {formatNumber(s.count)}
                  </p>
                </li>
              ))}
            </ul>
          </>
        )}
      </CardBody>
    </Card>
  );
}

// ---------------------------------------------------------------------------

export function ConversionCard({ data }: Props) {
  const c = data.conversion;
  const pipelineTotal = data.pipeline.reduce((n, s) => n + s.count, 0);
  const closed = c.deals_won + c.deals_lost;

  const figures = [
    { label: "Contact rate", value: formatPercent(c.contacted, c.cohort), hint: `${c.contacted} of ${c.cohort} new leads` },
    { label: "Lead → client", value: formatPercent(c.converted, c.cohort), hint: `${c.converted} converted` },
    { label: "Deal win rate", value: formatPercent(c.deals_won, closed), hint: `${c.deals_won} won · ${c.deals_lost} lost` },
  ];

  return (
    <Card className="min-h-[340px]">
      <CardHeader title="Sales conversion" description="New leads in this period, and the pipeline today" />
      <CardBody className="flex flex-col gap-6 pt-3">
        <div className="grid grid-cols-3 gap-3">
          {figures.map((f) => (
            <div key={f.label} className="border-l border-accent/60 pl-3">
              <p className="text-[26px] font-semibold leading-none tracking-[-0.02em] tabular-nums">{f.value}</p>
              <p className="mt-1.5 text-xs font-medium text-muted">{f.label}</p>
              <p className="mt-0.5 truncate text-[11px] text-subtle">{f.hint}</p>
            </div>
          ))}
        </div>

        <div className="mt-auto">
          <div className="mb-2.5 flex items-center justify-between text-xs">
            <span className="font-medium text-muted">Pipeline by stage</span>
            <span className="text-subtle">{formatNumber(pipelineTotal)} leads</span>
          </div>
          {pipelineTotal === 0 ? (
            <div className="hatch flex h-3 rounded-full bg-raised" title="No leads in the pipeline yet" />
          ) : (
            <div className="flex h-3 gap-0.5 overflow-hidden rounded-full">
              {data.pipeline
                .filter((s) => s.count > 0)
                .map((s) => (
                  <div
                    key={s.id}
                    title={`${s.name}: ${s.count}`}
                    style={{ flexGrow: s.count, background: s.color }}
                    className="min-w-1.5"
                  />
                ))}
            </div>
          )}
          <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5">
            {data.pipeline.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2 text-xs">
                <span className="flex min-w-0 items-center gap-1.5 text-muted">
                  <span className="size-2 shrink-0 rounded-full" style={{ background: s.color }} />
                  <span className="truncate">{s.name}</span>
                </span>
                <span className="tabular-nums text-subtle">{s.count}</span>
              </li>
            ))}
          </ul>
        </div>
      </CardBody>
    </Card>
  );
}

// ---------------------------------------------------------------------------

/** One currency at a time: amounts in different currencies are never added together. */
export function RevenueChart({ data }: Props) {
  const id = useChartId();
  const trend = data.revenue_trend;
  const totals = data.revenue ?? [];
  const [currency, setCurrency] = React.useState<string | undefined>(undefined);
  const active = currency && totals.some((t) => t.currency === currency) ? currency : totals[0]?.currency;
  const unit = data.range.bucket;

  if (!trend) return null;
  const current = totals.find((t) => t.currency === active);
  const points = trend.points.map((p) => ({ bucket: p.bucket, amount: Number(p.amounts[active ?? ""] ?? 0) }));
  const ratio = current ? changeRatio(Number(current.amount), Number(current.previous_amount)) : null;

  return (
    <Card className="min-h-[340px]">
      <CardHeader
        title="Revenue"
        description="Value of deals won, per currency"
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
                    "rounded-[9px] px-2.5 py-1 text-xs font-medium transition-colors",
                    t.currency === active ? "bg-card text-fg shadow-sm" : "text-subtle hover:text-fg",
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
          <EmptyState
            icon={Wallet}
            title="No revenue in this period"
            description="Revenue appears when deals are marked won. Each currency is reported separately."
            compact
          />
        ) : (
          <>
            <div className="mb-3 flex items-baseline gap-3">
              <span className="text-[28px] font-semibold tracking-[-0.02em] tabular-nums">
                {formatMoney(current.amount, current.currency)}
              </span>
              <span className="text-xs text-subtle">
                {current.deals} deal{current.deals === 1 ? "" : "s"}
                {ratio !== null && ratio !== 0 && ` · ${ratio > 0 ? "+" : ""}${Math.round(ratio * 100)}% vs previous`}
              </span>
            </div>
            <ResponsiveContainer width="100%" height={210}>
              <AreaChart data={points} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
                <ChartDefs id={id} />
                <CartesianGrid vertical={false} stroke={CHART.grid} />
                <XAxis dataKey="bucket" {...axisProps} tickFormatter={(b: string) => bucketLabel(b, unit)} minTickGap={24} />
                <YAxis
                  {...axisProps}
                  width={64}
                  tickFormatter={(v: number) => formatMoney(v, current.currency, { compact: true })}
                />
                <Tooltip
                  cursor={{ stroke: CHART.accent, strokeOpacity: 0.4 }}
                  content={(p) => (
                    <ChartTooltip
                      {...p}
                      labelFormatter={(b) => bucketLabel(b, unit)}
                      valueFormatter={(v) => formatMoney(v, current.currency)}
                    />
                  )}
                />
                <Area
                  type="monotone"
                  dataKey="amount"
                  name={current.currency}
                  stroke={CHART.accent}
                  strokeWidth={2}
                  fill={`url(#${id}-area)`}
                />
              </AreaChart>
            </ResponsiveContainer>
          </>
        )}
      </CardBody>
    </Card>
  );
}

// ---------------------------------------------------------------------------

export function ClientGrowthChart({ data }: Props) {
  const id = useChartId();
  const growth = data.client_growth;
  if (!growth) return null;
  const unit = data.range.bucket;
  const added = growth.reduce((n, p) => n + p.new_clients, 0);
  const total = growth.at(-1)?.total_clients ?? 0;

  return (
    <Card className="min-h-[340px]">
      <CardHeader title="Client growth" description={`${formatNumber(added)} new · ${formatNumber(total)} total`} />
      <CardBody className="pt-2">
        {total === 0 ? (
          <EmptyState
            icon={TrendingUp}
            title="No clients yet"
            description="Won leads become clients without re-entering their details."
            compact
          />
        ) : (
          <ResponsiveContainer width="100%" height={250}>
            <ComposedChart data={growth} margin={{ top: 8, right: 4, left: -18, bottom: 0 }}>
              <ChartDefs id={id} />
              <CartesianGrid vertical={false} stroke={CHART.grid} />
              <XAxis dataKey="bucket" {...axisProps} tickFormatter={(b: string) => bucketLabel(b, unit)} minTickGap={18} />
              <YAxis {...axisProps} allowDecimals={false} width={44} />
              <Tooltip
                cursor={{ fill: "rgba(255,255,255,0.03)" }}
                content={(p) => <ChartTooltip active={p.active} payload={p.payload} label={p.label} labelFormatter={(b) => bucketLabel(b, unit)} valueFormatter={formatNumber} />}
              />
              <Bar dataKey="new_clients" name="New" fill={`url(#${id}-hatch)`} radius={[6, 6, 0, 0]} maxBarSize={28} />
              <Line type="monotone" dataKey="total_clients" name="Total" stroke={CHART.accent} strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </CardBody>
    </Card>
  );
}
