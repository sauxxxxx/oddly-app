import {
  CalendarClock,
  CalendarDays,
  Check,
  MapPin,
  MessageSquare,
  Pencil,
  Plus,
  Repeat,
  Search,
  Trash2,
  Video,
} from "lucide-react";
import * as React from "react";
import { Link } from "react-router";

import { PageHeader } from "@/components/layout/app-shell";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/states";
import { Badge, PriorityBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Pagination } from "@/components/ui/data-table";
import { Tabs } from "@/components/ui/form-controls";
import { Input, Select } from "@/components/ui/input";
import { useAuth, useMe } from "@/features/auth/auth-context";
import { useLookups } from "@/features/leads/api";
import { errorMessage } from "@/lib/api";
import { openExternal } from "@/lib/external";
import { formatDate, formatRelative, formatTime, humanize, todayIn } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { FollowUp, Meeting } from "@/types/sales";
import { CHANNEL_LABELS, type Channel } from "@/types/sales";

import { useCompleteFollowUp, useDeleteFollowUp, useDeleteMeeting, useFollowUps, useInteractions, useMeetings } from "./api";
import { FollowUpDialog, MeetingDialog } from "./dialogs";

// ---------------------------------------------------------------------------
// Outreach history
// ---------------------------------------------------------------------------

