import { ArrowLeft, Archive, MoreHorizontal, Plus } from "lucide-react";
import * as React from "react";
import { Link, useNavigate, useParams } from "react-router";

import { PageHeader } from "@/components/layout/app-shell";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Checkbox, Textarea } from "@/components/ui/form-controls";
import { Field, Input, Select } from "@/components/ui/input";
import { Avatar, Progress } from "@/components/ui/misc";
import { FormAlert } from "@/features/auth/auth-layout";
import { useAuth } from "@/features/auth/auth-context";
import { ApiError, errorMessage } from "@/lib/api";
import { formatPercent } from "@/lib/format";
import type { LeadList } from "@/types/leads";

import { useDeleteLeadList, useLeadList, useLeadLists, useLookups, useSaveLeadList } from "./api";
import { LeadsPage } from "./leads-page";

const COLORS = ["#A855F7", "#D946EF", "#6366F1", "#3B82F6", "#14B8A6", "#22C55E", "#EAB308", "#F97316"];

export function LeadListsPage() {
  const lists = useLeadLists();
  const { can } = useAuth();
  const [editing, setEditing] = React.useState<LeadList | "new" | null>(null);

  const active = lists.data?.filter((l) => !l.archived_at) ?? [];
  const archived = lists.data?.filter((l) => l.archived_at) ?? [];

  return (
    <>
      <PageHeader
        title="Lead lists"
        actions={can("leads.create") && <Button onClick={() => setEditing("new")}><Plus /> New list</Button>}
      />
      {lists.isPending ? (
        <Card className="p-6"><ListSkeleton rows={4} /></Card>
      ) : lists.isError ? (
        <Card><ErrorState error={lists.error} onRetry={() => void lists.refetch()} /></Card>
      ) : lists.data.length === 0 ? (
        <Card>
          <EmptyState
            title="No lead lists yet"
            action={can("leads.create") && <Button size="sm" onClick={() => setEditing("new")}><Plus /> New list</Button>}
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-6">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
            {active.map((l) => <ListCard key={l.id} list={l} onEdit={() => setEditing(l)} />)}
          </div>
          {archived.length > 0 && (
            <div>
              <p className="mb-3 text-xs font-medium text-subtle">Archived</p>
              <div className="grid grid-cols-1 gap-4 opacity-70 lg:grid-cols-2 2xl:grid-cols-3">
                {archived.map((l) => <ListCard key={l.id} list={l} onEdit={() => setEditing(l)} />)}
              </div>
            </div>
          )}
        </div>
      )}
      <ListDialog list={editing === "new" ? undefined : (editing ?? undefined)} open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} />
    </>
  );
}

