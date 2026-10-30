import { FilePlus2, FileText, LayoutTemplate, Search } from "lucide-react";
import * as React from "react";
import { useNavigate } from "react-router";

import { PageHeader } from "@/components/layout/app-shell";
import { EmptyState, ErrorState } from "@/components/states";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataTable, Pagination, type Column } from "@/components/ui/data-table";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Tabs } from "@/components/ui/form-controls";
import { Field, Input, Select } from "@/components/ui/input";
import { useAuth } from "@/features/auth/auth-context";
import { FormAlert } from "@/features/auth/auth-layout";
import { useLeads } from "@/features/leads/api";
import { errorMessage } from "@/lib/api";
import { formatMoney, formatPlainDate, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ProposalStatus, ProposalSummary } from "@/types/sales";

import { useCreateProposal, useProposals } from "./api";

export const PROPOSAL_TONE: Record<ProposalStatus, BadgeTone> = {
  draft: "neutral",
  ready: "info",
  sent: "accent",
  accepted: "success",
  rejected: "danger",
  expired: "warning",
};

export const PROPOSAL_LABEL: Record<ProposalStatus, string> = {
  draft: "Draft",
  ready: "Ready to send",
  sent: "Sent",
  accepted: "Accepted",
  rejected: "Rejected",
  expired: "Expired",
};

type TabValue = ProposalStatus | "" | "templates";

