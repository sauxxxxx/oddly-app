import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import * as React from "react";

import { PageHeader } from "@/components/layout/app-shell";
import { ErrorState, ListSkeleton } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useMe } from "@/features/auth/auth-context";
import { api } from "@/lib/api";
import { safeStorage } from "@/lib/utils";
import type { DashboardSummary } from "@/types/api";

import { LeadAcquisitionChart, RevenueChart } from "./charts";
import { DateRangePicker, rangeForPreset, type DateRange, type PresetKey } from "./date-range";
import { AiInsights, MyTasks, PendingApprovals, TodaysMeetings, UpcomingFollowUps } from "./sections";
import { StatCards } from "./stat-cards";

const RANGE_KEY = "oddly.dashboard.range";

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
        title="Dashboard"
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
        <ListSkeleton />
      ) : (
        <div className={query.isPlaceholderData ? "opacity-60 transition-opacity" : "transition-opacity"}>
          <div className="flex flex-col gap-4">
            <StatCards data={data} />
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <TodaysMeetings data={data} />
              <UpcomingFollowUps data={data} />
              <MyTasks data={data} />
            </div>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <LeadAcquisitionChart data={data} />
              <RevenueChart data={data} />
            </div>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <PendingApprovals data={data} />
              <AiInsights data={data} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