function ListCard({ list: l, onEdit }: { list: LeadList; onEdit: () => void }) {
  const { can } = useAuth();
  const navigate = useNavigate();
  const remove = useDeleteLeadList();
  const save = useSaveLeadList(l.id);
  const [confirm, setConfirm] = React.useState(false);
  const pct = l.total ? (l.contacted / l.total) * 100 : 0;

  return (
    <Card className="cursor-pointer gap-4 p-5 transition-colors hover:border-line-strong" onClick={() => navigate(`/leads/lists/${l.id}`)}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="size-3 shrink-0 rounded-full" style={{ background: l.color }} />
          <div className="min-w-0">
            <p className="truncate font-medium">{l.name}</p>
            <p className="truncate text-xs text-subtle">{l.description || (l.market ? (l.market === "local" ? "Local" : "International") : "Mixed markets")}</p>
          </div>
        </div>
        {can("leads.edit") && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
              <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${l.name}`}><MoreHorizontal /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
              <DropdownMenuItem onSelect={onEdit}>Edit</DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() =>
                  save.mutate({
                    name: l.name, description: l.description ?? undefined, market: l.market ?? undefined, color: l.color,
                    assignee_ids: l.assignees.map((a) => a.id), archived: !l.archived_at,
                  })
                }
              >
                <Archive /> {l.archived_at ? "Unarchive" : "Archive"}
              </DropdownMenuItem>
              {can("leads.delete") && <DropdownMenuItem destructive onSelect={() => setConfirm(true)}>Delete list</DropdownMenuItem>}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <div className="grid grid-cols-4 gap-2 text-center">
        {[["Leads", l.total], ["Contacted", l.contacted], ["Interested", l.interested], ["Won", l.won]].map(([k, v]) => (
          <div key={k as string}>
            <p className="text-lg font-semibold tabular-nums">{v}</p>
            <p className="text-[11px] text-subtle">{k}</p>
          </div>
        ))}
      </div>
      <div>
        <div className="mb-1.5 flex justify-between text-xs text-subtle">
          <span>Contacted</span>
          <span className="tabular-nums">{formatPercent(l.contacted, l.total)}</span>
        </div>
        <Progress value={pct} />
      </div>
      <div className="flex items-center justify-between">
        <div className="flex -space-x-2">
          {l.assignees.slice(0, 5).map((a) => <Avatar key={a.id} name={a.name} className="size-7 text-[10px]" />)}
          {l.assignees.length === 0 && <span className="text-xs text-subtle">No one assigned</span>}
        </div>
        {l.archived_at && <Badge>Archived</Badge>}
      </div>
      <div onClick={(e) => e.stopPropagation()}>
        <ConfirmDialog
          open={confirm}
          onOpenChange={setConfirm}
          title={`Delete “${l.name}”?`}
          description="Only the list is deleted. Its leads stay in ODDLY."
          onConfirm={() => remove.mutateAsync(l.id)}
        />
      </div>
    </Card>
  );
}

function ListDialog({ list, open, onOpenChange }: { list?: LeadList; open: boolean; onOpenChange: (o: boolean) => void }) {
  const lookups = useLookups();
  const save = useSaveLeadList(list?.id);
  const [form, setForm] = React.useState({ name: "", description: "", market: "", color: COLORS[0]!, assignee_ids: [] as string[] });
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  React.useEffect(() => {
    if (!open) return;
    setForm({
      name: list?.name ?? "",
      description: list?.description ?? "",
      market: list?.market ?? "",
      color: list?.color ?? COLORS[0]!,
      assignee_ids: list?.assignees.map((a) => a.id) ?? [],
    });
    setErrors({});
    save.reset();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps -- reset when opened

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={list ? "Edit list" : "New lead list"} className="max-w-lg">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!form.name.trim()) {
              setErrors({ name: "Give the list a name." });
              return;
            }
            save.mutate(
              { ...form, archived: list ? !!list.archived_at : false },
              { onSuccess: () => onOpenChange(false), onError: (err) => err instanceof ApiError && setErrors(err.fields) },
            );
          }}
        >
          {save.isError && !(save.error instanceof ApiError && save.error.code === "validation_failed") && <FormAlert>{errorMessage(save.error)}</FormAlert>}
          <Field label="Name" htmlFor="ll-name" error={errors.name}>
            <Input id="ll-name" autoFocus value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Cebu Resorts" />
          </Field>
          <Field label="Description" htmlFor="ll-desc">
            <Textarea id="ll-desc" rows={2} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Market" htmlFor="ll-market">
              <Select id="ll-market" value={form.market} onChange={(e) => setForm((f) => ({ ...f, market: e.target.value }))}>
                <option value="">Mixed</option>
                <option value="local">Local</option>
                <option value="international">International</option>
              </Select>
            </Field>
            <Field label="Color" htmlFor="ll-color">
              <div className="flex h-10 items-center gap-1.5" id="ll-color">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={`Color ${c}`}
                    onClick={() => setForm((f) => ({ ...f, color: c }))}
                    className="size-6 rounded-full ring-offset-2 ring-offset-overlay transition-shadow"
                    style={{ background: c, boxShadow: form.color === c ? `0 0 0 2px ${c}` : undefined }}
                  />
                ))}
              </div>
            </Field>
          </div>
          <div>
            <p className="mb-2 text-[13px] font-medium text-muted">Assigned team members</p>
            <p className="mb-2 text-xs text-subtle">They can see and work every lead in this list.</p>
            <div className="grid max-h-48 grid-cols-2 gap-2 overflow-y-auto">
              {lookups.data?.members.map((m) => {
                const on = form.assignee_ids.includes(m.id);
                return (
                  <label key={m.id} className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-raised">
                    <Checkbox
                      checked={on}
                      label={m.name}
                      onChange={(v) => setForm((f) => ({ ...f, assignee_ids: v ? [...f.assignee_ids, m.id] : f.assignee_ids.filter((id) => id !== m.id) }))}
                    />
                    {m.name}
                  </label>
                );
              })}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" loading={save.isPending}>{list ? "Save" : "Create list"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function LeadListDetailPage() {
  const { id = "" } = useParams();
  const list = useLeadList(id);
  if (list.isPending) return <Card className="p-6"><ListSkeleton rows={3} /></Card>;
  if (list.isError) return <Card><ErrorState error={list.error} onRetry={() => void list.refetch()} /></Card>;
  const l = list.data;
  return (
    <>
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-3">
        <Link to="/leads/lists"><ArrowLeft /> Lead lists</Link>
      </Button>
      <PageHeader
        title={<span className="flex items-center gap-3"><span className="size-3.5 rounded-full" style={{ background: l.color }} />{l.name}</span>}
        description={`${l.total} leads, ${l.contacted} contacted, ${l.interested} interested, ${l.won} won${l.assignees.length ? `, ${l.assignees.map((a) => a.name).join(", ")}` : ""}`}
      />
      <LeadsPage listId={l.id} embedded />
    </>
  );
}
