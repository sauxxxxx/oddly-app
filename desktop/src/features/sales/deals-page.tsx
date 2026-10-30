import { Handshake, MoreHorizontal, Pencil, RotateCcw, Search, ThumbsDown, Trash2, Trophy, UserPlus } from "lucide-react";
import * as React from "react";
import { Link, useNavigate } from "react-router";

import { PageHeader } from "@/components/layout/app-shell";
import { EmptyState, ErrorState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DataTable, Pagination, type Column } from "@/components/ui/data-table";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tabs } from "@/components/ui/form-controls";
import { Field, Input } from "@/components/ui/input";
import { useAuth, useMe } from "@/features/auth/auth-context";
import { errorMessage } from "@/lib/api";
import { formatDate, formatMoney, formatPlainDate } from "@/lib/format";
import type { Deal } from "@/types/sales";

import { useCloseDeal, useDeals, useDeleteDeal } from "./api";
import { ConvertDialog, DealDialog } from "./dialogs";

const STATUS_TONE = { open: "info", won: "success", lost: "danger" } as const;

export function DealsPage() {
  const me = useMe();
  const navigate = useNavigate();
  const [status, setStatus] = React.useState<"open" | "won" | "lost" | "">("open");
  const [search, setSearch] = React.useState("");
  const [debounced, setDebounced] = React.useState("");
  const [page, setPage] = React.useState(1);
  React.useEffect(() => {
    const t = setTimeout(() => { setDebounced(search); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [search]);
  const deals = useDeals({ status: status || undefined, search: debounced || undefined, page });

  const columns: Column<Deal>[] = [
    {
      key: "deal",
      header: "Deal",
      cell: (d) => (
        <div className="min-w-0 max-w-[300px]">
          <p className="truncate font-medium">{d.title}</p>
          <p className="truncate text-xs text-subtle">{d.company_name}</p>
        </div>
      ),
    },
    { key: "value", header: "Value", headerClassName: "text-right", className: "text-right tabular-nums", cell: (d) => formatMoney(d.value, d.currency) },
    { key: "status", header: "Status", cell: (d) => <Badge tone={STATUS_TONE[d.status]} dot>{d.status}</Badge> },
    { key: "owner", header: "Owner", cell: (d) => <span className="text-[13px] text-muted">{d.owner_name ?? "—"}</span> },
    {
      key: "date",
      header: "Close",
      cell: (d) => (
        <span className="text-[13px] text-muted">
          {d.won_at ? `Won ${formatDate(d.won_at, me.timezone)}` : d.lost_at ? `Lost ${formatDate(d.lost_at, me.timezone)}` : d.expected_close_date ? `Expected ${formatPlainDate(d.expected_close_date)}` : "—"}
        </span>
      ),
    },
    { key: "proposals", header: "Proposals", cell: (d) => <span className="text-[13px] text-muted">{d.proposals || "—"}</span> },
    { key: "actions", header: "", className: "w-12", cell: (d) => <DealActions deal={d} /> },
  ];

  return (
    <>
      <PageHeader title="Deals" description="Priced opportunities. Revenue figures come from won deals, per currency." />
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-4">
          <Tabs
            value={status}
            onChange={(v) => { setStatus(v); setPage(1); }}
            tabs={[{ value: "open", label: "Open" }, { value: "won", label: "Won" }, { value: "lost", label: "Lost" }, { value: "", label: "All" }]}
          />
          <div className="relative min-w-60 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search deals or businesses…" className="pl-9" aria-label="Search deals" />
          </div>
        </div>
        {deals.isError ? (
          <ErrorState error={deals.error} onRetry={() => void deals.refetch()} />
        ) : deals.data?.total === 0 ? (
          <EmptyState icon={Handshake} title="No deals here" description="Open a deal from a lead once there's a price on the table." />
        ) : (
          <>
            <DataTable columns={columns} rows={deals.data?.items ?? []} loading={deals.isPending} onRowClick={(d) => d.lead_id && navigate(`/leads/record/${d.lead_id}`)} />
            {deals.data && <Pagination page={deals.data.page} perPage={deals.data.per_page} total={deals.data.total} onPage={setPage} />}
          </>
        )}
      </Card>
    </>
  );
}

export function DealActions({ deal: d }: { deal: Deal }) {
  const { can } = useAuth();
  const close = useCloseDeal();
  const remove = useDeleteDeal();
  const [editing, setEditing] = React.useState(false);
  const [losing, setLosing] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [converting, setConverting] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  if (!can("sales.manage")) return null;

  return (
    <div onClick={(e) => e.stopPropagation()}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${d.title}`}><MoreHorizontal /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setEditing(true)}><Pencil /> Edit</DropdownMenuItem>
          {d.status === "open" && <DropdownMenuItem onSelect={() => close.mutate({ id: d.id, status: "won" })}><Trophy /> Mark won</DropdownMenuItem>}
          {d.status === "open" && <DropdownMenuItem onSelect={() => setLosing(true)}><ThumbsDown /> Mark lost</DropdownMenuItem>}
          {d.status !== "open" && <DropdownMenuItem onSelect={() => close.mutate({ id: d.id, status: "open" })}><RotateCcw /> Reopen</DropdownMenuItem>}
          {d.status === "won" && d.lead_id && !d.client_id && <DropdownMenuItem onSelect={() => setConverting(true)}><UserPlus /> Convert to client</DropdownMenuItem>}
          {d.client_id && <DropdownMenuItem asChild><Link to={`/clients/record/${d.client_id}`}><UserPlus /> Open client</Link></DropdownMenuItem>}
          <DropdownMenuSeparator />
          <DropdownMenuItem destructive onSelect={() => setDeleting(true)}><Trash2 /> Delete</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {close.isError && <p className="text-xs text-danger">{errorMessage(close.error)}</p>}
      <DealDialog open={editing} onOpenChange={setEditing} deal={d} />
      <Dialog open={losing} onOpenChange={setLosing}>
        <DialogContent title="Mark deal lost" description={d.title} className="max-w-md">
          <Field label="Why was it lost?" htmlFor="lost-reason">
            <Input id="lost-reason" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Chose a cheaper freelancer" />
          </Field>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setLosing(false)}>Cancel</Button>
            <Button variant="danger" loading={close.isPending} onClick={() => close.mutate({ id: d.id, status: "lost", lost_reason: reason || null }, { onSuccess: () => setLosing(false) })}>Mark lost</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {d.lead_id && (
        <ConvertDialog
          open={converting}
          onOpenChange={setConverting}
          leadId={d.lead_id}
          leadName={d.company_name}
          dealId={d.id}
          presetServices={[{ name: d.title, price: d.value, currency: d.currency, billing_type: "monthly" }]}
        />
      )}
      <ConfirmDialog open={deleting} onOpenChange={setDeleting} title="Delete this deal?" description={`${d.title} · ${formatMoney(d.value, d.currency)}`} onConfirm={() => remove.mutateAsync(d.id)} />
    </div>
  );
}
