import { ScrollText, Users } from "lucide-react";
import * as React from "react";

import { PageHeader } from "@/components/layout/app-shell";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/states";
import { Card, CardHeader } from "@/components/ui/card";
import { Pagination } from "@/components/ui/data-table";
import { Input, Select } from "@/components/ui/input";
import { Avatar } from "@/components/ui/misc";
import { useMe } from "@/features/auth/auth-context";
import { useLookups } from "@/features/leads/api";
import { useAuditLog, useWorkload } from "@/features/ops/api";
import { formatDate, formatTime, humanize } from "@/lib/format";
import { cn } from "@/lib/utils";

/** What each person has on their plate — shown on Team Members. */
export function WorkloadCard() {
  const workload = useWorkload();
  const cols: [keyof NonNullable<typeof workload.data>[number], string][] = [
    ["open_tasks", "Open tasks"],
    ["overdue_tasks", "Overdue"],
    ["done_last_30d", "Done (30d)"],
    ["active_leads", "Active leads"],
    ["pending_follow_ups", "Follow-ups"],
    ["open_deals", "Open deals"],
    ["won_last_30d", "Won (30d)"],
    ["open_content", "Content"],
    ["open_maintenance", "Maintenance"],
  ];
  const max = Math.max(1, ...(workload.data ?? []).map((w) => w.open_tasks));
  return (
    <Card className="mt-4 overflow-hidden">
      <CardHeader title="Workload" description="Open work per person across tasks, sales, content and websites." className="pb-4" />
      {workload.isError ? <ErrorState error={workload.error} onRetry={() => void workload.refetch()} compact />
        : workload.isPending ? <div className="p-6"><ListSkeleton rows={3} /></div>
        : workload.data.length === 0 ? <EmptyState icon={Users} title="No team members" compact />
        : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-y border-line text-left text-xs uppercase tracking-[0.06em] text-subtle">
                  <th className="px-5 py-3 font-medium">Member</th>
                  {cols.map(([, label]) => <th key={label} className="px-3 py-3 text-right font-medium">{label}</th>)}
                </tr>
              </thead>
              <tbody>
                {workload.data.map((w) => (
                  <tr key={w.id} className="border-b border-line/60 last:border-0">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar name={w.full_name} className="size-8 text-[11px]" />
                        <div className="min-w-0">
                          <p className="truncate font-medium">{w.full_name}</p>
                          <div className="mt-1 h-1 w-32 overflow-hidden rounded-full bg-raised"><div className="h-full bg-accent" style={{ width: `${(w.open_tasks / max) * 100}%` }} /></div>
                        </div>
                      </div>
                    </td>
                    {cols.map(([key, label]) => (
                      <td key={label} className={cn("px-3 py-3 text-right tabular-nums", key === "overdue_tasks" && w.overdue_tasks > 0 ? "text-[#fca5a5]" : "text-muted")}>{w[key] as number}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </Card>
  );
}

export function AuditLogPage() {
  const me = useMe();
  const lookups = useLookups();
  const [actor, setActor] = React.useState("");
  const [action, setAction] = React.useState("");
  const [page, setPage] = React.useState(1);
  React.useEffect(() => setPage(1), [actor, action]);
  const log = useAuditLog({ actor_id: actor || undefined, action: action || undefined, page });
  return (
    <>
      <PageHeader title="Activity log" description="Security-relevant actions: sign-ups, role changes, exports, deletions, credential reveals." />
      <Card className="overflow-hidden">
        <div className="flex flex-wrap gap-2 border-b border-line p-4">
          <Select aria-label="Person" value={actor} onChange={(e) => setActor(e.target.value)} className="w-auto min-w-48">
            <option value="">Everyone</option>
            {lookups.data?.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </Select>
          <Input aria-label="Action starts with" value={action} onChange={(e) => setAction(e.target.value)} placeholder="Action, e.g. secret. or team." className="w-72" />
        </div>
        {log.isError ? <ErrorState error={log.error} onRetry={() => void log.refetch()} />
          : log.isPending ? <div className="p-6"><ListSkeleton rows={6} /></div>
          : log.data.items.length === 0 ? <EmptyState icon={ScrollText} title="Nothing logged yet" />
          : (
            <>
              <ul className="divide-y divide-line/60">
                {log.data.items.map((r) => (
                  <li key={r.id} className="flex items-start gap-4 px-5 py-3">
                    <span className="w-36 shrink-0 text-xs tabular-nums text-subtle">{formatDate(r.created_at, me.timezone, { year: "numeric" })} {formatTime(r.created_at, me.timezone)}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm"><span className="font-medium">{r.actor_name ?? "System"}</span> <span className="text-muted">· {humanize(r.action.replace(/\./g, " "))}</span></p>
                      {r.changes && Object.keys(r.changes).length > 0 && (
                        <p className="mt-0.5 truncate font-mono text-xs text-subtle">{JSON.stringify(r.changes)}</p>
                      )}
                    </div>
                    {r.entity_type && <span className="text-xs text-subtle">{r.entity_type}</span>}
                  </li>
                ))}
              </ul>
              <Pagination page={log.data.page} perPage={log.data.per_page} total={log.data.total} onPage={setPage} />
            </>
          )}
      </Card>
    </>
  );
}
