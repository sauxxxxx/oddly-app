import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Download, Info, Lock } from "lucide-react";
import * as React from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { PageHeader } from "@/components/layout/app-shell";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs } from "@/components/ui/form-controls";
import { Avatar } from "@/components/ui/misc";
import { useAuth, useMe } from "@/features/auth/auth-context";
import { axisProps, bucketLabel, CHART, ChartTooltip, LegendDot } from "@/features/dashboard/chart-kit";
import { DateRangePicker, rangeForPreset, type DateRange, type PresetKey } from "@/features/dashboard/date-range";
import { api, errorMessage } from "@/lib/api";
import { changeRatio, formatMoney, formatNumber, formatPercent, formatPlainDate } from "@/lib/format";
import { cn, safeStorage } from "@/lib/utils";
import type {
  ClientReport,
  CountRow,
  FinanceReport,
  LeadReport,
  MoneyRow,
  ReportRange,
  SalesReport,
  TeamReport,
  TrendPoint,
} from "@/types/analytics";

import { exportReportCsv, exportReportPdf, plainMoney, type ReportDoc, type ReportSection } from "./report-export";

// ---------------------------------------------------------------------------
// Shared shell
// ---------------------------------------------------------------------------

const RANGE_KEY = "oddly.analytics.range";

function initialRange(timeZone: string): DateRange {
  const saved = safeStorage.get(RANGE_KEY) as PresetKey | null;
  try {
    return rangeForPreset(saved && saved !== "custom" ? saved : "90d", timeZone);
  } catch {
    return rangeForPreset("90d", timeZone);
  }
}

function periodText(r: ReportRange) {
  return `${formatPlainDate(r.from, { month: "long", day: "numeric", year: "numeric" })} – ${formatPlainDate(r.to, { month: "long", day: "numeric", year: "numeric" })}`;
}

function ReportPage<T extends { range: ReportRange }>({
  kind,
  title,
  toDoc,
  children,
}: {
  kind: "leads" | "sales" | "clients" | "finance" | "team";
  title: string;
  toDoc: (data: T) => Omit<ReportDoc, "title" | "period">;
  children: (data: T) => React.ReactNode;
}) {
  const me = useMe();
  const [range, setRange] = React.useState<DateRange>(() => initialRange(me.timezone));
  const [exportError, setExportError] = React.useState<string | null>(null);
  const query = useQuery({
    queryKey: ["analytics", kind, range.from, range.to],
    queryFn: () => api<T>(`/analytics/${kind}?from=${range.from}&to=${range.to}`),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });

  async function runExport(format: "csv" | "pdf") {
    if (!query.data) return;
    setExportError(null);
    const doc: ReportDoc = { title, period: periodText(query.data.range), ...toDoc(query.data) };
    try {
      await (format === "csv" ? exportReportCsv(doc) : exportReportPdf(doc, me.full_name));
    } catch (err) {
      setExportError(errorMessage(err));
    }
  }

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        title={title}
        actions={
          <>
            <DateRangePicker
              value={range}
              timeZone={me.timezone}
              onChange={(r) => {
                setRange(r);
                safeStorage.set(RANGE_KEY, r.preset);
              }}
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" disabled={!query.data}>
                  <Download /> Export
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => void runExport("csv")}>CSV (Excel)
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void runExport("pdf")}>PDF report
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />
      {exportError && <p className="mb-4 rounded-md border border-danger/30 bg-danger/10 px-4 py-2.5 text-sm text-danger-fg">{exportError}</p>}
      {query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : !query.data ? (
        <ListSkeleton />
      ) : (
        <div className={cn("flex flex-col gap-4 transition-opacity", query.isFetching && "opacity-70")}>
          <p className="-mt-3 text-xs text-subtle">
            {periodText(query.data.range)}
          </p>
          {children(query.data)}
        </div>
      )}
    </div>
  );
}

