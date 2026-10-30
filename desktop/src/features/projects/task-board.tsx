import { CalendarClock, MessageSquare } from "lucide-react";
import * as React from "react";

import { PriorityBadge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/misc";
import { useMe } from "@/features/auth/auth-context";
import { useMoveTask } from "@/features/ops/api";
import { errorMessage } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Task, TaskStatus } from "@/types/ops";
import { TASK_STATUS_LABELS } from "@/types/ops";

const COLUMNS: { status: TaskStatus; color: string }[] = [
  { status: "todo", color: "#71717A" },
  { status: "in_progress", color: "#3B82F6" },
  { status: "in_review", color: "#A855F7" },
  { status: "blocked", color: "#EF4444" },
  { status: "done", color: "#22C55E" },
];

/** Kanban board for tasks; dropping a card sets its status and places it on top. */
export function TaskBoard({ tasks, onOpen }: { tasks: Task[]; onOpen: (id: string) => void }) {
  const me = useMe();
  const move = useMoveTask();
  const [dragging, setDragging] = React.useState<Task | null>(null);
  const [over, setOver] = React.useState<TaskStatus | null>(null);
  // Optimistic local copy so cards move instantly.
  const [local, setLocal] = React.useState(tasks);
  React.useEffect(() => setLocal(tasks), [tasks]);

  return (
    <div>
      {move.isError && <p className="mb-2 text-sm text-danger">{errorMessage(move.error)}</p>}
      <div className="-mx-7 overflow-x-auto px-7 pb-4">
        <div className="flex min-h-[55vh] gap-3">
          {COLUMNS.map((col) => {
            const cards = local.filter((t) => t.status === col.status).sort((a, b) => a.position - b.position);
            return (
              <section
                key={col.status}
                aria-label={TASK_STATUS_LABELS[col.status]}
                onDragOver={(e) => { if (dragging) { e.preventDefault(); setOver(col.status); } }}
                onDragLeave={() => setOver((o) => (o === col.status ? null : o))}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragging && dragging.status !== col.status) {
                    const top = cards.length ? cards[0]!.position - 1 : 0;
                    setLocal((l) => l.map((t) => (t.id === dragging.id ? { ...t, status: col.status, position: top } : t)));
                    move.mutate({ id: dragging.id, status: col.status, position: top }, { onError: () => setLocal(tasks) });
                  }
                  setDragging(null);
                  setOver(null);
                }}
                className={cn("flex w-[270px] shrink-0 flex-col rounded-card border bg-card/60 transition-colors", over === col.status ? "border-accent/60 bg-accent-soft/30" : "border-line")}
              >
                <header className="flex items-center justify-between border-b border-line px-4 py-3">
                  <h3 className="flex items-center gap-2 text-sm font-medium"><span className="size-2.5 rounded-full" style={{ background: col.color }} />{TASK_STATUS_LABELS[col.status]}</h3>
                  <span className="rounded-md bg-raised px-1.5 text-xs tabular-nums text-muted">{cards.length}</span>
                </header>
                <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-2" style={{ maxHeight: "calc(100vh - 300px)" }}>
                  {cards.map((t) => (
                    <article
                      key={t.id}
                      draggable
                      onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; setDragging(t); }}
                      onDragEnd={() => { setDragging(null); setOver(null); }}
                      onClick={() => onOpen(t.id)}
                      className="cursor-grab rounded-xl border border-line bg-raised/70 p-3 transition-colors hover:border-line-strong active:cursor-grabbing"
                    >
                      <p className="text-sm font-medium leading-snug">{t.title}</p>
                      <p className="mt-0.5 truncate text-xs text-subtle">{t.project_name ?? t.client_name ?? "No project"}</p>
                      <div className="mt-2.5 flex items-center justify-between gap-2">
                        <PriorityBadge priority={t.priority} />
                        <div className="flex items-center gap-2 text-xs text-subtle">
                          {t.comments > 0 && <span className="flex items-center gap-0.5"><MessageSquare className="size-3" />{t.comments}</span>}
                          {t.due_at && <span className={cn("flex items-center gap-0.5", t.overdue && "text-danger-fg")}><CalendarClock className="size-3" />{formatDate(t.due_at, me.timezone)}</span>}
                          {t.assignee_name && <Avatar name={t.assignee_name} className="size-6 text-[9px] ring-0" />}
                        </div>
                      </div>
                      {t.subtasks_total > 0 && (
                        <div className="mt-2 h-1 overflow-hidden rounded-full bg-line"><div className="h-full bg-accent" style={{ width: `${(t.subtasks_done / t.subtasks_total) * 100}%` }} /></div>
                      )}
                    </article>
                  ))}
                  {cards.length === 0 && <p className="px-2 py-6 text-center text-xs text-subtle">Drop tasks here</p>}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
