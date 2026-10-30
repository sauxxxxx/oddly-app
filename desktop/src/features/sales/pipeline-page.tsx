import { ArrowDown, ArrowUp, CalendarClock, Globe, KanbanSquare, Plus, Search, Settings2, Trash2 } from "lucide-react";
import * as React from "react";
import { useNavigate } from "react-router";

import { PageHeader } from "@/components/layout/app-shell";
import { EmptyState, ErrorState } from "@/components/states";
import { PriorityBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/misc";
import { useAuth, useMe } from "@/features/auth/auth-context";
import { useLookups } from "@/features/leads/api";
import { LeadFormDialog } from "@/features/leads/lead-form";
import { errorMessage } from "@/lib/api";
import { formatDate, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PipelineCard, PipelineColumn } from "@/types/sales";

import { useMoveLead, usePipeline, useStageMutations } from "./api";
import { ConvertDialog } from "./dialogs";

export function PipelinePage() {
  const { can } = useAuth();
  const [search, setSearch] = React.useState("");
  const [debounced, setDebounced] = React.useState("");
  const [market, setMarket] = React.useState("");
  const [assigned, setAssigned] = React.useState("");
  const [adding, setAdding] = React.useState(false);
  const [settings, setSettings] = React.useState(false);
  const [converting, setConverting] = React.useState<PipelineCard | null>(null);
  const lookups = useLookups();

  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const filters = { search: debounced || undefined, market: market || undefined, assigned: assigned || undefined };
  const board = usePipeline(filters);
  const move = useMoveLead();

  return (
    <>
      <PageHeader
        title="Sales pipeline"
        description="Drag leads between stages. Dropping on a won stage offers to convert the lead into a client."
        actions={
          <>
            {can("pipeline.manage") && (
              <Button variant="secondary" onClick={() => setSettings(true)}><Settings2 /> Stages</Button>
            )}
            {can("leads.create") && <Button onClick={() => setAdding(true)}><Plus /> Add lead</Button>}
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search the pipeline…" className="pl-9" aria-label="Search pipeline" />
        </div>
        <Select aria-label="Market" value={market} onChange={(e) => setMarket(e.target.value)} className="w-auto min-w-40">
          <option value="">All markets</option>
          <option value="local">Local</option>
          <option value="international">International</option>
        </Select>
        <Select aria-label="Owner" value={assigned} onChange={(e) => setAssigned(e.target.value)} className="w-auto min-w-40">
          <option value="">Everyone</option>
          <option value="me">Me</option>
          {lookups.data?.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </Select>
        {move.isError && <span className="text-sm text-danger">{errorMessage(move.error)}</span>}
      </div>

      {board.isError && !board.data ? (
        <Card><ErrorState error={board.error} onRetry={() => void board.refetch()} /></Card>
      ) : !board.data ? (
        <div className="flex gap-3 overflow-hidden">
          {Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-[60vh] w-72 shrink-0 rounded-card" />)}
        </div>
      ) : board.data.every((c) => c.count === 0) && !debounced && !market && !assigned ? (
        <Card>
          <EmptyState icon={KanbanSquare} title="The pipeline is empty" description="Add or import leads and they'll start in the first stage." />
        </Card>
      ) : (
        <Board
          columns={board.data}
          onMove={(card, stage) => {
            if (card.stage_id === stage.id) return;
            move.mutate({ id: card.id, stage_id: stage.id, filtersKey: filters });
            if (stage.kind === "won" && can("sales.manage")) setConverting(card);
          }}
        />
      )}

      <LeadFormDialog open={adding} onOpenChange={setAdding} />
      {settings && <StageSettings columns={board.data ?? []} onClose={() => setSettings(false)} />}
      {converting && (
        <ConvertDialog
          open
          onOpenChange={(o) => !o && setConverting(null)}
          leadId={converting.id}
          leadName={converting.business_name}
          defaultManager={converting.assigned_to}
        />
      )}
    </>
  );
}

function Board({ columns, onMove }: { columns: PipelineColumn[]; onMove: (card: PipelineCard, to: PipelineColumn) => void }) {
  const [dragging, setDragging] = React.useState<PipelineCard | null>(null);
  const [over, setOver] = React.useState<string | null>(null);

  return (
    <div className="-mx-7 overflow-x-auto px-7 pb-4">
      <div className="flex min-h-[60vh] gap-3">
        {columns.map((col) => (
          <section
            key={col.id}
            aria-label={col.name}
            onDragOver={(e) => {
              if (!dragging) return;
              e.preventDefault();
              setOver(col.id);
            }}
            onDragLeave={() => setOver((o) => (o === col.id ? null : o))}
            onDrop={(e) => {
              e.preventDefault();
              if (dragging) onMove(dragging, col);
              setDragging(null);
              setOver(null);
            }}
            className={cn(
              "flex w-[280px] shrink-0 flex-col rounded-card border bg-card/60 transition-colors",
              over === col.id ? "border-accent/60 bg-accent-soft/30" : "border-line",
            )}
          >
            <header className="border-b border-line px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="flex items-center gap-2 text-sm font-medium">
                  <span className="size-2.5 rounded-full" style={{ background: col.color }} />
                  {col.name}
                </h3>
                <span className="rounded-md bg-raised px-1.5 text-xs tabular-nums text-muted">{col.count}</span>
              </div>
              <p className="mt-1 truncate text-xs text-subtle">
                {Object.entries(col.totals).length
                  ? Object.entries(col.totals).map(([cur, v]) => formatMoney(v, cur, { compact: true })).join(" · ")
                  : "No estimated value"}
              </p>
            </header>
            <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-2" style={{ maxHeight: "calc(100vh - 300px)" }}>
              {col.cards.map((card) => (
                <PipelineCardView key={card.id} card={card} onDragStart={() => setDragging(card)} onDragEnd={() => { setDragging(null); setOver(null); }} />
              ))}
              {col.count > col.cards.length && (
                <p className="px-2 py-1 text-center text-xs text-subtle">+{col.count - col.cards.length} more — use search or the lead list</p>
              )}
              {col.count === 0 && <p className="px-2 py-6 text-center text-xs text-subtle">Drop leads here</p>}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function PipelineCardView({ card, onDragStart, onDragEnd }: { card: PipelineCard; onDragStart: () => void; onDragEnd: () => void }) {
  const me = useMe();
  const navigate = useNavigate();
  const overdue = card.status === "active" && card.next_action_due_at && new Date(card.next_action_due_at) < new Date();
  return (
    <article
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onClick={() => navigate(`/leads/record/${card.id}`)}
      className="cursor-grab rounded-xl border border-line bg-raised/70 p-3 transition-colors hover:border-line-strong active:cursor-grabbing"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium leading-snug">{card.business_name}</p>
        {card.market === "international" && <Globe className="mt-0.5 size-3.5 shrink-0 text-subtle" />}
      </div>
      <p className="mt-0.5 truncate text-xs text-subtle">{[card.contact_name, card.city].filter(Boolean).join(" · ") || "—"}</p>
      {card.next_action && (
        <p className={cn("mt-2 flex items-center gap-1.5 text-xs", overdue ? "text-[#fca5a5]" : "text-muted")}>
          <CalendarClock className="size-3 shrink-0" />
          <span className="truncate">{card.next_action}</span>
          {card.next_action_due_at && <span className="shrink-0 text-subtle">· {formatDate(card.next_action_due_at, me.timezone)}</span>}
        </p>
      )}
      <div className="mt-2.5 flex items-center justify-between gap-2">
        <PriorityBadge priority={card.priority} />
        <span className="truncate text-xs tabular-nums text-muted">
          {card.estimated_value ? formatMoney(card.estimated_value, card.currency, { compact: true }) : card.assigned_name ?? ""}
        </span>
      </div>
    </article>
  );
}

function StageSettings({ columns, onClose }: { columns: PipelineColumn[]; onClose: () => void }) {
  const { create, update, reorder, remove } = useStageMutations();
  const [stages, setStages] = React.useState(columns.map((c) => ({ id: c.id, name: c.name, kind: c.kind, color: c.color, count: c.count })));
  const [newName, setNewName] = React.useState("");
  const [removing, setRemoving] = React.useState<{ id: string; name: string } | null>(null);
  const [moveTo, setMoveTo] = React.useState("");
  const error = create.error ?? update.error ?? reorder.error ?? remove.error;

  React.useEffect(() => {
    setStages(columns.map((c) => ({ id: c.id, name: c.name, kind: c.kind, color: c.color, count: c.count })));
  }, [columns]);

  function shift(i: number, by: number) {
    const next = [...stages];
    const [s] = next.splice(i, 1);
    next.splice(i + by, 0, s!);
    setStages(next);
    reorder.mutate(next.map((x) => x.id));
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Pipeline stages" description="Rename, recolor and reorder stages. “Won” and “Lost” types drive reports and conversion." className="max-w-2xl">
        {error && <FormError error={error} />}
        <ul className="flex flex-col gap-2">
          {stages.map((s, i) => (
            <li key={s.id} className="flex items-center gap-2">
              <input
                type="color"
                aria-label={`Color for ${s.name}`}
                value={s.color}
                onChange={(e) => setStages(stages.map((x) => (x.id === s.id ? { ...x, color: e.target.value } : x)))}
                onBlur={() => update.mutate({ id: s.id, name: s.name, color: s.color.toUpperCase() })}
                className="size-9 cursor-pointer rounded-lg border border-line bg-raised p-1"
              />
              <Input
                aria-label="Stage name"
                value={s.name}
                onChange={(e) => setStages(stages.map((x) => (x.id === s.id ? { ...x, name: e.target.value } : x)))}
                onBlur={() => s.name.trim() && update.mutate({ id: s.id, name: s.name, kind: s.kind })}
              />
              <Select
                aria-label="Stage type"
                value={s.kind}
                onChange={(e) => {
                  const kind = e.target.value as typeof s.kind;
                  setStages(stages.map((x) => (x.id === s.id ? { ...x, kind } : x)));
                  update.mutate({ id: s.id, name: s.name, kind });
                }}
                className="w-32"
              >
                <option value="open">Open</option><option value="won">Won</option><option value="lost">Lost</option>
              </Select>
              <span className="w-12 text-right text-xs tabular-nums text-subtle">{s.count}</span>
              <Button variant="ghost" size="icon-sm" aria-label="Move up" disabled={i === 0} onClick={() => shift(i, -1)}><ArrowUp /></Button>
              <Button variant="ghost" size="icon-sm" aria-label="Move down" disabled={i === stages.length - 1} onClick={() => shift(i, 1)}><ArrowDown /></Button>
              <Button variant="ghost" size="icon-sm" aria-label={`Remove ${s.name}`} disabled={stages.length <= 1}
                onClick={() => { setRemoving({ id: s.id, name: s.name }); setMoveTo(stages.find((x) => x.id !== s.id)!.id); }}>
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
        <form
          className="mt-4 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (newName.trim()) create.mutate({ name: newName.trim() }, { onSuccess: () => setNewName("") });
          }}
        >
          <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New stage name" aria-label="New stage name" />
          <Button type="submit" variant="secondary" loading={create.isPending}><Plus /> Add stage</Button>
        </form>
        {removing && (
          <div className="mt-4 rounded-control border border-warning/30 bg-warning-soft p-4">
            <p className="text-sm">Remove “{removing.name}”? Its leads move to:</p>
            <div className="mt-3 flex gap-2">
              <Select aria-label="Move leads to" value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
                {stages.filter((x) => x.id !== removing.id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </Select>
              <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate({ id: removing.id, move_to: moveTo }, { onSuccess: () => setRemoving(null) })}>
                Remove
              </Button>
              <Button variant="ghost" onClick={() => setRemoving(null)}>Cancel</Button>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FormError({ error }: { error: unknown }) {
  return <p className="mb-3 text-sm text-danger">{errorMessage(error)}</p>;
}
