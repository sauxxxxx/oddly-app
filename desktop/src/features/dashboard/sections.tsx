import { RefreshCw } from "lucide-react";
import type * as React from "react";
import { Link } from "react-router";

import { EmptyState } from "@/components/states";
import { Badge, PriorityBadge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { useInsights, useRefreshInsights } from "@/features/ai/api";
import { useMe } from "@/features/auth/auth-context";
import { errorMessage } from "@/lib/api";
import { formatDate, formatTime, humanize } from "@/lib/format";
import type { DashboardSummary } from "@/types/api";

type Props = { data: DashboardSummary };

function ViewAll({ to }: { to: string }) {
  return (
    <Button asChild variant="ghost" size="sm" className="-mr-2 -mt-1">
      <Link to={to}>View all</Link>
    </Button>
  );
}

function Rows({ children }: { children: React.ReactNode }) {
  return <ul className="flex flex-col divide-y divide-line">{children}</ul>;
}

function Row({ title, detail, end }: { title: React.ReactNode; detail: React.ReactNode; end?: React.ReactNode }) {
  return (
    <li className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{title}</p>
        <p className="truncate text-xs text-subtle">{detail}</p>
      </div>
      {end}
    </li>
  );
}

export function TodaysMeetings({ data }: Props) {
  const me = useMe();
  const meetings = data.todays_meetings;
  if (!meetings) return null;
  return (
    <Card>
      <CardHeader title="Meetings today" action={<ViewAll to="/sales/meetings" />} />
      <CardBody>
        {meetings.length === 0 ? (
          <EmptyState title="No meetings today." compact />
        ) : (
          <Rows>
            {meetings.map((m) => (
              <Row
                key={m.id}
                title={m.title}
                detail={[formatTime(m.starts_at, me.timezone), m.meeting_url ? "Online" : m.location, m.related_name]
                  .filter(Boolean)
                  .join(", ")}
                end={m.status !== "scheduled" && <Badge>{humanize(m.status)}</Badge>}
              />
            ))}
          </Rows>
        )}
      </CardBody>
    </Card>
  );
}

export function UpcomingFollowUps({ data }: Props) {
  const me = useMe();
  const items = data.upcoming_follow_ups;
  if (!items) return null;
  return (
    <Card>
      <CardHeader title="Follow-ups" action={<ViewAll to="/sales/follow-ups" />} />
      <CardBody>
        {items.length === 0 ? (
          <EmptyState title="No follow-ups due." compact />
        ) : (
          <Rows>
            {items.map((f) => (
              <Row
                key={f.id}
                title={f.title}
                detail={
                  <>
                    {f.related_name ?? "General"},{" "}
                    <span className={f.overdue ? "text-danger-fg" : undefined}>
                      {f.overdue ? "overdue " : ""}
                      {formatDate(f.due_at, me.timezone)} {formatTime(f.due_at, me.timezone)}
                    </span>
                  </>
                }
                end={<PriorityBadge priority={f.priority} />}
              />
            ))}
          </Rows>
        )}
      </CardBody>
    </Card>
  );
}

const TASK_TONE: Record<string, BadgeTone> = {
  todo: "neutral",
  in_progress: "info",
  in_review: "accent",
  blocked: "danger",
};

export function MyTasks({ data }: Props) {
  const me = useMe();
  return (
    <Card>
      <CardHeader title="My tasks" action={<ViewAll to="/projects/my-tasks" />} />
      <CardBody>
        {data.my_tasks.length === 0 ? (
          <EmptyState title="No open tasks." compact />
        ) : (
          <Rows>
            {data.my_tasks.map((t) => (
              <Row
                key={t.id}
                title={t.title}
                detail={
                  <>
                    {t.project_name ?? "No project"}
                    {t.due_at && (
                      <span className={t.overdue ? "text-danger-fg" : undefined}>, due {formatDate(t.due_at, me.timezone)}</span>
                    )}
                  </>
                }
                end={<Badge tone={TASK_TONE[t.status] ?? "neutral"}>{humanize(t.status)}</Badge>}
              />
            ))}
          </Rows>
        )}
      </CardBody>
    </Card>
  );
}

export function PendingApprovals({ data }: Props) {
  const me = useMe();
  const items = data.pending_approvals;
  if (!items) return null;
  return (
    <Card>
      <CardHeader title="Pending approvals" action={<ViewAll to="/content/approvals" />} />
      <CardBody>
        {items.length === 0 ? (
          <EmptyState title="Nothing waiting for review." compact />
        ) : (
          <Rows>
            {items.map((a) => (
              <Row
                key={a.id}
                title={a.title}
                detail={[a.client_name, humanize(a.platform), a.publish_at && formatDate(a.publish_at, me.timezone)]
                  .filter(Boolean)
                  .join(", ")}
                end={<span className="shrink-0 text-[13px] font-medium" style={{ color: a.stage_color }}>{a.stage_name}</span>}
              />
            ))}
          </Rows>
        )}
      </CardBody>
    </Card>
  );
}

/** Only shown once AI is set up; there's nothing useful to say before that. */
export function AiInsights({ data }: Props) {
  const { configured } = data.insights;
  const insights = useInsights(configured);
  const refresh = useRefreshInsights();
  if (!configured) return null;
  const busy = insights.isFetching || refresh.isPending;
  const error = refresh.error ?? insights.error;
  return (
    <Card>
      <CardHeader
        title="AI insights"
        description="Suggestions only. Check before acting."
        action={
          <Button variant="ghost" size="sm" aria-label="Refresh insights" disabled={busy} onClick={() => refresh.mutate()}>
            <RefreshCw className={busy ? "animate-spin" : undefined} />
          </Button>
        }
      />
      <CardBody>
        {error && !insights.data ? (
          <p className="text-sm text-danger-fg">{errorMessage(error)}</p>
        ) : !insights.data ? (
          <p className="text-sm text-subtle">Loading…</p>
        ) : insights.data.items.length === 0 ? (
          <EmptyState title="No insights yet." compact />
        ) : (
          <ul className="flex flex-col gap-2 text-sm text-muted">
            {insights.data.items.map((text) => <li key={text}>{text}</li>)}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
