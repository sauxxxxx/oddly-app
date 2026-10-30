import { FileSignature, Pencil, Plus, Trash2 } from "lucide-react";
import * as React from "react";
import { Link } from "react-router";

import { FilesPanel } from "@/components/files-panel";
import { PageHeader } from "@/components/layout/app-shell";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/states";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Tabs, Textarea } from "@/components/ui/form-controls";
import { Field, Input, Select } from "@/components/ui/input";
import { useAuth } from "@/features/auth/auth-context";
import { FormAlert } from "@/features/auth/auth-layout";
import { CURRENCIES } from "@/features/leads/lead-form";
import { ApiError, errorMessage } from "@/lib/api";
import { formatMoney, formatPlainDate, humanize } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Contract } from "@/types/clients";

import { useContracts, useDeleteContract, useSaveContract } from "./api";

const TONE: Record<Contract["status"], BadgeTone> = {
  draft: "neutral",
  sent: "info",
  signed: "accent",
  active: "success",
  expired: "warning",
  terminated: "danger",
};

export function ContractsPage() {
  const [tab, setTab] = React.useState<"all" | "expiring" | "expired">("all");
  return (
    <>
      <PageHeader title="Contracts" description="Agreements with clients, their terms and signed documents." />
      <Tabs
        className="mb-4"
        value={tab}
        onChange={setTab}
        tabs={[{ value: "all", label: "All" }, { value: "expiring", label: "Ending in 30 days" }, { value: "expired", label: "Expired" }]}
      />
      <Card className="overflow-hidden">
        <ContractsTable key={tab} expiringDays={tab === "expiring" ? 30 : undefined} status={tab === "expired" ? "expired" : undefined} showClient />
      </Card>
    </>
  );
}