export function ProposalsPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = React.useState<TabValue>("");
  const [search, setSearch] = React.useState("");
  const [debounced, setDebounced] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [creating, setCreating] = React.useState<"proposal" | "template" | null>(null);
  React.useEffect(() => {
    const t = setTimeout(() => { setDebounced(search); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const templates = tab === "templates";
  const data = useProposals({ status: templates ? undefined : tab || undefined, templates, search: debounced || undefined, page });

  const columns: Column<ProposalSummary>[] = [
    {
      key: "title",
      header: templates ? "Template" : "Proposal",
      cell: (p) => (
        <div className="min-w-0 max-w-[340px]">
          <p className="truncate font-medium">{p.title}</p>
          <p className="truncate text-xs text-subtle">{templates ? "Reusable template" : `${p.number} · ${p.company_name ?? ""}`}</p>
        </div>
      ),
    },
    ...(!templates
      ? [{ key: "status", header: "Status", cell: (p: ProposalSummary) => <Badge tone={PROPOSAL_TONE[p.status]} dot>{PROPOSAL_LABEL[p.status]}</Badge> }]
      : []),
    { key: "total", header: "Total", headerClassName: "text-right", className: "text-right tabular-nums", cell: (p) => formatMoney(p.total, p.currency) },
    ...(!templates
      ? [{ key: "valid", header: "Valid until", cell: (p: ProposalSummary) => <span className="text-[13px] text-muted">{p.valid_until ? formatPlainDate(p.valid_until, { month: "short", day: "numeric", year: "numeric" }) : "—"}</span> }]
      : []),
    { key: "by", header: "By", cell: (p) => <span className="text-[13px] text-muted">{p.created_by_name ?? "—"}</span> },
    { key: "updated", header: "Updated", cell: (p) => <span className="text-[13px] text-subtle">{formatRelative(p.updated_at)}</span> },
  ];

  return (
    <>
      <PageHeader
        title="Proposals"
        description="Build priced proposals, export PDFs, and track them from draft to accepted."
        actions={
          can("proposals.manage") && (
            <>
              <Button variant="secondary" onClick={() => setCreating("template")}><LayoutTemplate /> New template</Button>
              <Button onClick={() => setCreating("proposal")}><FilePlus2 /> New proposal</Button>
            </>
          )
        }
      />
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-4">
          <Tabs
            value={tab}
            onChange={(v) => { setTab(v); setPage(1); }}
            tabs={[
              { value: "", label: "All" },
              { value: "draft", label: "Drafts" },
              { value: "sent", label: "Sent" },
              { value: "accepted", label: "Accepted" },
              { value: "rejected", label: "Rejected" },
              { value: "expired", label: "Expired" },
              { value: "templates", label: "Templates" },
            ]}
          />
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search title, number, business…" className="pl-9" aria-label="Search proposals" />
          </div>
        </div>
        {data.isError ? (
          <ErrorState error={data.error} onRetry={() => void data.refetch()} />
        ) : data.data?.total === 0 ? (
          <EmptyState
            icon={templates ? LayoutTemplate : FileText}
            title={templates ? "No templates yet" : "No proposals here"}
            description={templates ? "Save a finished proposal as a template, or create one from scratch." : "Start one from a lead, or with “New proposal”."}
          />
        ) : (
          <>
            <DataTable columns={columns} rows={data.data?.items ?? []} loading={data.isPending} onRowClick={(p) => navigate(`/sales/proposals/${p.id}`)} />
            {data.data && <Pagination page={data.data.page} perPage={data.data.per_page} total={data.data.total} onPage={setPage} />}
          </>
        )}
      </Card>
      <NewProposalDialog mode={creating} onClose={() => setCreating(null)} />
    </>
  );
}

/** Pick the lead (and optionally a template), then open the builder. */
export function NewProposalDialog({
  mode,
  onClose,
  leadId,
  dealId,
}: {
  mode: "proposal" | "template" | null;
  onClose: () => void;
  leadId?: string;
  dealId?: string;
}) {
  const navigate = useNavigate();
  const create = useCreateProposal();
  const [search, setSearch] = React.useState("");
  const [picked, setPicked] = React.useState<string | null>(leadId ?? null);
  const [templateId, setTemplateId] = React.useState("");
  const leads = useLeads({ search: search || undefined, status: "active", per_page: 8 });
  const templates = useProposals({ templates: true });

  React.useEffect(() => {
    if (mode) {
      setPicked(leadId ?? null);
      setSearch("");
      setTemplateId("");
      create.reset();
    }
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps -- reset when opened

  function submit() {
    create.mutate(
      mode === "template"
        ? { is_template: true }
        : { lead_id: dealId ? undefined : picked ?? undefined, deal_id: dealId, template_id: templateId || undefined },
      {
        onSuccess: (p) => {
          onClose();
          navigate(`/sales/proposals/${p.id}`);
        },
      },
    );
  }

  return (
    <Dialog open={!!mode} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={mode === "template" ? "New proposal template" : "New proposal"} className="max-w-lg">
        {create.isError && <FormAlert>{errorMessage(create.error)}</FormAlert>}
        {mode === "proposal" && !leadId && !dealId && (
          <div className="flex flex-col gap-2">
            <Field label="For which lead?" htmlFor="np-search">
              <Input id="np-search" autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search leads…" />
            </Field>
            <ul className="max-h-60 overflow-y-auto rounded-control border border-line">
              {leads.data?.items.map((l) => (
                <li key={l.id}>
                  <button
                    onClick={() => setPicked(l.id)}
                    className={cn("flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-raised", picked === l.id && "bg-accent-soft")}
                  >
                    <span className="truncate">{l.business_name}</span>
                    <span className="text-xs text-subtle">{l.city ?? l.country ?? ""}</span>
                  </button>
                </li>
              ))}
              {leads.data?.items.length === 0 && <li className="px-3 py-4 text-center text-sm text-subtle">No active leads match.</li>}
            </ul>
          </div>
        )}
        {mode === "proposal" && (
          <Field label="Start from" htmlFor="np-template" className="mt-4">
            <Select id="np-template" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
              <option value="">Blank proposal</option>
              {templates.data?.items.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
            </Select>
          </Field>
        )}
        {mode === "template" && <p className="text-sm text-muted">Templates hold reusable services, introduction and terms. Pick one when starting a proposal.</p>}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={create.isPending} disabled={mode === "proposal" && !picked && !dealId} onClick={submit}>
            {mode === "template" ? "Create template" : "Create proposal"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
