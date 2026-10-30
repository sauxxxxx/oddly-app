import { CalendarClock, Check, MessageSquare, Plus, Trash2 } from "lucide-react";
import * as React from "react";

import { FilesPanel } from "@/components/files-panel";
import { ListSkeleton } from "@/components/states";
import { PriorityBadge, type BadgeTone } from "@/components/ui/badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Checkbox, Textarea } from "@/components/ui/form-controls";
import { Field, Input, Select } from "@/components/ui/input";
import { Avatar } from "@/components/ui/misc";
import { useAuth, useMe } from "@/features/auth/auth-context";
import { FormAlert } from "@/features/auth/auth-layout";
import { useLookups } from "@/features/leads/api";
import { useDeleteTask, useProjects, useSaveTask, useTask, useTaskParts } from "@/features/ops/api";
import { ApiError, errorMessage } from "@/lib/api";
import { fromLocalInput, toLocalInput } from "@/lib/dates";
import { formatDate, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Task, TaskStatus } from "@/types/ops";
import { TASK_STATUS_LABELS } from "@/types/ops";

export const TASK_TONE: Record<TaskStatus, BadgeTone> = { todo: "neutral", in_progress: "info", in_review: "accent", blocked: "danger", done: "success" };

/** Create a task, or open one to edit it with its subtasks, comments and files. */
export function TaskDialog({
  taskId,
  open,
  onOpenChange,
  defaults,
}: {
  taskId?: string | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  defaults?: { project_id?: string; client_id?: string; due_at?: string };
}) {
  const me = useMe();
  const { can } = useAuth();
  const lookups = useLookups();
  const projects = useProjects({ status: "current" });
  const task = useTask(open ? taskId ?? null : null);
  const save = useSaveTask(taskId ?? undefined);
  const remove = useDeleteTask();
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [deleting, setDeleting] = React.useState(false);
  const init = (t?: Task) => ({
    title: t?.title ?? "",
    description: t?.description ?? "",
    status: t?.status ?? ("todo" as TaskStatus),
    priority: t?.priority ?? "medium",
    assignee_id: t ? t.assignee_id ?? "" : me.id,
    due_at: t ? toLocalInput(t.due_at) : defaults?.due_at ?? "",
    project_id: t ? t.project_id ?? "" : defaults?.project_id ?? "",
  });
  const [f, setF] = React.useState(() => init());
  React.useEffect(() => {
    if (open && !taskId) setF(init());
    if (open) {
      setErrors({});
      save.reset();
    }
  }, [open, taskId]); // eslint-disable-line react-hooks/exhaustive-deps -- reset when opened
  React.useEffect(() => {
    if (task.data) setF(init(task.data));
  }, [task.data?.id]); // eslint-disable-line react-hooks/exhaustive-deps -- load once per task

  const editable = !task.data || can("projects.manage") || task.data.assignee_id === me.id || task.data.reporter_id === me.id;
  const canAssignOthers = can("projects.manage");

  function submit() {
    if (!f.title.trim()) return setErrors({ title: "Name the task." });
    save.mutate(
      {
        title: f.title.trim(),
        description: f.description || null,
        status: f.status,
        priority: f.priority,
        assignee_id: f.assignee_id || null,
        due_at: fromLocalInput(f.due_at),
        project_id: f.project_id || null,
        client_id: task.data?.client_id && !task.data.project_id ? task.data.client_id : defaults?.client_id ?? null,
      },
      { onSuccess: () => !taskId && onOpenChange(false), onError: (e) => e instanceof ApiError && setErrors(e.fields) },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={taskId ? (task.data?.title ?? "Task") : "New task"}
        description={task.data ? [task.data.project_name, task.data.client_name].filter(Boolean).join(" · ") || "No project" : undefined}
        className="max-h-[calc(100vh-4rem)] max-w-3xl overflow-y-auto"
      >
        {taskId && task.isPending ? (
          <ListSkeleton rows={4} />
        ) : (
          <div className="flex flex-col gap-5">
            {save.isError && !(save.error instanceof ApiError && save.error.code === "validation_failed") && <FormAlert>{errorMessage(save.error)}</FormAlert>}
            <form className="grid grid-cols-2 gap-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
              <Field label="Title" htmlFor="tk-title" error={errors.title} className="col-span-2">
                <Input id="tk-title" autoFocus={!taskId} disabled={!editable} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
              </Field>
              <Field label="Status" htmlFor="tk-status">
                <Select id="tk-status" disabled={!editable} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as TaskStatus })}>
                  {(Object.keys(TASK_STATUS_LABELS) as TaskStatus[]).map((s) => <option key={s} value={s}>{TASK_STATUS_LABELS[s]}</option>)}
                </Select>
              </Field>
              <Field label="Priority" htmlFor="tk-prio">
                <Select id="tk-prio" disabled={!editable} value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value as typeof f.priority })}>
                  <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option>
                </Select>
              </Field>
              <Field label="Assignee" htmlFor="tk-assignee" hint={canAssignOthers ? undefined : "Only project managers assign tasks to others."}>
                <Select id="tk-assignee" disabled={!editable} value={f.assignee_id} onChange={(e) => setF({ ...f, assignee_id: e.target.value })}>
                  <option value="">Unassigned</option>
                  {lookups.data?.members.filter((m) => canAssignOthers || m.id === me.id || m.id === f.assignee_id).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </Select>
              </Field>
              <Field label="Due" htmlFor="tk-due">
                <Input id="tk-due" type="datetime-local" disabled={!editable} value={f.due_at} onChange={(e) => setF({ ...f, due_at: e.target.value })} />
              </Field>
              <Field label="Project" htmlFor="tk-project" className="col-span-2">
                <Select id="tk-project" disabled={!editable} value={f.project_id} onChange={(e) => setF({ ...f, project_id: e.target.value })}>
                  <option value="">No project</option>
                  {projects.data?.map((p) => <option key={p.id} value={p.id}>{p.name}{p.client_name ? ` · ${p.client_name}` : ""}</option>)}
                </Select>
              </Field>
              <Field label="Description" htmlFor="tk-desc" className="col-span-2">
                <Textarea id="tk-desc" rows={3} disabled={!editable} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
              </Field>
              {editable && (
                <div className="col-span-2 flex justify-end gap-2">
                  {taskId && <Button type="button" variant="ghost" className="mr-auto text-[#fca5a5]" onClick={() => setDeleting(true)}><Trash2 /> Delete</Button>}
                  <Button type="submit" loading={save.isPending}>{taskId ? "Save" : "Create task"}</Button>
                </div>
              )}
            </form>
            {task.data && <TaskParts taskId={task.data.id} editable={editable} />}
          </div>
        )}
        {!taskId && <DialogFooter className="hidden" />}
        <ConfirmDialog
          open={deleting}
          onOpenChange={setDeleting}
          title="Delete this task?"
          description={task.data?.title ?? ""}
          onConfirm={() => remove.mutateAsync(taskId!).then(() => onOpenChange(false))}
        />
      </DialogContent>
    </Dialog>
  );
}

