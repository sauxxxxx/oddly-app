import { ArrowLeft, Pencil, Plus, Search, Trash2 } from "lucide-react";
import * as React from "react";
import { Link, useNavigate, useParams } from "react-router";

import { FilesPanel } from "@/components/files-panel";
import { PageHeader } from "@/components/layout/app-shell";
import { dayKey, monthKey, monthRange, MonthCalendar } from "@/components/month-calendar";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/states";
import { Badge, PriorityBadge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Checkbox, TagInput, Tabs, Textarea } from "@/components/ui/form-controls";
import { Field, Input, Select } from "@/components/ui/input";
import { Avatar, Progress } from "@/components/ui/misc";
import { useAuth, useMe } from "@/features/auth/auth-context";
import { FormAlert } from "@/features/auth/auth-layout";
import { useLookups } from "@/features/leads/api";
import {
  useDeleteProject,
  useProject,
  useProjects,
  useProjectTemplates,
  useSaveProject,
  useTasks,
} from "@/features/ops/api";
import { ApiError, errorMessage } from "@/lib/api";
import { formatPlainDate, humanize, todayIn } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Project, ProjectStatus, Task } from "@/types/ops";

import { TaskBoard } from "./task-board";
import { TaskDialog, TaskList } from "./task-panel";

const STATUS_TONE: Record<ProjectStatus, BadgeTone> = { planning: "info", active: "accent", on_hold: "warning", completed: "success", cancelled: "neutral" };

function useTaskDialog() {
  const [state, setState] = React.useState<{ id: string | null; defaults?: { project_id?: string; client_id?: string; due_at?: string } } | null>(null);
  return {
    open: (id: string | null, defaults?: { project_id?: string; client_id?: string; due_at?: string }) => setState({ id, defaults }),
    node: <TaskDialog open={!!state} onOpenChange={(o) => !o && setState(null)} taskId={state?.id} defaults={state?.defaults} />,
  };
}

// ---------------------------------------------------------------------------
// All projects
// ---------------------------------------------------------------------------

export function ProjectsPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = React.useState("current");
  const [mine, setMine] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const projects = useProjects({ status, member: mine ? "me" : undefined, search: search || undefined });

  return (
    <>
      <PageHeader
        title="Projects"
        actions={can("projects.manage") && <Button onClick={() => setCreating(true)}><Plus /> New project</Button>}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Tabs value={status} onChange={setStatus} tabs={[{ value: "current", label: "Current" }, { value: "completed", label: "Completed" }, { value: "all", label: "All" }]} />
        <Tabs value={mine ? "mine" : "all"} onChange={(v) => setMine(v === "mine")} tabs={[{ value: "all", label: "Everyone's" }, { value: "mine", label: "Mine" }]} />
        <div className="relative w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search projects…" className="pl-9" aria-label="Search projects" />
        </div>
      </div>
      {projects.isError ? (
        <Card><ErrorState error={projects.error} onRetry={() => void projects.refetch()} /></Card>
      ) : projects.isPending ? (
        <Card className="p-6"><ListSkeleton rows={4} /></Card>
      ) : projects.data.length === 0 ? (
        <Card><EmptyState title="No projects here" /></Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {projects.data.map((p) => <ProjectCard key={p.id} project={p} onClick={() => navigate(`/projects/record/${p.id}`)} />)}
        </div>
      )}
      <ProjectDialog open={creating} onOpenChange={setCreating} onSaved={(p) => navigate(`/projects/record/${p.id}`)} />
    </>
  );
}

export function ProjectCard({ project: p, onClick }: { project: Project; onClick: () => void }) {
  const pct = p.total_tasks ? (p.done_tasks / p.total_tasks) * 100 : 0;
  return (
    <Card className="cursor-pointer gap-4 p-5 transition-colors hover:border-line-strong" onClick={onClick}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium">{p.name}</p>
          <p className="truncate text-xs text-subtle">{p.client_name ?? "Internal"}{p.category && `, ${p.category}`}</p>
        </div>
        <Badge tone={STATUS_TONE[p.status]} dot>{humanize(p.status)}</Badge>
      </div>
      <div>
        <div className="mb-1.5 flex justify-between text-xs text-subtle">
          <span>{p.done_tasks}/{p.total_tasks} tasks{p.overdue_tasks > 0 && <span className="text-danger-fg">, {p.overdue_tasks} overdue</span>}</span>
          <span className="tabular-nums">{Math.round(pct)}%</span>
        </div>
        <Progress value={pct} />
      </div>
      <div className="flex items-center justify-between">
        <div className="flex -space-x-2">{p.members.slice(0, 5).map((m) => <Avatar key={m.id} name={m.name} className="size-7 text-[10px]" />)}</div>
        <span className="text-xs text-subtle">{p.deadline ? `Due ${formatPlainDate(p.deadline, { month: "short", day: "numeric", year: "numeric" })}` : "No deadline"}</span>
      </div>
    </Card>
  );
}

