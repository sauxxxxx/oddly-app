import {
  Activity,
  CalendarClock,
  CalendarDays,
  CircleCheck,
  FileText,
  FolderKanban,
  ImageIcon,
  MapPin,
  Sparkles,
  Video,
} from "lucide-react";
import type * as React from "react";
import { Link } from "react-router";

import { EmptyState } from "@/components/states";
import { Badge, PriorityBadge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Avatar, Progress } from "@/components/ui/misc";
import { useMe } from "@/features/auth/auth-context";
import { formatDate, formatMoney, formatPlainDate, formatRelative, formatTime, humanize } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { DashboardSummary } from "@/types/api";

type Props = { data: DashboardSummary };

function ViewAll({ to }: { to: string }) {
  return (
    <Button asChild variant="ghost" size="sm" className="-mr-2">
      <Link to={to}>View all</Link>
    </Button>
  );
}

function Row({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <li className={cn("flex items-center gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-raised/50", className)}>
      {children}
    </li>
  );
}

function IconTile({ icon: Icon, tone = "neutral" }: { icon: React.ComponentType<{ className?: string }>; tone?: "neutral" | "accent" | "danger" }) {
  return (
    <span
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-xl border",
        tone === "accent" && "border-accent/25 bg-accent-soft text-accent",
        tone === "danger" && "border-danger/25 bg-danger-soft text-danger",
        tone === "neutral" && "border-line bg-raised text-subtle",
      )}
    >
      <Icon className="size-4" />
    </span>
  );
}

// ---------------------------------------------------------------------------