/** Contracts list, for one client or the whole agency. */
export function ContractsTable({ clientId, expiringDays, status, showClient }: { clientId?: string; expiringDays?: number; status?: string; showClient?: boolean }) {
  const { can } = useAuth();
  const contracts = useContracts({ client_id: clientId, expiring_days: expiringDays, status });
  const [editing, setEditing] = React.useState<Contract | "new" | null>(null);
  const [deleting, setDeleting] = React.useState<Contract | null>(null);
  const remove = useDeleteContract();

  return (
    <>
      {clientId && can("clients.manage") && (
        <div className="flex justify-end border-b border-line p-3">
          <Button size="sm" variant="secondary" onClick={() => setEditing("new")}><Plus /> Add contract</Button>
        </div>
      )}
      {contracts.isError ? (
        <ErrorState error={contracts.error} onRetry={() => void contracts.refetch()} />
      ) : contracts.isPending ? (
        <div className="p-6"><ListSkeleton rows={3} /></div>
      ) : contracts.data.length === 0 ? (
        <EmptyState icon={FileSignature} title="No contracts" description={clientId ? "Record the agreement and attach the signed document." : "Contracts are added from each client's page."} />
      ) : (
        <ul className="divide-y divide-line/60">
          {contracts.data.map((k) => {
            const ending = k.days_left !== null && k.days_left >= 0 && k.days_left <= 30 && (k.status === "signed" || k.status === "active");
            return (
              <li key={k.id} className="group flex items-center gap-4 px-5 py-3.5">
                <FileSignature className="size-4 shrink-0 text-subtle" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{k.title}</p>
                  <p className="truncate text-xs text-subtle">
                    {showClient && <><Link to={`/clients/record/${k.client_id}`} className="text-accent hover:underline">{k.client_name}</Link> · </>}
                    {k.start_date ? formatPlainDate(k.start_date, { month: "short", day: "numeric", year: "numeric" }) : "No start"} – {k.end_date ? formatPlainDate(k.end_date, { month: "short", day: "numeric", year: "numeric" }) : "open-ended"}
                    {k.billing_cycle && ` · ${humanize(k.billing_cycle)}`}
                    {` · ${k.documents} document${k.documents === 1 ? "" : "s"}`}
                  </p>
                </div>
                {ending && <span className={cn("text-xs", k.days_left! <= 7 ? "text-danger-fg" : "text-warning-fg")}>Ends in {k.days_left} day{k.days_left === 1 ? "" : "s"}</span>}
                <span className="text-sm tabular-nums text-muted">{k.value ? formatMoney(k.value, k.currency) : "—"}</span>
                <Badge tone={TONE[k.status]} dot>{humanize(k.status)}</Badge>
                {can("clients.manage") && (
                  <div className="flex opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                    <Button variant="ghost" size="icon-sm" aria-label={`Edit ${k.title}`} onClick={() => setEditing(k)}><Pencil /></Button>
                    <Button variant="ghost" size="icon-sm" aria-label={`Delete ${k.title}`} onClick={() => setDeleting(k)}><Trash2 /></Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {editing && (
        <ContractDialog
          clientId={editing === "new" ? clientId! : editing.client_id}
          contract={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
      <ConfirmDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)} title="Delete this contract?" description={deleting?.title ?? ""} onConfirm={() => remove.mutateAsync(deleting!.id)} />
    </>
  );
}

function ContractDialog({ clientId, contract, onClose }: { clientId: string; contract?: Contract; onClose: () => void }) {
  const { can } = useAuth();
  const save = useSaveContract(clientId, contract?.id);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [f, setF] = React.useState({
    title: contract?.title ?? "",
    status: contract?.status === "expired" ? "active" : contract?.status ?? "draft",
    start_date: contract?.start_date ?? "",
    end_date: contract?.end_date ?? "",
    value: contract?.value ? String(Number(contract.value)) : "",
    currency: contract?.currency ?? "PHP",
    billing_cycle: contract?.billing_cycle ?? "",
    notes: contract?.notes ?? "",
  });
  const [savedId, setSavedId] = React.useState(contract?.id ?? null);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={contract ? "Contract" : "Add a contract"} className="max-h-[calc(100vh-4rem)] max-w-xl overflow-y-auto">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!f.title.trim()) return setErrors({ title: "Name the contract." });
            save.mutate(
              { ...f, title: f.title.trim(), start_date: f.start_date || null, end_date: f.end_date || null, value: f.value || null, billing_cycle: f.billing_cycle || null, notes: f.notes || null },
              {
                onSuccess: (k) => (contract ? onClose() : setSavedId(k.id)),
                onError: (err) => err instanceof ApiError && setErrors(err.fields),
              },
            );
          }}
        >
          {save.isError && !(save.error instanceof ApiError && save.error.code === "validation_failed") && <FormAlert>{errorMessage(save.error)}</FormAlert>}
          <Field label="Title" htmlFor="k-title" error={errors.title}><Input id="k-title" autoFocus value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Social media retainer 2026" /></Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Status" htmlFor="k-status">
              <Select id="k-status" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as typeof f.status })}>
                {["draft", "sent", "signed", "active", "terminated"].map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
              </Select>
            </Field>
            <Field label="Billing cycle" htmlFor="k-cycle">
              <Select id="k-cycle" value={f.billing_cycle} onChange={(e) => setF({ ...f, billing_cycle: e.target.value })}>
                <option value="">—</option><option value="one_time">One-time</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="yearly">Yearly</option>
              </Select>
            </Field>
            <Field label="Start" htmlFor="k-start"><Input id="k-start" type="date" value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value })} /></Field>
            <Field label="End" htmlFor="k-end" error={errors.end_date}><Input id="k-end" type="date" value={f.end_date} onChange={(e) => setF({ ...f, end_date: e.target.value })} /></Field>
            <Field label="Value" htmlFor="k-value" error={errors.value}><Input id="k-value" inputMode="decimal" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} /></Field>
            <Field label="Currency" htmlFor="k-cur"><Select id="k-cur" value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
          </div>
          <Field label="Notes" htmlFor="k-notes"><Textarea id="k-notes" rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
          {savedId ? (
            <div className="rounded-control border border-line p-4">
              <FilesPanel target={{ bucket: "documents", entity_type: "contract", entity_id: savedId, category: "contract" }} canEdit={can("clients.manage")} title="Signed documents" />
            </div>
          ) : (
            <p className="text-xs text-subtle">Save the contract to attach the signed document.</p>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>{savedId && !contract ? "Done" : "Cancel"}</Button>
            {!(savedId && !contract) && <Button type="submit" loading={save.isPending}>Save</Button>}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