export function OutreachPage() {
  const me = useMe();
  const lookups = useLookups();
  const [channel, setChannel] = React.useState("");
  const [userId, setUserId] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [debounced, setDebounced] = React.useState("");
  const [page, setPage] = React.useState(1);
  React.useEffect(() => {
    const t = setTimeout(() => { setDebounced(search); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [search]);
  const data = useInteractions({ channel: channel || undefined, user_id: userId || undefined, search: debounced || undefined, page });

  return (
    <>
      <PageHeader title="Outreach history" description="Every call, message, visit and note logged against a lead." />
      <Card className="overflow-hidden">
        <div className="flex flex-wrap gap-2 border-b border-line p-4">
          <div className="relative min-w-60 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search business or message…" className="pl-9" aria-label="Search outreach" />
          </div>
          <Select aria-label="Channel" value={channel} onChange={(e) => { setChannel(e.target.value); setPage(1); }} className="w-auto min-w-44">
            <option value="">All channels</option>
            {(Object.keys(CHANNEL_LABELS) as Channel[]).map((c) => <option key={c} value={c}>{CHANNEL_LABELS[c]}</option>)}
          </Select>
          <Select aria-label="Team member" value={userId} onChange={(e) => { setUserId(e.target.value); setPage(1); }} className="w-auto min-w-40">
            <option value="">Everyone</option>
            {lookups.data?.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </Select>
        </div>
        {data.isError ? (
          <ErrorState error={data.error} onRetry={() => void data.refetch()} />
        ) : data.isPending ? (
          <div className="p-6"><ListSkeleton rows={6} /></div>
        ) : data.data.items.length === 0 ? (
          <EmptyState icon={MessageSquare} title="No outreach logged" description="Use “Log outreach” on a lead after every call, message or visit." />
        ) : (
          <>
            <ul className="divide-y divide-line/60">
              {data.data.items.map((i) => (
                <li key={i.id} className="flex gap-4 px-5 py-4">
                  <div className="w-28 shrink-0 text-xs text-subtle">
                    <p className="text-muted">{formatDate(i.occurred_at, me.timezone)}</p>
                    <p>{formatTime(i.occurred_at, me.timezone)}</p>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">
                      <Link to={`/leads/record/${i.lead_id}`} className="font-medium hover:underline">{i.business_name}</Link>
                      <span className="text-subtle"> · {CHANNEL_LABELS[i.channel]}{i.direction === "inbound" ? " (incoming)" : ""}</span>
                    </p>
                    {i.subject && <p className="mt-1 text-sm font-medium text-muted">{i.subject}</p>}
                    {i.body && <p className="mt-1 whitespace-pre-wrap text-sm text-muted">{i.body}</p>}
                    {i.outcome && <p className="mt-1.5 text-xs text-accent">Outcome: {i.outcome}</p>}
                  </div>
                  <span className="shrink-0 text-xs text-subtle">{i.user_name ?? ""}</span>
                </li>
              ))}
            </ul>
            <Pagination page={data.data.page} perPage={data.data.per_page} total={data.data.total} onPage={setPage} />
          </>
        )}
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
// Follow-ups
// ---------------------------------------------------------------------------

export function FollowUpsPage() {
  const { can } = useAuth();
  const [scope, setScope] = React.useState<"mine" | "team">("mine");
  const [status, setStatus] = React.useState<"pending" | "done">("pending");
  const [creating, setCreating] = React.useState(false);
  const data = useFollowUps({ scope, status, per_page: 200 });
  const items = data.data?.items ?? [];
  const groups = status === "done" ? [{ label: "Completed", items }] : groupByDue(items);

  return (
    <>
      <PageHeader
        title="Follow-ups"
        description="Reminders to get back to prospects and clients. You're notified when one is due."
        actions={can("sales.manage") && <Button onClick={() => setCreating(true)}><Plus /> New follow-up</Button>}
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <Tabs value={status} onChange={setStatus} tabs={[{ value: "pending", label: "To do" }, { value: "done", label: "Done" }]} />
        {can("leads.view_all") && <Tabs value={scope} onChange={setScope} tabs={[{ value: "mine", label: "Mine" }, { value: "team", label: "Whole team" }]} />}
      </div>
      {data.isError ? (
        <Card><ErrorState error={data.error} onRetry={() => void data.refetch()} /></Card>
      ) : data.isPending ? (
        <Card className="p-6"><ListSkeleton rows={5} /></Card>
      ) : items.length === 0 ? (
        <Card><EmptyState icon={CalendarClock} title={status === "pending" ? "Nothing to follow up" : "No completed follow-ups yet"} description="Schedule one from a lead, or when you log outreach." /></Card>
      ) : (
        <div className="flex flex-col gap-4">
          {groups.filter((g) => g.items.length).map((g) => (
            <Card key={g.label}>
              <CardHeader title={g.label} description={`${g.items.length}`} />
              <CardBody>
                <ul className="-mx-2 flex flex-col">{g.items.map((f) => <FollowUpRow key={f.id} item={f} showOwner={scope === "team"} />)}</ul>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
      <FollowUpDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}

function groupByDue(items: FollowUp[]) {
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const week = new Date(end.getTime() + 6 * 86400_000);
  return [
    { label: "Overdue", items: items.filter((f) => f.overdue) },
    { label: "Today", items: items.filter((f) => !f.overdue && new Date(f.due_at) <= end) },
    { label: "This week", items: items.filter((f) => new Date(f.due_at) > end && new Date(f.due_at) <= week) },
    { label: "Later", items: items.filter((f) => new Date(f.due_at) > week) },
  ];
}

export function FollowUpRow({ item: f, showOwner }: { item: FollowUp; showOwner?: boolean }) {
  const me = useMe();
  const { can } = useAuth();
  const complete = useCompleteFollowUp();
  const remove = useDeleteFollowUp();
  const [editing, setEditing] = React.useState(false);
  const [confirm, setConfirm] = React.useState(false);
  const related = f.lead_id ? `/leads/record/${f.lead_id}` : f.client_id ? `/clients/record/${f.client_id}` : null;

  return (
    <li className="group flex items-center gap-3 rounded-xl px-2 py-2.5 hover:bg-raised/50">
      {f.status === "pending" && can("sales.manage") ? (
        <button
          aria-label={`Mark “${f.title}” done`}
          onClick={() => complete.mutate(f.id)}
          disabled={complete.isPending}
          className="flex size-6 shrink-0 items-center justify-center rounded-full border border-line-strong text-transparent transition-colors hover:border-success hover:text-success"
        >
          <Check className="size-3.5" />
        </button>
      ) : (
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-success-soft text-success"><Check className="size-3.5" /></span>
      )}
      <div className="min-w-0 flex-1">
        <p className={cn("truncate text-sm font-medium", f.status === "done" && "text-muted line-through")}>{f.title}</p>
        <p className="truncate text-xs text-subtle">
          {related ? <Link to={related} className="hover:underline">{f.related_name ?? "Record"}</Link> : "General"}
          {" · "}
          <span className={f.overdue ? "text-danger-fg" : undefined}>
            {f.status === "done" && f.completed_at ? `done ${formatRelative(f.completed_at)}` : `${formatDate(f.due_at, me.timezone, { weekday: "short", month: "short", day: "numeric" })} ${formatTime(f.due_at, me.timezone)}`}
          </span>
          {showOwner && f.assigned_name && ` · ${f.assigned_name}`}
        </p>
        {complete.isError && <p className="text-xs text-danger">{errorMessage(complete.error)}</p>}
      </div>
      {f.recurrence && <Repeat className="size-3.5 text-subtle" aria-label={`Repeats ${f.recurrence}`} />}
      <PriorityBadge priority={f.priority} />
      {f.status === "pending" && can("sales.manage") && (
        <div className="flex opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <Button variant="ghost" size="icon-sm" aria-label="Edit follow-up" onClick={() => setEditing(true)}><Pencil /></Button>
          <Button variant="ghost" size="icon-sm" aria-label="Cancel follow-up" onClick={() => setConfirm(true)}><Trash2 /></Button>
        </div>
      )}
      <FollowUpDialog open={editing} onOpenChange={setEditing} followUp={f} />
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} title="Cancel this follow-up?" description={f.title} confirmLabel="Cancel follow-up" onConfirm={() => remove.mutateAsync(f.id)} />
    </li>
  );
}

// ---------------------------------------------------------------------------
// Meetings
// ---------------------------------------------------------------------------

export function MeetingsPage() {
  const me = useMe();
  const { can } = useAuth();
  const [view, setView] = React.useState<"upcoming" | "past">("upcoming");
  const [scope, setScope] = React.useState<"mine" | "team">("mine");
  const [creating, setCreating] = React.useState(false);
  const now = React.useMemo(() => new Date().toISOString(), []);
  const data = useMeetings(view === "upcoming" ? { from: new Date(Date.now() - 4 * 3600_000).toISOString(), scope } : { to: now, scope });
  const meetings = view === "past" ? [...(data.data ?? [])].reverse() : data.data ?? [];

  // Group by calendar day in the user's time zone.
  const days = new Map<string, Meeting[]>();
  for (const m of meetings) {
    const key = new Intl.DateTimeFormat("en-CA", { timeZone: me.timezone }).format(new Date(m.starts_at));
    days.set(key, [...(days.get(key) ?? []), m]);
  }
  const today = todayIn(me.timezone);

  return (
    <>
      <PageHeader
        title="Meetings"
        description="Calls and visits with prospects and clients, with notes and outcomes."
        actions={can("sales.manage") && <Button onClick={() => setCreating(true)}><Plus /> Schedule meeting</Button>}
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <Tabs value={view} onChange={setView} tabs={[{ value: "upcoming", label: "Upcoming" }, { value: "past", label: "Past" }]} />
        {can("leads.view_all") && <Tabs value={scope} onChange={setScope} tabs={[{ value: "mine", label: "Mine" }, { value: "team", label: "Whole team" }]} />}
      </div>
      {data.isError ? (
        <Card><ErrorState error={data.error} onRetry={() => void data.refetch()} /></Card>
      ) : data.isPending ? (
        <Card className="p-6"><ListSkeleton rows={5} /></Card>
      ) : meetings.length === 0 ? (
        <Card><EmptyState icon={CalendarDays} title={view === "upcoming" ? "No upcoming meetings" : "No past meetings"} description="Schedule meetings from a lead or here." /></Card>
      ) : (
        <div className="flex flex-col gap-4">
          {[...days.entries()].map(([day, list]) => (
            <Card key={day}>
              <CardHeader title={day === today ? "Today" : formatDate(`${day}T12:00:00Z`, "UTC", { weekday: "long", month: "long", day: "numeric" })} />
              <CardBody>
                <ul className="-mx-2 flex flex-col">{list.map((m) => <MeetingRow key={m.id} meeting={m} />)}</ul>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
      <MeetingDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}

export function MeetingRow({ meeting: m }: { meeting: Meeting }) {
  const me = useMe();
  const { can } = useAuth();
  const [open, setOpen] = React.useState(false);
  const [confirm, setConfirm] = React.useState(false);
  const remove = useDeleteMeeting();
  return (
    <li className="group flex items-center gap-3 rounded-xl px-2 py-2.5 hover:bg-raised/50">
      <div className="w-16 shrink-0 text-right">
        <p className="text-sm font-medium tabular-nums">{formatTime(m.starts_at, me.timezone)}</p>
        {m.ends_at && <p className="text-xs tabular-nums text-subtle">{formatTime(m.ends_at, me.timezone)}</p>}
      </div>
      <span className="h-9 w-px shrink-0 bg-accent/50" />
      <button className="min-w-0 flex-1 text-left" onClick={() => setOpen(true)}>
        <p className="truncate text-sm font-medium">{m.title}</p>
        <p className="flex items-center gap-1.5 truncate text-xs text-subtle">
          {m.meeting_url ? <Video className="size-3" /> : m.location ? <MapPin className="size-3" /> : null}
          {m.meeting_url ? "Online" : m.location ?? "No location"}
          {m.related_name && ` · ${m.related_name}`}
          {m.participants.length > 0 && ` · ${m.participants.map((p) => p.name).filter(Boolean).join(", ")}`}
        </p>
      </button>
      {m.status !== "scheduled" && <Badge tone={m.status === "completed" ? "success" : "neutral"}>{humanize(m.status)}</Badge>}
      {m.meeting_url && m.status === "scheduled" && (
        <Button variant="secondary" size="sm" onClick={() => openExternal(m.meeting_url!)}><Video /> Join</Button>
      )}
      {can("sales.manage") && (
        <Button variant="ghost" size="icon-sm" className="opacity-0 group-hover:opacity-100 focus:opacity-100" aria-label="Delete meeting" onClick={() => setConfirm(true)}>
          <Trash2 />
        </Button>
      )}
      <MeetingDialog open={open} onOpenChange={setOpen} meeting={m} />
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} title="Delete this meeting?" description={m.title} onConfirm={() => remove.mutateAsync(m.id)} />
    </li>
  );
}