export function ProjectDialog({
  open,
  onOpenChange,
  project,
  clientId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  project?: Project;
  clientId?: string;
  onSaved?: (p: Project) => void;
}) {
  const me = useMe();
  const lookups = useLookups();
  const templates = useProjectTemplates();
  const save = useSaveProject(project?.id);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const init = () => ({
    name: project?.name ?? "",
    description: project?.description ?? "",
    category: project?.category ?? "",
    status: project?.status ?? ("planning" as ProjectStatus),
    priority: project?.priority ?? "medium",
    client_id: project?.client_id ?? clientId ?? "",
    start_date: project?.start_date ?? new Date().toISOString().slice(0, 10),
    deadline: project?.deadline ?? "",
    owner_id: project?.owner_id ?? me.id,
    deliverables: project?.deliverables ?? [],
    member_ids: project?.members.map((m) => m.id) ?? [me.id],
    template: "",
  });
  const [f, setF] = React.useState(init);
  React.useEffect(() => {
    if (open) {
      setF(init());
      setErrors({});
      save.reset();
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps -- reset when opened
  const tpl = templates.data?.find((t) => t.key === f.template);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={project ? "Edit project" : "New project"} className="max-h-[calc(100vh-4rem)] max-w-2xl overflow-y-auto">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!f.name.trim()) return setErrors({ name: "Name the project." });
            save.mutate(
              { ...f, name: f.name.trim(), description: f.description || null, category: f.category || null, client_id: f.client_id || null,
                start_date: f.start_date || null, deadline: f.deadline || null, owner_id: f.owner_id || null, template: f.template || null },
              { onSuccess: (p) => { onOpenChange(false); onSaved?.(p); }, onError: (err) => err instanceof ApiError && setErrors(err.fields) },
            );
          }}
        >
          {save.isError && !(save.error instanceof ApiError && save.error.code === "validation_failed") && <FormAlert>{errorMessage(save.error)}</FormAlert>}
          {!project && (
            <Field label="Start from a template" htmlFor="pj-tpl" hint={tpl ? `Creates ${tpl.tasks.length} tasks: ${tpl.tasks.slice(0, 3).join(", ")}…` : undefined}>
              <Select id="pj-tpl" value={f.template} onChange={(e) => {
                const t = templates.data?.find((x) => x.key === e.target.value);
                setF({ ...f, template: e.target.value, category: t?.category ?? f.category, name: f.name || (t ? t.name : "") });
              }}>
                <option value="">Blank project</option>
                {templates.data?.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}
              </Select>
            </Field>
          )}
          <Field label="Name" htmlFor="pj-name" error={errors.name}><Input id="pj-name" autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Client" htmlFor="pj-client">
              <Select id="pj-client" value={f.client_id} onChange={(e) => setF({ ...f, client_id: e.target.value })}>
                <option value="">Internal project</option>
                {lookups.data?.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
            <Field label="Category" htmlFor="pj-cat"><Input id="pj-cat" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} /></Field>
            <Field label="Status" htmlFor="pj-status">
              <Select id="pj-status" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as ProjectStatus })}>
                {(["planning", "active", "on_hold", "completed", "cancelled"] as const).map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
              </Select>
            </Field>
            <Field label="Priority" htmlFor="pj-prio">
              <Select id="pj-prio" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value as typeof f.priority })}>
                <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option>
              </Select>
            </Field>
            <Field label="Start" htmlFor="pj-start"><Input id="pj-start" type="date" value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value })} /></Field>
            <Field label="Deadline" htmlFor="pj-deadline" error={errors.deadline}><Input id="pj-deadline" type="date" value={f.deadline} onChange={(e) => setF({ ...f, deadline: e.target.value })} /></Field>
            <Field label="Project owner" htmlFor="pj-owner" className="col-span-2">
              <Select id="pj-owner" value={f.owner_id} onChange={(e) => setF({ ...f, owner_id: e.target.value })}>
                {lookups.data?.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </Select>
            </Field>
          </div>
          <Field label="Deliverables" htmlFor="pj-deliv" hint="Press Enter after each one."><TagInput id="pj-deliv" value={f.deliverables} onChange={(v) => setF({ ...f, deliverables: v })} placeholder="e.g. 5-page website" /></Field>
          <div>
            <p className="mb-2 text-[13px] font-medium text-muted">Team members</p>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {lookups.data?.members.map((m) => (
                <label key={m.id} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={f.member_ids.includes(m.id)} label={m.name} onChange={(on) => setF({ ...f, member_ids: on ? [...f.member_ids, m.id] : f.member_ids.filter((x) => x !== m.id) })} />
                  {m.name}
                </label>
              ))}
            </div>
          </div>
          <Field label="Description" htmlFor="pj-desc"><Textarea id="pj-desc" rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" loading={save.isPending}>{project ? "Save" : "Create project"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Project workspace
// ---------------------------------------------------------------------------

export function ProjectDetailPage() {
  const { id = "" } = useParams();
  const { can } = useAuth();
  const navigate = useNavigate();
  const project = useProject(id);
  const tasks = useTasks({ project_id: id });
  const [view, setView] = React.useState<"list" | "board">("list");
  const [editing, setEditing] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const remove = useDeleteProject();
  const dialog = useTaskDialog();

  if (project.isPending) return <Card className="p-6"><ListSkeleton rows={5} /></Card>;
  if (project.isError) return <Card><ErrorState error={project.error} onRetry={() => void project.refetch()} /></Card>;
  const p = project.data;
  const pct = p.total_tasks ? (p.done_tasks / p.total_tasks) * 100 : 0;

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-3"><Link to="/projects"><ArrowLeft /> Projects</Link></Button>
      <PageHeader
        title={p.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={STATUS_TONE[p.status]} dot>{humanize(p.status)}</Badge>
            {p.client_id ? <Link to={`/clients/record/${p.client_id}`} className="text-accent hover:underline">{p.client_name}</Link> : <span>Internal</span>}
            {p.deadline && <span className="text-subtle">· due {formatPlainDate(p.deadline, { month: "short", day: "numeric", year: "numeric" })}</span>}
          </span>
        }
        actions={
          <>
            <Button onClick={() => dialog.open(null, { project_id: p.id })}><Plus /> Add task</Button>
            {can("projects.manage") && <Button variant="secondary" onClick={() => setEditing(true)}><Pencil /> Edit</Button>}
            {can("projects.manage") && <Button variant="ghost" size="icon" aria-label="Delete project" onClick={() => setDeleting(true)}><Trash2 /></Button>}
          </>
        }
      />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Tabs value={view} onChange={setView} className="self-start" tabs={[{ value: "list", label: "List" }, { value: "board", label: "Board" }]} />
          {tasks.isError ? (
            <Card><ErrorState error={tasks.error} onRetry={() => void tasks.refetch()} /></Card>
          ) : tasks.isPending ? (
            <Card className="p-6"><ListSkeleton rows={5} /></Card>
          ) : tasks.data.length === 0 ? (
            <Card><EmptyState title="No tasks yet" action={<Button size="sm" onClick={() => dialog.open(null, { project_id: p.id })}><Plus /> Add task</Button>} /></Card>
          ) : view === "list" ? (
            <Card className="overflow-hidden"><TaskList tasks={tasks.data} onOpen={(tid) => dialog.open(tid)} showProject={false} /></Card>
          ) : (
            <TaskBoard tasks={tasks.data} onOpen={(tid) => dialog.open(tid)} />
          )}
          <Card><CardBody className="pt-5"><FilesPanel target={{ bucket: "documents", entity_type: "project", entity_id: p.id }} canEdit title="Project files" /></CardBody></Card>
        </div>
        <div className="flex flex-col gap-4 self-start">
          <Card>
            <CardBody className="pt-5">
              <div className="mb-1.5 flex justify-between text-sm"><span className="text-muted">Progress</span><span className="tabular-nums">{Math.round(pct)}%</span></div>
              <Progress value={pct} />
              <p className="mt-2 text-xs text-subtle">{p.done_tasks} of {p.total_tasks} tasks done{p.overdue_tasks > 0 && `, ${p.overdue_tasks} overdue`}</p>
              <dl className="mt-4 flex flex-col gap-2 border-t border-line pt-4 text-sm">
                <div className="flex justify-between"><dt className="text-subtle">Owner</dt><dd>{p.owner_name ?? "—"}</dd></div>
                <div className="flex justify-between"><dt className="text-subtle">Priority</dt><dd><PriorityBadge priority={p.priority} /></dd></div>
                <div className="flex justify-between"><dt className="text-subtle">Start</dt><dd>{p.start_date ? formatPlainDate(p.start_date, { month: "short", day: "numeric", year: "numeric" }) : "—"}</dd></div>
              </dl>
            </CardBody>
          </Card>
          {p.deliverables.length > 0 && (
            <Card>
              <CardHeader title="Deliverables" />
              <CardBody><ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm text-muted">{p.deliverables.map((d) => <li key={d}>{d}</li>)}</ul></CardBody>
            </Card>
          )}
          <Card>
            <CardHeader title="Team" />
            <CardBody>
              {p.members.length === 0 ? <p className="text-sm text-subtle">No members</p> : (
                <ul className="flex flex-col gap-2">{p.members.map((m) => <li key={m.id} className="flex items-center gap-2 text-sm"><Avatar name={m.name} className="size-7 text-[10px]" />{m.name}</li>)}</ul>
              )}
            </CardBody>
          </Card>
          {p.description && <Card><CardHeader title="About" /><CardBody><p className="whitespace-pre-wrap text-sm text-muted">{p.description}</p></CardBody></Card>}
        </div>
      </div>
      {dialog.node}
      <ProjectDialog open={editing} onOpenChange={setEditing} project={p} />
      <ConfirmDialog open={deleting} onOpenChange={setDeleting} title={`Delete ${p.name}?`} description="Its tasks are deleted too." onConfirm={() => remove.mutateAsync(p.id).then(() => navigate("/projects"))} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Task views
// ---------------------------------------------------------------------------

function TasksShell({ title, children, dialogDefaults }: { title: string; children: (open: (id: string | null, d?: { due_at?: string }) => void) => React.ReactNode; dialogDefaults?: { project_id?: string } }) {
  const dialog = useTaskDialog();
  return (
    <>
      <PageHeader title={title} actions={<Button onClick={() => dialog.open(null, dialogDefaults)}><Plus /> New task</Button>} />
      {children((id, d) => dialog.open(id, d))}
      {dialog.node}
    </>
  );
}

export function MyTasksPage() {
  const [status, setStatus] = React.useState("open");
  const tasks = useTasks({ assignee: "me", status: status === "all" ? undefined : status });
  const groups = groupTasks(tasks.data ?? []);
  return (
    <TasksShell title="My tasks">
      {(open) => (
        <>
          <Tabs className="mb-4" value={status} onChange={setStatus} tabs={[{ value: "open", label: "Open" }, { value: "done", label: "Done" }, { value: "all", label: "All" }]} />
          {tasks.isError ? <Card><ErrorState error={tasks.error} onRetry={() => void tasks.refetch()} /></Card>
            : tasks.isPending ? <Card className="p-6"><ListSkeleton rows={5} /></Card>
            : !tasks.data.length ? <Card><EmptyState title={status === "open" ? "You're all clear" : "No tasks"} /></Card>
            : status !== "open" ? <Card className="overflow-hidden"><TaskList tasks={tasks.data} onOpen={open} /></Card>
            : (
              <div className="flex flex-col gap-4">
                {groups.filter((g) => g.items.length).map((g) => (
                  <Card key={g.label} className="overflow-hidden">
                    <CardHeader title={g.label} description={`${g.items.length}`} className="pb-3" />
                    <TaskList tasks={g.items} onOpen={open} />
                  </Card>
                ))}
              </div>
            )}
        </>
      )}
    </TasksShell>
  );
}

function groupTasks(tasks: Task[]) {
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const week = new Date(end.getTime() + 6 * 86400_000);
  return [
    { label: "Overdue", items: tasks.filter((t) => t.overdue) },
    { label: "Today", items: tasks.filter((t) => !t.overdue && t.due_at && new Date(t.due_at) <= end) },
    { label: "This week", items: tasks.filter((t) => t.due_at && new Date(t.due_at) > end && new Date(t.due_at) <= week) },
    { label: "Later", items: tasks.filter((t) => t.due_at && new Date(t.due_at) > week) },
    { label: "No due date", items: tasks.filter((t) => !t.due_at) },
  ];
}

export function TeamTasksPage() {
  const tasks = useTasks({ status: "open" });
  const byPerson = new Map<string, Task[]>();
  for (const t of tasks.data ?? []) {
    const k = t.assignee_name ?? "Unassigned";
    byPerson.set(k, [...(byPerson.get(k) ?? []), t]);
  }
  return (
    <TasksShell title="Team tasks">
      {(open) =>
        tasks.isError ? <Card><ErrorState error={tasks.error} onRetry={() => void tasks.refetch()} /></Card>
        : tasks.isPending ? <Card className="p-6"><ListSkeleton rows={5} /></Card>
        : byPerson.size === 0 ? <Card><EmptyState title="No open tasks" /></Card>
        : (
          <div className="flex flex-col gap-4">
            {[...byPerson.entries()].sort((a, b) => b[1].length - a[1].length).map(([name, list]) => (
              <Card key={name} className="overflow-hidden">
                <CardHeader
                  title={<span className="flex items-center gap-2"><Avatar name={name} className="size-7 text-[10px]" />{name}</span>}
                  description={`${list.length} open${list.some((t) => t.overdue) ? `, ${list.filter((t) => t.overdue).length} overdue` : ""}`}
                  className="pb-3"
                />
                <TaskList tasks={list} onOpen={open} />
              </Card>
            ))}
          </div>
        )
      }
    </TasksShell>
  );
}

export function TaskBoardPage() {
  const lookups = useLookups();
  const [assignee, setAssignee] = React.useState("");
  const [projectId, setProjectId] = React.useState("");
  const projects = useProjects({ status: "current" });
  const tasks = useTasks({ assignee: assignee || undefined, project_id: projectId || undefined });
  return (
    <TasksShell title="Kanban board" dialogDefaults={{ project_id: projectId || undefined }}>
      {(open) => (
        <>
          <div className="mb-4 flex flex-wrap gap-2">
            <Select aria-label="Assignee" value={assignee} onChange={(e) => setAssignee(e.target.value)} className="w-auto min-w-44">
              <option value="">Everyone</option><option value="me">Me</option><option value="unassigned">Unassigned</option>
              {lookups.data?.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </Select>
            <Select aria-label="Project" value={projectId} onChange={(e) => setProjectId(e.target.value)} className="w-auto min-w-56">
              <option value="">All projects</option>
              {projects.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </div>
          {tasks.isError ? <Card><ErrorState error={tasks.error} onRetry={() => void tasks.refetch()} /></Card>
            : tasks.isPending ? <Card className="p-6"><ListSkeleton rows={5} /></Card>
            : <TaskBoard tasks={tasks.data.filter((t) => t.status !== "done" || (t.completed_at && Date.now() - new Date(t.completed_at).getTime() < 14 * 86400_000))} onOpen={open} />}
        </>
      )}
    </TasksShell>
  );
}

export function TaskCalendarPage() {
  const me = useMe();
  const today = todayIn(me.timezone);
  const [month, setMonth] = React.useState(() => monthKey(new Date(), me.timezone));
  const [mine, setMine] = React.useState(false);
  const range = monthRange(month);
  const tasks = useTasks({ due_from: range.from, due_to: range.to, assignee: mine ? "me" : undefined });
  const byDay = new Map<string, Task[]>();
  for (const t of tasks.data ?? []) {
    if (!t.due_at) continue;
    const k = dayKey(t.due_at, me.timezone);
    byDay.set(k, [...(byDay.get(k) ?? []), t]);
  }
  return (
    <TasksShell title="Calendar">
      {(open) => (
        <Card className="p-5">
          <Tabs className="mb-3" value={mine ? "mine" : "all"} onChange={(v) => setMine(v === "mine")} tabs={[{ value: "all", label: "Everyone" }, { value: "mine", label: "Mine" }]} />
          {tasks.isError ? <ErrorState error={tasks.error} onRetry={() => void tasks.refetch()} /> : (
            <MonthCalendar
              month={month}
              onMonth={setMonth}
              today={today}
              items={byDay}
              onDayClick={(day) => open(null, { due_at: `${day}T17:00` })}
              renderItem={(t: Task) => (
                <button
                  onClick={() => open(t.id)}
                  className={cn(
                    "w-full truncate rounded-md px-1.5 py-1 text-left text-[11px] transition-colors",
                    t.status === "done" ? "bg-success-soft text-success-fg line-through" : t.overdue ? "bg-danger-soft text-danger-fg" : "bg-accent-soft text-accent-fg hover:bg-accent/30",
                  )}
                  title={`${t.title}${t.assignee_name ? `, ${t.assignee_name}` : ""}`}
                >
                  {t.title}
                </button>
              )}
            />
          )}
        </Card>
      )}
    </TasksShell>
  );
}