function Tile({ label, value, hint, change }: { label: string; value: React.ReactNode; hint?: React.ReactNode; change?: number | null }) {
  return (
    <div className="min-w-[180px] flex-1 bg-card px-4 py-3">
      <p className="text-[13px] text-muted">{label}</p>
      <p className="mt-1 flex items-baseline gap-2">
        <span className="truncate text-xl font-semibold tabular-nums">{value}</span>
        {change !== undefined && change !== null && change !== 0 && (
          <span className={cn("text-xs tabular-nums", change > 0 ? "text-success-fg" : "text-danger-fg")}>
            {change > 0 ? "+" : ""}
            {Math.round(change * 100)}%
          </span>
        )}
      </p>
      {hint && <p className="mt-0.5 truncate text-xs text-subtle">{hint}</p>}
    </div>
  );
}

function Tiles({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap gap-px overflow-hidden rounded-card border border-line bg-line">{children}</div>;
}

/** Horizontal bars — readable for long category names. */
function BarList({ rows, empty = "No data for this period" }: { rows: { label: string; value: number; display?: string }[]; empty?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return <p className="py-6 text-center text-sm text-subtle">{empty}</p>;
  return (
    <ul className="flex flex-col gap-2.5">
      {rows.map((r) => (
        <li key={r.label} className="text-sm">
          <div className="mb-1 flex items-center justify-between gap-3">
            <span className="truncate text-muted">{r.label}</span>
            <span className="shrink-0 tabular-nums text-fg">{r.display ?? formatNumber(r.value)}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-raised">
            <div className="h-full rounded-full bg-accent" style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

const countRows = (rows: CountRow[]) => rows.map((r) => ({ label: r.label, value: r.count }));

function ListCard({ title, description, rows }: { title: string; description?: string; rows: CountRow[] }) {
  return (
    <Card>
      <CardHeader title={title} description={description} />
      <CardBody>
        <BarList rows={countRows(rows)} />
      </CardBody>
    </Card>
  );
}

/** Pivots [{bucket, series, value}] into chart rows keyed by series. */
function pivot(points: TrendPoint[]) {
  const series = [...new Set(points.map((p) => p.series))];
  const byBucket = new Map<string, Record<string, number | string>>();
  for (const p of points) {
    const row = byBucket.get(p.bucket) ?? { bucket: p.bucket };
    row[p.series] = Number(p.value);
    byBucket.set(p.bucket, row);
  }
  const rows = [...byBucket.values()].sort((a, b) => String(a.bucket).localeCompare(String(b.bucket)));
  for (const row of rows) for (const s of series) row[s] ??= 0;
  return { series, rows };
}

function TrendChart({
  points,
  unit,
  currency,
  height = 260,
}: {
  points: TrendPoint[];
  unit: ReportRange["bucket"];
  currency?: string;
  height?: number;
}) {
  const { series, rows } = pivot(points);
  if (!rows.length) return <EmptyState title="Nothing in this period" compact />;
  const fmt = (v: number) => (currency ? formatMoney(v, currency, { compact: true }) : formatNumber(v));
  return (
    <>
      {series.length > 1 && (
        <div className="mb-3 flex flex-wrap gap-4">
          {series.map((s, i) => <LegendDot key={s} label={s} color={CHART.categorical[i % CHART.categorical.length]} />)}
        </div>
      )}
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={rows} barCategoryGap="22%" margin={{ top: 8, right: 4, left: currency ? 8 : -18, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke={CHART.grid} />
          <XAxis dataKey="bucket" {...axisProps} tickFormatter={(b: string) => bucketLabel(b, unit)} minTickGap={16} />
          <YAxis {...axisProps} allowDecimals={!!currency} tickFormatter={(v: number) => (currency ? formatMoney(v, currency, { compact: true }) : formatNumber(v))} />
          <Tooltip
            cursor={{ fill: "rgba(127,127,127,0.08)" }}
            content={({ active, payload, label }) => (
              <ChartTooltip active={active} payload={payload} label={label} labelFormatter={(b) => bucketLabel(b, unit)} valueFormatter={fmt} />
            )}
          />
          {series.map((s, i) => (
            <Bar
              isAnimationActive={false}
              key={s}
              dataKey={s}
              name={s}
              stackId="s"
              fill={CHART.categorical[i % CHART.categorical.length]}
              radius={i === series.length - 1 ? [6, 6, 0, 0] : [0, 0, 0, 0]}
              maxBarSize={40}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </>
  );
}

/** Money trend: one currency at a time — currencies are never stacked or summed together. */
function CurrencyTrend({ points, unit }: { points: TrendPoint[]; unit: ReportRange["bucket"] }) {
  const currencies = [...new Set(points.map((p) => p.series))];
  const [picked, setPicked] = React.useState<string | null>(null);
  const currency = picked && currencies.includes(picked) ? picked : currencies[0];
  if (!currency) return <EmptyState title="No revenue recorded in this period" compact />;
  return (
    <>
      {currencies.length > 1 && (
        <Tabs className="mb-3" value={currency} onChange={setPicked} tabs={currencies.map((c) => ({ value: c, label: c }))} />
      )}
      <TrendChart points={points.filter((p) => p.series === currency).map((p) => ({ ...p, series: `Won (${currency})` }))} unit={unit} currency={currency} />
    </>
  );
}

function MoneyTable({ rows, labelHeader = "Item", empty = "Nothing recorded" }: { rows: MoneyRow[]; labelHeader?: string; empty?: string }) {
  if (!rows.length) return <p className="py-6 text-center text-sm text-subtle">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs text-subtle">
            <th className="py-2 pr-3 font-medium">{labelHeader}</th>
            <th className="px-3 py-2 font-medium">Currency</th>
            <th className="px-3 py-2 text-right font-medium">Count</th>
            <th className="py-2 pl-3 text-right font-medium">Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.label}-${r.currency}`} className="border-b border-line/60 last:border-0">
              <td className="py-2.5 pr-3 text-fg">{r.label}</td>
              <td className="px-3 py-2.5 text-muted">{r.currency}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-muted">{formatNumber(r.count)}</td>
              <td className="py-2.5 pl-3 text-right font-medium tabular-nums text-fg">{formatMoney(r.amount, r.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Per-currency amounts as one line ("PHP 120,000, USD 4,000"). */
function moneyLine(rows: { currency: string; amount: string }[]) {
  if (!rows.length) return "—";
  return rows.map((r) => formatMoney(r.amount, r.currency, { compact: true })).join(", ");
}

function FinanceLocked() {
  return (
    <Card className="flex items-center gap-3 p-4 text-sm text-muted">
      <Lock className="size-4 shrink-0 text-subtle" />
      Revenue and deal values need the "View finances" permission.
    </Card>
  );
}

const countSection = (title: string, rows: CountRow[], header = "Name"): ReportSection => ({
  title,
  columns: [header, "Count"],
  rows: rows.map((r) => [r.label, r.count]),
});

const moneySection = (title: string, rows: MoneyRow[], header = "Item"): ReportSection => ({
  title,
  columns: [header, "Currency", "Count", "Amount"],
  rows: rows.map((r) => [r.label, r.currency, r.count, plainMoney(r.amount, r.currency)]),
});

const trendSection = (title: string, points: TrendPoint[], money = false): ReportSection => ({
  title,
  columns: ["Period starting", "Series", "Value"],
  rows: points.map((p) => [p.bucket, p.series, money ? plainMoney(p.value, p.series) : Number(p.value)]),
});

// ---------------------------------------------------------------------------
// Lead analytics
// ---------------------------------------------------------------------------

export function LeadAnalyticsPage() {
  return (
    <ReportPage<LeadReport>
      kind="leads"
      title="Lead Analytics"
      toDoc={(d) => ({
        sections: [
          {
            title: "Summary",
            columns: ["Metric", "Value"],
            rows: [
              ["Leads (all time)", d.totals.total],
              ["Active leads", d.totals.active],
              ["New leads in period", d.totals.new_in_range],
              ["New leads, previous period", d.totals.new_previous],
              ["New leads contacted", d.totals.contacted],
              ["New leads converted", d.totals.converted],
              ["Active leads never contacted", d.totals.never_contacted],
            ],
          },
          countSection("New leads by market", d.by_market, "Market"),
          countSection("New leads by country", d.by_country, "Country"),
          countSection("New leads by industry", d.by_industry, "Industry"),
          countSection("New leads by source", d.by_source, "Source"),
          countSection("All leads by pipeline stage", d.by_stage, "Stage"),
          countSection("All leads by status", d.by_status, "Status"),
          {
            title: "By assigned team member",
            columns: ["Member", "New leads", "Contacted", "Converted", "Interactions"],
            rows: d.by_owner.map((o) => [o.label, o.assigned, o.contacted, o.converted, o.interactions]),
          },
          trendSection("New leads over time", d.trend),
        ],
      })}
    >
      {(d) => (
        <>
          <Tiles>
            <Tile label="New leads" value={formatNumber(d.totals.new_in_range)} change={changeRatio(d.totals.new_in_range, d.totals.new_previous)} hint="vs previous period" />
            <Tile label="Contact rate" value={formatPercent(d.totals.contacted, d.totals.new_in_range)} hint={`${formatNumber(d.totals.contacted)} of new leads contacted`} />
            <Tile label="Conversion rate" value={formatPercent(d.totals.converted, d.totals.new_in_range)} hint={`${formatNumber(d.totals.converted)} became clients`} />
            <Tile label="Never contacted" value={formatNumber(d.totals.never_contacted)} hint={`of ${formatNumber(d.totals.active)} active leads`} />
          </Tiles>
          <Card>
            <CardHeader title="New leads over time" />
            <CardBody>
              <TrendChart points={d.trend} unit={d.range.bucket} />
            </CardBody>
          </Card>
          <div className="grid gap-4 lg:grid-cols-3">
            <ListCard title="By source" rows={d.by_source} />
            <ListCard title="By country" rows={d.by_country} />
            <ListCard title="By industry" rows={d.by_industry} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <ListCard title="Pipeline stages" rows={d.by_stage} />
            <ListCard title="Status" rows={d.by_status} />
          </div>
          <Card className="overflow-hidden">
            <CardHeader title="By team member" className="pb-4" />
            <SimpleTable
              headers={["Member", "New leads", "Contacted", "Converted", "Interactions"]}
              rows={d.by_owner.map((o) => [o.label, o.assigned, o.contacted, o.converted, o.interactions])}
              avatar
            />
          </Card>
        </>
      )}
    </ReportPage>
  );
}

function SimpleTable({ headers, rows, avatar }: { headers: string[]; rows: (string | number)[][]; avatar?: boolean }) {
  if (!rows.length) return <p className="px-5 pb-6 text-center text-sm text-subtle">No data for this period</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-y border-line text-left text-xs text-subtle">
            {headers.map((h, i) => <th key={h} className={cn("py-3 font-medium", i === 0 ? "px-5" : "px-3 text-right")}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={String(r[0])} className="border-b border-line/60 last:border-0">
              {r.map((cell, i) =>
                i === 0 ? (
                  <td key={i} className="px-5 py-3">
                    <span className="flex items-center gap-3 font-medium">
                      {avatar && <Avatar name={String(cell)} className="size-7 text-[10px]" />}
                      {cell}
                    </span>
                  </td>
                ) : (
                  <td key={i} className="px-3 py-3 text-right tabular-nums text-muted">{typeof cell === "number" ? formatNumber(cell) : cell}</td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sales analytics
// ---------------------------------------------------------------------------

export function SalesAnalyticsPage() {
  return (
    <ReportPage<SalesReport>
      kind="sales"
      title="Sales Analytics"
      toDoc={(d) => ({
        note: "Amounts are listed per currency and never added across currencies.",
        sections: [
          {
            title: "Summary",
            columns: ["Metric", "Value"],
            rows: [
              ["Open deals (now)", d.totals.deals_open],
              ["Deals won", d.totals.deals_won],
              ["Deals lost", d.totals.deals_lost],
              ["Proposals sent", d.totals.proposals_sent],
              ["Proposals accepted", d.totals.proposals_accepted],
              ["Proposals rejected", d.totals.proposals_rejected],
              ["Average days to a proposal decision", d.totals.avg_days_to_decision?.toFixed(1) ?? "—"],
              ["Outreach interactions", d.totals.interactions],
              ["Meetings", d.totals.meetings],
            ],
          },
          ...(d.won_by_currency ? [moneySection("Won deals by currency", d.won_by_currency)] : []),
          ...(d.pipeline_by_currency ? [moneySection("Pipeline value (now)", d.pipeline_by_currency)] : []),
          ...(d.won_by_owner ? [moneySection("Won deals by owner", d.won_by_owner, "Owner")] : []),
          ...(d.revenue_trend ? [trendSection("Won deal value over time", d.revenue_trend, true)] : []),
          countSection("Lost reasons", d.lost_reasons, "Reason"),
          countSection("Outreach by channel", d.outreach_by_channel, "Channel"),
        ],
      })}
    >
      {(d) => {
        const decided = d.totals.deals_won + d.totals.deals_lost;
        const responded = d.totals.proposals_accepted + d.totals.proposals_rejected;
        return (
          <>
            <Tiles>
              <Tile label="Deals won" value={formatNumber(d.totals.deals_won)} hint={`Win rate ${formatPercent(d.totals.deals_won, decided)} of ${formatNumber(decided)} closed`} />
              <Tile label="Open deals" value={formatNumber(d.totals.deals_open)} hint="right now" />
              <Tile
                label="Proposal acceptance"
                value={formatPercent(d.totals.proposals_accepted, responded)}
                hint={`${formatNumber(d.totals.proposals_sent)} sent, ${d.totals.avg_days_to_decision !== null ? `${d.totals.avg_days_to_decision.toFixed(1)} days to decide` : "no decisions yet"}`}
              />
              <Tile label="Outreach" value={formatNumber(d.totals.interactions)} hint={`${formatNumber(d.totals.meetings)} meetings`} />
            </Tiles>
            {d.won_by_currency && d.pipeline_by_currency && d.revenue_trend && d.won_by_owner ? (
              <>
                <div className="grid gap-4 lg:grid-cols-3">
                  <Card className="lg:col-span-2">
                    <CardHeader title="Won deal value" />
                    <CardBody>
                      <CurrencyTrend points={d.revenue_trend} unit={d.range.bucket} />
                    </CardBody>
                  </Card>
                  <Card>
                    <CardHeader title="Won in period" description={moneyLine(d.won_by_currency)} />
                    <CardBody>
                      <MoneyTable rows={d.won_by_owner} labelHeader="Owner" empty="No deals won in this period" />
                    </CardBody>
                  </Card>
                </div>
                <Card>
                  <CardHeader title="Pipeline value" description="Open deals plus estimated value of active leads" />
                  <CardBody>
                    <MoneyTable rows={d.pipeline_by_currency} empty="No open pipeline value" />
                  </CardBody>
                </Card>
              </>
            ) : (
              <FinanceLocked />
            )}
            <div className="grid gap-4 lg:grid-cols-2">
              <ListCard title="Outreach by channel" rows={d.outreach_by_channel} />
              <ListCard title="Why deals were lost" rows={d.lost_reasons} />
            </div>
          </>
        );
      }}
    </ReportPage>
  );
}

// ---------------------------------------------------------------------------
// Client analytics
// ---------------------------------------------------------------------------

export function ClientAnalyticsPage() {
  return (
    <ReportPage<ClientReport>
      kind="clients"
      title="Client Analytics"
      toDoc={(d) => ({
        sections: [
          {
            title: "Summary",
            columns: ["Metric", "Value"],
            rows: [
              ["Current clients", d.totals.current],
              ["New clients in period", d.totals.new_in_range],
              ["New clients, previous period", d.totals.new_previous],
              ["Current clients for 90+ days", d.totals.retained_90d],
              ["Needing attention / at risk", d.totals.at_risk],
              ["Completed", d.totals.completed],
              ["Inactive", d.totals.inactive],
            ],
          },
          countSection("Clients by status", d.by_status, "Status"),
          countSection("Clients by market", d.by_market, "Market"),
          countSection("Clients by industry", d.by_industry, "Industry"),
          { title: "Services used", columns: ["Service", "Clients", "Active"], rows: d.services.map((s) => [s.label, s.clients, s.active]) },
          countSection("Current clients per account manager", d.by_manager, "Account manager"),
          trendSection("New clients over time", d.growth),
        ],
      })}
    >
      {(d) => (
        <>
          <Tiles>
            <Tile label="Current clients" value={formatNumber(d.totals.current)} />
            <Tile label="New clients" value={formatNumber(d.totals.new_in_range)} change={changeRatio(d.totals.new_in_range, d.totals.new_previous)} hint="vs previous period" />
            <Tile label="Retained 90+ days" value={formatPercent(d.totals.retained_90d, d.totals.current)} hint={`${formatNumber(d.totals.retained_90d)} of current clients`} />
            <Tile label="Need attention" value={formatNumber(d.totals.at_risk)} hint="at risk or needing attention" />
          </Tiles>
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader title="New clients" />
              <CardBody>
                <TrendChart points={d.growth} unit={d.range.bucket} />
              </CardBody>
            </Card>
            <ListCard title="Status" rows={d.by_status} />
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <Card>
              <CardHeader title="Services used" />
              <CardBody>
                <BarList rows={d.services.map((s) => ({ label: s.label, value: s.clients, display: `${formatNumber(s.clients)} (${formatNumber(s.active)} active)` }))} />
              </CardBody>
            </Card>
            <ListCard title="By industry" rows={d.by_industry} />
            <ListCard title="Per account manager" rows={d.by_manager} />
          </div>
        </>
      )}
    </ReportPage>
  );
}

// ---------------------------------------------------------------------------
// Financial reports
// ---------------------------------------------------------------------------

export function FinanceReportsPage() {
  const { can } = useAuth();
  if (!can("finance.view")) {
    return (
      <div className="mx-auto max-w-[1400px]">
        <PageHeader title="Financial Reports" />
        <EmptyState title="You don't have access to financial reports" description='Ask an administrator for the "View finances" permission.' />
      </div>
    );
  }
  return (
    <ReportPage<FinanceReport>
      kind="finance"
      title="Financial Reports"
      toDoc={(d) => ({
        note: d.note,
        sections: [
          {
            title: "Won deal revenue",
            columns: ["Currency", "Deals", "This period", "Previous period"],
            rows: d.won.map((w) => [w.currency, w.deals, plainMoney(w.amount, w.currency), plainMoney(w.previous_amount, w.currency)]),
          },
          moneySection("Recurring revenue per month (active services)", d.recurring_monthly),
          moneySection("Active contracts", d.active_contracts),
          moneySection("Proposals awaiting a decision", d.proposals_pending),
          moneySection("Top clients by won deals", d.top_clients, "Company"),
          moneySection("Recurring per month by service category", d.by_service_category, "Category"),
          trendSection("Won deal value by month", d.revenue_trend, true),
        ],
      })}
    >
      {(d) => (
        <>
          <Card className="flex items-start gap-3 p-4 text-sm text-muted">
            <Info className="mt-0.5 size-4 shrink-0 text-accent" />
            {d.note}
          </Card>
          {d.won.length === 0 ? (
            <Tiles>
              <Tile label="Won in period" value="—" hint="No deals won in this period" />
              <Tile label="Recurring / month" value={moneyLine(d.recurring_monthly)} />
              <Tile label="Active contracts" value={moneyLine(d.active_contracts)} />
              <Tile label="Awaiting decision" value={moneyLine(d.proposals_pending)} />
            </Tiles>
          ) : (
            <Tiles>
              {d.won.map((w) => (
                <Tile
                  key={w.currency}
                  label={`Won in period (${w.currency})`}
                  value={formatMoney(w.amount, w.currency, { compact: true })}
                  change={changeRatio(Number(w.amount), Number(w.previous_amount))}
                  hint={`${formatNumber(w.deals)} deals`}
                />
              ))}
            </Tiles>
          )}
          <Card>
            <CardHeader title="Won deal value by month" />
            <CardBody>
              <CurrencyTrend points={d.revenue_trend} unit="month" />
            </CardBody>
          </Card>
          <div className="grid gap-4 lg:grid-cols-3">
            <Card>
              <CardHeader title="Recurring per month" description="Monthly equivalent of active services" />
              <CardBody>
                <MoneyTable rows={d.recurring_monthly} empty="No recurring services" />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Active contracts" />
              <CardBody>
                <MoneyTable rows={d.active_contracts} empty="No active contracts" />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Awaiting decision" />
              <CardBody>
                <MoneyTable rows={d.proposals_pending} empty="No proposals waiting" />
              </CardBody>
            </Card>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title="Top clients" />
              <CardBody>
                <MoneyTable rows={d.top_clients} labelHeader="Company" empty="No deals won in this period" />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Recurring by service category" />
              <CardBody>
                <MoneyTable rows={d.by_service_category} labelHeader="Category" empty="No active services" />
              </CardBody>
            </Card>
          </div>
        </>
      )}
    </ReportPage>
  );
}

// ---------------------------------------------------------------------------
// Team performance
// ---------------------------------------------------------------------------

const TEAM_COLS: [keyof TeamReport["members"][number], string][] = [
  ["tasks_completed", "Tasks done"],
  ["tasks_on_time", "On time"],
  ["tasks_overdue", "Overdue now"],
  ["leads_handled", "Leads handled"],
  ["interactions", "Interactions"],
  ["follow_ups_done", "Follow-ups"],
  ["deals_won", "Deals won"],
  ["projects_completed", "Projects done"],
  ["content_published", "Published"],
  ["maintenance_done", "Maintenance"],
];

export function TeamPerformancePage() {
  const { can } = useAuth();
  if (!can("team.view")) {
    return (
      <div className="mx-auto max-w-[1400px]">
        <PageHeader title="Team Performance" />
        <EmptyState title="You don't have access to team reports" description='Ask an administrator for the "View team" permission.' />
      </div>
    );
  }
  return (
    <ReportPage<TeamReport>
      kind="team"
      title="Team Performance"
      toDoc={(d) => ({
        sections: [
          {
            title: "Per team member",
            columns: ["Member", ...TEAM_COLS.map(([, l]) => l)],
            rows: d.members.map((m) => [m.full_name, ...TEAM_COLS.map(([k]) => m[k] as number)]),
          },
        ],
      })}
    >
      {(d) => {
        const sum = (k: keyof TeamReport["members"][number]) => d.members.reduce((a, m) => a + (m[k] as number), 0);
        const done = sum("tasks_completed");
        return (
          <>
            <Tiles>
              <Tile label="Tasks completed" value={formatNumber(done)} hint={`${formatPercent(sum("tasks_on_time"), done)} on time`} />
              <Tile label="Overdue now" value={formatNumber(sum("tasks_overdue"))} hint="open tasks past due" />
              <Tile label="Sales interactions" value={formatNumber(sum("interactions"))} hint={`${formatNumber(sum("follow_ups_done"))} follow-ups done`} />
              <Tile label="Delivered" value={formatNumber(sum("projects_completed") + sum("content_published"))} hint="projects completed + posts published" />
            </Tiles>
            <Card>
              <CardHeader title="Tasks completed per person" />
              <CardBody>
                <BarList
                  rows={d.members.map((m) => ({ label: m.full_name, value: m.tasks_completed, display: `${formatNumber(m.tasks_completed)} (${formatNumber(m.tasks_on_time)} on time)` }))}
                  empty="No team members"
                />
              </CardBody>
            </Card>
            <Card className="overflow-hidden">
              <CardHeader title="Per team member" className="pb-4" />
              <SimpleTable headers={["Member", ...TEAM_COLS.map(([, l]) => l)]} rows={d.members.map((m) => [m.full_name, ...TEAM_COLS.map(([k]) => m[k] as number)])} avatar />
            </Card>
          </>
        );
      }}
    </ReportPage>
  );
}
