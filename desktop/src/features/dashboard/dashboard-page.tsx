import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import * as React from "react";

import { PageHeader } from "@/components/layout/app-shell";
import { ErrorState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/misc";
import { useMe } from "@/features/auth/auth-context";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { firstName, safeStorage } from "@/lib/utils";
import type { DashboardSummary } from "@/types/api";

import {
  ClientGrowthChart,
  ConversionCard,
  LeadAcquisitionChart,
  LeadSourcesChart,
  RevenueChart,
} from "./charts";
import { DateRangePicker, rangeForPreset, type DateRange, type PresetKey } from "./date-range";
import {
  AiInsights,
  MyTasks,
  PendingApprovals,
  ProjectProgress,
  RecentActivity,
  RecentProposals,
  TodaysMeetings,
  UpcomingFollowUps,
} from "./sections";
import { StatCards, StatCardsSkeleton } from "./stat-cards";

const RANGE_KEY = "oddly.dashboard.range";

function greeting(timeZone: string) {
  const hour = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone }).format(new Date()));
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function initialRange(timeZone: string): DateRange {
  const saved = safeStorage.get(RANGE_KEY) as PresetKey | null;
  const preset = saved && saved !== "custom" ? saved : "30d";
  try {
    return rangeForPreset(preset, timeZone);
  } catch {
    return rangeForPreset("30d", timeZone);
  }
}

export function DashboardPage() {
  const me = useMe();
  const [range, setRange] = React.useState<DateRange>(() => initialRange(me.timezone));

  const query = useQuery({
    queryKey: ["dashboard", range.from, range.to],
    queryFn: ({ signal }) => api<DashboardSummary>("/dashboard", { query: { from: range.from, to: range.to }, signal }),
    placeholderData: keepPreviousData,
    refetchInterval: 5 * 60_000,
  });

  function changeRange(next: DateRange) {
    setRange(next);
    if (next.preset !== "custom") safeStorage.set(RANGE_KEY, next.preset);
  }

  const data = query.data;

  return (
    <>
      <PageHeader
        title={`${greeting(me.timezone)}, ${firstName(me.full_name)}`}
        description={`Here's how the agency is doing · ${formatDate(new Date().toISOString(), me.timezone, { weekday: "long", month: "long", day: "numeric" })}`}
        actions={
          <>
            <Button
              variant="secondary"
              size="icon"
              aria-label="Refresh dashboard"
              onClick={() => void query.refetch()}
              disabled={query.isFetching}
            >
              <RefreshCw className={query.isFetching ? "animate-spin" : undefined} />
            </Button>
            <DateRangePicker value={range} onChange={changeRange} timeZone={me.timezone} />
          </>
        }
      />

      {query.isError && !data ? (
        <Card>
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        </Card>
      ) : !data ? (
        <DashboardSkeleton />
      ) : (
        <div className={query.isPlaceholderData ? "opacity-60 transition-opacity" : "transition-opacity"}>
          <div className="flex flex-col gap-4">
            <StatCards data={data} />

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-12">
              <div className="2xl:col-span-5">
                <LeadAcquisitionChart data={data} />
              </div>
              <div className="2xl:col-span-3">
                <LeadSourcesChart data={data} />
              </div>
              <div className="lg:col-span-2 2xl:col-span-4">
                <ConversionCard data={data} />
              </div>
            </div>

            {(data.revenue_trend || data.client_growth) && (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                {data.revenue_trend && (
                  <div className={data.client_growth ? "lg:col-span-2" : "lg:col-span-3"}>
                    <RevenueChart data={data} />
                  </div>
                )}
                {data.client_growth && (
                  <div className={data.revenue_trend ? undefined : "lg:col-span-3"}>
                    <ClientGrowthChart data={data} />
                  </div>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
              <TodaysMeetings data={data} />
              <UpcomingFollowUps data={data} />
              <MyTasks data={data} />
              <ProjectProgress data={data} />
              <RecentProposals data={data} />
              <PendingApprovals data={data} />
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <div className="lg:col-span-2">
                <RecentActivity data={data} />
              </div>
              <AiInsights data={data} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading dashboard">
      <StatCardsSkeleton />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Card key={i} className="h-[340px] gap-4 p-5">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="flex-1" />
          </Card>
        ))}
      </div>
    </div>
  );
}