function TaskParts({ taskId, editable }: { taskId: string; editable: boolean }) {
  const me = useMe();
  const { can } = useAuth();
  const task = useTask(taskId);
  const parts = useTaskParts(taskId);
  const [newSub, setNewSub] = React.useState("");
  const [comment, setComment] = React.useState("");
  const t = task.data!;
  const error = parts.addSubtask.error ?? parts.toggleSubtask.error ?? parts.addComment.error ?? parts.removeComment.error;

  return (
    <div className="flex flex-col gap-5 border-t border-line pt-5">
      {error && <FormAlert>{errorMessage(error)}</FormAlert>}
      <section>
        <p className="mb-2 text-sm font-medium">Subtasks {t.subtasks.length > 0 && <span className="text-subtle">· {t.subtasks_done}/{t.subtasks_total}</span>}</p>
        <ul className="flex flex-col gap-1.5">
          {t.subtasks.map((s) => (
            <li key={s.id} className="group flex items-center gap-2.5 text-sm">
              <Checkbox checked={s.is_done} disabled={!editable} label={s.title} onChange={(v) => parts.toggleSubtask.mutate({ sub: s.id, is_done: v })} />
              <span className={cn("flex-1", s.is_done && "text-subtle line-through")}>{s.title}</span>
              {editable && (
                <Button variant="ghost" size="icon-sm" className="opacity-0 group-hover:opacity-100 focus:opacity-100" aria-label="Remove subtask" onClick={() => parts.removeSubtask.mutate(s.id)}><Trash2 /></Button>
              )}
            </li>
          ))}
        </ul>
        {editable && (
          <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (newSub.trim()) parts.addSubtask.mutate(newSub.trim(), { onSuccess: () => setNewSub("") }); }}>
            <Input value={newSub} onChange={(e) => setNewSub(e.target.value)} placeholder="Add a subtask" aria-label="New subtask" className="h-9" />
            <Button type="submit" variant="secondary" size="sm" loading={parts.addSubtask.isPending}><Plus /> Add</Button>
          </form>
        )}
      </section>

      <section>
        <p className="mb-2 flex items-center gap-1.5 text-sm font-medium"><MessageSquare className="size-4 text-subtle" /> Comments</p>
        <ul className="flex flex-col gap-3">
          {t.comment_list.map((c) => (
            <li key={c.id} className="group flex gap-2.5">
              <Avatar name={c.author_name ?? "?"} className="size-7 text-[10px]" />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-subtle">{c.author_name} · {formatRelative(c.created_at)}</p>
                <p className="whitespace-pre-wrap text-sm">{c.body}</p>
              </div>
              {(c.author_id === me.id || can("projects.manage")) && (
                <Button variant="ghost" size="icon-sm" className="opacity-0 group-hover:opacity-100 focus:opacity-100" aria-label="Delete comment" onClick={() => parts.removeComment.mutate(c.id)}><Trash2 /></Button>
              )}
            </li>
          ))}
          {t.comment_list.length === 0 && <li className="text-sm text-subtle">No comments yet.</li>}
        </ul>
        <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (comment.trim()) parts.addComment.mutate(comment.trim(), { onSuccess: () => setComment("") }); }}>
          <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} placeholder="Write a comment — the assignee is notified" aria-label="New comment" />
          <Button type="submit" variant="secondary" loading={parts.addComment.isPending} className="self-end">Post</Button>
        </form>
      </section>

      <section className="rounded-control border border-line p-4">
        <FilesPanel target={{ bucket: "documents", entity_type: "task", entity_id: t.id }} canEdit title="Attachments" />
      </section>
    </div>
  );
}