export function TodaysMeetings({ data }: Props) {
  const me = useMe();
  const meetings = data.todays_meetings;
  if (!meetings) return null;
  return (
    <Card>
      <CardHeader title="Today's meetings" description={formatDate(new Date().toISOString(), me.timezone, { weekday: "long", month: "long", day: "numeric" })} action={<ViewAll to="/sales/meetings" />} />
      <CardBody>
        {meetings.length === 0 ? (
          <EmptyState icon={CalendarDays} title="No meetings today" description="Meetings you organize or join appear here." compact />
        ) : (
          <ul className="-mx-2 flex flex-col">
            {meetings.map((m) => (
              <Row key={m.id}>
                <div className="w-16 shrink-0 text-right">
                  <p className="text-sm font-medium tabular-nums">{formatTime(m.starts_at, me.timezone)}</p>
                  {m.ends_at && <p className="text-xs text-subtle tabular-nums">{formatTime(m.ends_at, me.timezone)}</p>}
                </div>
                <span className="h-9 w-px shrink-0 bg-accent/50" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{m.title}</p>
                  <p className="flex items-center gap-1.5 truncate text-xs text-subtle">
                    {m.meeting_url ? <Video className="size-3" /> : m.location ? <MapPin className="size-3" /> : null}
                    {m.meeting_url ? "Online" : (m.location ?? "No location")}
                    {m.related_name && ` · ${m.related_name}`}
                  </p>
                </div>
                {m.status !== "scheduled" && <Badge>{humanize(m.status)}</Badge>}
              </Row>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

export function UpcomingFollowUps({ data }: Props) {
  const me = useMe();
  const items = data.upcoming_follow_ups;
  if (!items) return null;
  const overdue = items.filter((f) => f.overdue).length;
  return (
    <Card>
      <CardHeader
        title="Follow-ups"
        description={overdue > 0 ? `${overdue} overdue` : "Assigned to you"}
        action={<ViewAll to="/sales/follow-ups" />}
      />
      <CardBody>
        {items.length === 0 ? (
          <EmptyState icon={CalendarClock} title="No follow-ups due" description="Follow-ups assigned to you will line up here by due date." compact />
        ) : (
          <ul className="-mx-2 flex flex-col">
            {items.map((f) => (
              <Row key={f.id}>
                <IconTile icon={CalendarClock} tone={f.overdue ? "danger" : "accent"} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{f.title}</p>
                  <p className="truncate text-xs text-subtle">
                    {f.related_name ?? "General"} ·{" "}
                    <span className={f.overdue ? "text-[#fca5a5]" : undefined}>
                      {f.overdue ? "Overdue, " : ""}
                      {formatDate(f.due_at, me.timezone)} {formatTime(f.due_at, me.timezone)}
                    </span>
                  </p>
                </div>
                <PriorityBadge priority={f.priority} />
              </Row>
            ))}
          </ul>
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
      <CardHeader title="My tasks" description={`${data.my_tasks.length} open`} action={<ViewAll to="/projects/my-tasks" />} />
      <CardBody>
        {data.my_tasks.length === 0 ? (
          <EmptyState icon={CircleCheck} title="Nothing assigned to you" description="Tasks assigned to you across projects show up here." compact />
        ) : (
          <ul className="-mx-2 flex flex-col">
            {data.my_tasks.map((t) => (
              <Row key={t.id}>
                <IconTile icon={CircleCheck} tone={t.overdue ? "danger" : "neutral"} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{t.title}</p>
                  <p className="truncate text-xs text-subtle">
                    {t.project_name ?? "No project"}
                    {t.due_at && (
                      <span className={t.overdue ? "text-[#fca5a5]" : undefined}> · due {formatDate(t.due_at, me.timezone)}</span>
                    )}
                  </p>
                </div>
                <Badge tone={TASK_TONE[t.status] ?? "neutral"}>{humanize(t.status)}</Badge>
              </Row>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

// ---------------------------------------------------------------------------

export function ProjectProgress({ data }: Props) {
  const projects = data.project_progress;
  if (!projects) return null;
  return (
    <Card>
      <CardHeader title="Project progress" description="Active projects by deadline" action={<ViewAll to="/projects" />} />
      <CardBody>
        {projects.length === 0 ? (
          <EmptyState icon={FolderKanban} title="No active projects" description="Client projects and their task completion appear here." compact />
        ) : (
          <ul className="flex flex-col gap-4">
            {projects.map((p) => {
              const pct = p.total_tasks ? (p.done_tasks / p.total_tasks) * 100 : 0;
              return (
                <li key={p.id}>
                  <div className="mb-2 flex items-baseline justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{p.name}</p>
                      <p className="truncate text-xs text-subtle">
                        {p.client_name ?? "Internal"}
                        {p.deadline && ` · due ${formatPlainDate(p.deadline)}`}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs tabular-nums text-muted">
                      {p.done_tasks}/{p.total_tasks} · {Math.round(pct)}%
                    </span>
                  </div>
                  <Progress value={pct} />
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

const PROPOSAL_TONE: Record<string, BadgeTone> = {
  draft: "neutral",
  ready: "info",
  sent: "accent",
  accepted: "success",
  rejected: "danger",
  expired: "warning",
};

export function RecentProposals({ data }: Props) {
  const proposals = data.recent_proposals;
  if (!proposals) return null;
  return (
    <Card>
      <CardHeader title="Recent proposals" action={<ViewAll to="/sales/proposals" />} />
      <CardBody>
        {proposals.length === 0 ? (
          <EmptyState icon={FileText} title="No proposals yet" description="Proposals built in CRM & Sales are tracked here by status." compact />
        ) : (
          <ul className="-mx-2 flex flex-col">
            {proposals.map((p) => (
              <Row key={p.id}>
                <IconTile icon={FileText} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{p.company_name}</p>
                  <p className="truncate text-xs text-subtle">
                    {p.number} · {formatMoney(p.total, p.currency)}
                  </p>
                </div>
                <Badge tone={PROPOSAL_TONE[p.status] ?? "neutral"} dot>
                  {p.status === "ready" ? "Ready to send" : humanize(p.status)}
                </Badge>
              </Row>
            ))}
          </ul>
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
      <CardHeader title="Pending approvals" description="Content awaiting review" action={<ViewAll to="/content/approvals" />} />
      <CardBody>
        {items.length === 0 ? (
          <EmptyState icon={ImageIcon} title="Nothing waiting for review" description="Posts in internal review or client approval appear here." compact />
        ) : (
          <ul className="-mx-2 flex flex-col">
            {items.map((a) => (
              <Row key={a.id}>
                <IconTile icon={ImageIcon} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{a.title}</p>
                  <p className="truncate text-xs text-subtle">
                    {a.client_name} · {humanize(a.platform)}
                    {a.publish_at && ` · ${formatDate(a.publish_at, me.timezone)}`}
                  </p>
                </div>
                <span
                  className="shrink-0 rounded-full border px-2 py-0.5 text-[11.5px] font-medium"
                  style={{ color: a.stage_color, borderColor: `${a.stage_color}40`, background: `${a.stage_color}1f` }}
                >
                  {a.stage_name}
                </span>
              </Row>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

// ---------------------------------------------------------------------------

export function RecentActivity({ data }: Props) {
  return (
    <Card>
      <CardHeader title="Recent activity" description="Latest changes across the workspace" />
      <CardBody>
        {data.recent_activities.length === 0 ? (
          <EmptyState icon={Activity} title="No activity yet" description="Adding leads, logging outreach and updating clients builds this timeline." compact />
        ) : (
          <ol className="relative flex flex-col gap-4 before:absolute before:bottom-2 before:left-[17px] before:top-2 before:w-px before:bg-line">
            {data.recent_activities.map((a) => (
              <li key={a.id} className="relative flex items-start gap-3">
                <Avatar name={a.actor_name ?? "System"} className="size-9 ring-4" />
                <div className="min-w-0 flex-1 pt-0.5">
                  <p className="text-sm leading-snug text-fg">{a.summary}</p>
                  <p className="mt-0.5 text-xs text-subtle">{formatRelative(a.created_at)}</p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </CardBody>
    </Card>
  );
}

export function AiInsights({ data }: Props) {
  const { configured, items } = data.insights;
  return (
    <Card className="overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute -right-16 -top-16 size-48 rounded-full bg-accent/15 blur-3xl" />
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Sparkles className="size-4 text-accent" /> AI insights
          </span>
        }
        description="Suggestions only — always check before acting"
      />
      <CardBody>
        {!configured ? (
          <EmptyState
            icon={Sparkles}
            title="AI insights aren't switched on yet"
            description="They arrive with the AI Assistant (Phase 6), once an administrator adds an OpenAI key on the server. Keys are never stored in the app."
            compact
          />
        ) : items.length === 0 ? (
          <EmptyState icon={Sparkles} title="No insights yet" description="Insights are generated from your pipeline and client activity." compact />
        ) : (
          <ul className="flex flex-col gap-2">
            {items.map((text) => (
              <li key={text} className="rounded-xl border border-line bg-raised/50 p-3 text-sm text-muted">
                {text}
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