/** Compact task rows (my tasks, project lists, client tabs). */
export function TaskList({ tasks, onOpen, showProject = true }: { tasks: Task[]; onOpen: (id: string) => void; showProject?: boolean }) {
  const me = useMe();
  return (
    <ul className="divide-y divide-line/60">
      {tasks.map((t) => (
        <li key={t.id}>
          <button onClick={() => onOpen(t.id)} className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-raised/40">
            <span className={cn("flex size-5 shrink-0 items-center justify-center rounded-full border", t.status === "done" ? "border-success bg-success-soft text-success" : "border-line-strong")}>
              {t.status === "done" && <Check className="size-3" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className={cn("truncate text-sm", t.status === "done" ? "text-subtle line-through" : "font-medium")}>{t.title}</p>
              <p className="truncate text-xs text-subtle">
                {showProject && (t.project_name ?? t.client_name ?? "No project")}
                {t.subtasks_total > 0 && ` · ${t.subtasks_done}/${t.subtasks_total} subtasks`}
                {t.comments > 0 && ` · ${t.comments} comment${t.comments === 1 ? "" : "s"}`}
              </p>
            </div>
            {t.due_at && (
              <span className={cn("flex items-center gap-1 whitespace-nowrap text-xs", t.overdue ? "text-[#fca5a5]" : "text-subtle")}>
                <CalendarClock className="size-3" /> {formatDate(t.due_at, me.timezone)}
              </span>
            )}
            <span className="w-24 truncate text-right text-xs text-muted">{t.assignee_name ?? "Unassigned"}</span>
            <PriorityBadge priority={t.priority} />
            <Badge tone={TASK_TONE[t.status]}>{TASK_STATUS_LABELS[t.status]}</Badge>
          </button>
        </li>
      ))}
    </ul>
  );
}
