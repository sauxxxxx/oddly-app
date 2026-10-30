import { Building2, Globe, History, Plus, Search, UserRound } from "lucide-react";
import * as React from "react";
import { Link, useNavigate } from "react-router";

import { PageHeader } from "@/components/layout/app-shell";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/states";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataTable, Pagination, type Column } from "@/components/ui/data-table";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/form-controls";
import { Field, Input, Select } from "@/components/ui/input";
import { Avatar } from "@/components/ui/misc";
import { useAuth, useMe } from "@/features/auth/auth-context";
import { FormAlert } from "@/features/auth/auth-layout";
import { useLookups } from "@/features/leads/api";
import { ApiError, errorMessage } from "@/lib/api";
import { formatMoney, formatPlainDate, formatRelative } from "@/lib/format";
import type { ClientDetail, ClientRow, ClientStatus } from "@/types/clients";
import { CLIENT_STATUS_LABELS } from "@/types/clients";

import { useClientFeed, useClients, useCreateClient, useUpdateClient, type ClientInput } from "./api";

export const CLIENT_STATUS_TONE: Record<ClientStatus, BadgeTone> = {
  onboarding: "info",
  active: "success",
  awaiting_client: "warning",
  needs_attention: "warning",
  at_risk: "danger",
  completed: "neutral",
  inactive: "neutral",
};

export function ClientStatusBadge({ status }: { status: ClientStatus }) {
  return <Badge tone={CLIENT_STATUS_TONE[status]} dot>{CLIENT_STATUS_LABELS[status]}</Badge>;
}

export function monthlyLabel(values: Record<string, string>) {
  const entries = Object.entries(values).filter(([, v]) => Number(v) > 0);
  return entries.length ? entries.map(([c, v]) => `${formatMoney(v, c, { compact: Number(v) >= 100_000 })}/mo`).join(" · ") : "—";
}

function useDebounced(value: string) {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setV(value), 300);
    return () => clearTimeout(t);
  }, [value]);
  return v;
}

/** Active Clients: current clients as a table. */
export function ClientsPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const lookups = useLookups();
  const [status, setStatus] = React.useState("current");
  const [manager, setManager] = React.useState("");
  const [search, setSearch] = React.useState("");
  const debounced = useDebounced(search);
  const [page, setPage] = React.useState(1);
  const [adding, setAdding] = React.useState(false);
  React.useEffect(() => setPage(1), [debounced, status, manager]);
  const clients = useClients({ status, manager: manager || undefined, search: debounced || undefined, sort: "status", page });

  const columns: Column<ClientRow>[] = [
    {
      key: "name",
      header: "Client",
      cell: (c) => (
        <div className="min-w-0 max-w-[280px]">
          <p className="truncate font-medium">{c.name}</p>
          <p className="flex items-center gap-1.5 truncate text-xs text-subtle">
            {c.market === "international" && <Globe className="size-3" />}
            {[c.industry, c.city, c.market === "international" ? c.country : null].filter(Boolean).join(" · ") || "—"}
          </p>
        </div>
      ),
    },
    { key: "status", header: "Status", cell: (c) => <ClientStatusBadge status={c.status} /> },
    { key: "contact", header: "Contact", cell: (c) => <span className="text-[13px] text-muted">{c.primary_contact ?? "—"}</span> },
    { key: "manager", header: "Account manager", cell: (c) => <span className="text-[13px] text-muted">{c.account_manager_name ?? "—"}</span> },
    { key: "services", header: "Services", cell: (c) => <span className="text-[13px] text-muted">{c.services_count}</span> },
    { key: "mrr", header: "Recurring", cell: (c) => <span className="whitespace-nowrap text-[13px] tabular-nums text-muted">{monthlyLabel(c.monthly_value)}</span> },
    { key: "tasks", header: "Open tasks", cell: (c) => <span className="text-[13px] text-muted">{c.open_tasks || "—"}</span> },
    { key: "since", header: "Client since", cell: (c) => <span className="text-[13px] text-subtle">{formatPlainDate(c.client_since, { month: "short", year: "numeric" })}</span> },
  ];

  return (
    <>
      <PageHeader
        title="Clients"
        description="Everyone the agency is working for. Won leads appear here automatically."
        actions={can("clients.manage") && <Button onClick={() => setAdding(true)}><Plus /> Add client</Button>}
      />
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-4">
          <div className="relative min-w-60 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search clients…" className="pl-9" aria-label="Search clients" />
          </div>
          <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto min-w-44">
            <option value="current">Current clients</option>
            <option value="all">All statuses</option>
            {(Object.keys(CLIENT_STATUS_LABELS) as ClientStatus[]).map((s) => <option key={s} value={s}>{CLIENT_STATUS_LABELS[s]}</option>)}
          </Select>
          <Select aria-label="Account manager" value={manager} onChange={(e) => setManager(e.target.value)} className="w-auto min-w-44">
            <option value="">Any manager</option>
            <option value="me">Mine</option>
            {lookups.data?.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </Select>
        </div>
        {clients.isError ? (
          <ErrorState error={clients.error} onRetry={() => void clients.refetch()} />
        ) : clients.data?.total === 0 ? (
          <EmptyState
            icon={Building2}
            title={debounced || status !== "current" || manager ? "No clients match" : "No clients yet"}
            description="Convert a won lead from its page or the pipeline, or add an existing client directly."
          />
        ) : (
          <>
            <DataTable columns={columns} rows={clients.data?.items ?? []} loading={clients.isPending} onRowClick={(c) => navigate(`/clients/record/${c.id}`)} />
            {clients.data && <Pagination page={clients.data.page} perPage={clients.data.per_page} total={clients.data.total} onPage={setPage} />}
          </>
        )}
      </Card>
      <ClientFormDialog open={adding} onOpenChange={setAdding} onSaved={(c) => navigate(`/clients/record/${c.id}`)} />
    </>
  );
}

/** Client Profiles: a card directory of every client, any status. */
export function ClientProfilesPage() {
  const [search, setSearch] = React.useState("");
  const debounced = useDebounced(search);
  const clients = useClients({ status: "all", search: debounced || undefined, per_page: 200 });
  return (
    <>
      <PageHeader title="Client profiles" description="Every client workspace — business details, contacts, services, projects and files." />
      <div className="relative mb-4 max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find a client…" className="pl-9" aria-label="Find a client" />
      </div>
      {clients.isError ? (
        <Card><ErrorState error={clients.error} onRetry={() => void clients.refetch()} /></Card>
      ) : clients.isPending ? (
        <Card className="p-6"><ListSkeleton rows={4} /></Card>
      ) : clients.data.items.length === 0 ? (
        <Card><EmptyState icon={Building2} title="No clients yet" /></Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {clients.data.items.map((c) => (
            <Link key={c.id} to={`/clients/record/${c.id}`}>
              <Card className="h-full gap-4 p-5 transition-colors hover:border-line-strong">
                <div className="flex items-start gap-3">
                  <Avatar name={c.name} className="size-11 rounded-2xl" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{c.name}</p>
                    <p className="truncate text-xs text-subtle">{[c.industry, c.city, c.country].filter(Boolean).join(" · ") || "—"}</p>
                  </div>
                  <ClientStatusBadge status={c.status} />
                </div>
                <div className="grid grid-cols-3 gap-2 text-sm">
                  <div><p className="text-xs text-subtle">Services</p><p>{c.services_count}</p></div>
                  <div><p className="text-xs text-subtle">Open tasks</p><p>{c.open_tasks}</p></div>
                  <div className="min-w-0"><p className="text-xs text-subtle">Recurring</p><p className="truncate">{monthlyLabel(c.monthly_value)}</p></div>
                </div>
                <p className="flex items-center gap-1.5 text-xs text-subtle"><UserRound className="size-3" /> {c.account_manager_name ?? "No account manager"}</p>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

/** Client History: what's happened across all clients. */
export function ClientHistoryPage() {
  const [page, setPage] = React.useState(1);
  const feed = useClientFeed(page);
  return (
    <>
      <PageHeader title="Client history" description="Status changes, services, contracts and onboarding across every client." />
      <Card className="overflow-hidden">
        {feed.isError ? (
          <ErrorState error={feed.error} onRetry={() => void feed.refetch()} />
        ) : feed.isPending ? (
          <div className="p-6"><ListSkeleton rows={6} /></div>
        ) : feed.data.items.length === 0 ? (
          <EmptyState icon={History} title="No client activity yet" />
        ) : (
          <>
            <ul className="divide-y divide-line/60">
              {feed.data.items.map((h) => (
                <li key={h.id} className="flex items-center gap-3 px-5 py-3.5">
                  <Avatar name={h.actor_name ?? "System"} className="size-8 text-[11px]" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{h.summary}</p>
                    {h.client_id && <Link to={`/clients/record/${h.client_id}`} className="text-xs text-accent hover:underline">{h.client_name}</Link>}
                  </div>
                  <span className="shrink-0 text-xs text-subtle">{formatRelative(h.occurred_at)}</span>
                </li>
              ))}
            </ul>
            <Pagination page={feed.data.page} perPage={feed.data.per_page} total={feed.data.total} onPage={setPage} />
          </>
        )}
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------

export function ClientFormDialog({
  open,
  onOpenChange,
  client,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  client?: ClientDetail;
  onSaved?: (c: ClientDetail) => void;
}) {
  const me = useMe();
  const lookups = useLookups();
  const create = useCreateClient();
  const update = useUpdateClient(client?.id ?? "");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const s = (v: string | null | undefined) => v ?? "";
  const init = () => ({
    business_name: s(client?.company.name),
    market: client?.company.market ?? "local",
    industry: s(client?.company.industry),
    category: s(client?.company.category),
    country: client ? s(client.company.country) : "Philippines",
    region: s(client?.company.region),
    city: s(client?.company.city),
    address: s(client?.company.address),
    website_url: s(client?.company.website_url),
    facebook_url: s(client?.company.facebook_url),
    instagram_url: s(client?.company.instagram_url),
    linkedin_url: s(client?.company.linkedin_url),
    business_phone: s(client?.company.phone),
    business_email: s(client?.company.email),
    contact_name: "",
    contact_position: "",
    contact_email: "",
    contact_phone: "",
    status: client?.status ?? "onboarding",
    account_manager_id: client?.account_manager_id ?? me.id,
    client_since: client?.client_since ?? new Date().toISOString().slice(0, 10),
    billing_email: s(client?.billing_email),
    billing_address: s(client?.billing_address),
    billing_notes: s(client?.billing_notes),
    notes: s(client?.notes),
  });
  const [f, setF] = React.useState(init);
  React.useEffect(() => {
    if (open) {
      setF(init());
      setErrors({});
      create.reset();
      update.reset();
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps -- reset when opened

  const bind = (k: keyof typeof f) => ({
    id: `cl-${k}`,
    value: f[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value }),
    "aria-invalid": !!errors[k],
  });
  const failure = create.error ?? update.error;

  async function submit() {
    if (!f.business_name.trim()) return setErrors({ business_name: "Enter the business name." });
    const n = (v: string) => v.trim() || null;
    const body: ClientInput = {
      business_name: f.business_name.trim(),
      market: f.market as "local" | "international",
      industry: n(f.industry), category: n(f.category), country: n(f.country), region: n(f.region), city: n(f.city),
      address: n(f.address), website_url: n(f.website_url), facebook_url: n(f.facebook_url), instagram_url: n(f.instagram_url),
      linkedin_url: n(f.linkedin_url), business_phone: n(f.business_phone), business_email: n(f.business_email),
      contact_name: n(f.contact_name), contact_position: n(f.contact_position), contact_email: n(f.contact_email), contact_phone: n(f.contact_phone),
      status: f.status, account_manager_id: f.account_manager_id || null, client_since: f.client_since || null,
      billing_email: n(f.billing_email), billing_address: n(f.billing_address), billing_notes: n(f.billing_notes), notes: n(f.notes),
    };
    try {
      const saved = client ? await update.mutateAsync(body) : await create.mutateAsync(body);
      onSaved?.(saved);
      onOpenChange(false);
    } catch (e) {
      if (e instanceof ApiError) setErrors(e.fields);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={client ? `Edit ${client.company.name}` : "Add a client"}
        description={client ? undefined : "For existing customers who never went through the pipeline. Prospects should be added as leads and converted."}
        className="max-h-[calc(100vh-4rem)] max-w-3xl overflow-y-auto"
      >
        <form className="flex flex-col gap-5" onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate>
          {failure && !(failure instanceof ApiError && failure.code === "validation_failed") && <FormAlert>{errorMessage(failure)}</FormAlert>}
          <div className="grid grid-cols-2 gap-4">
            <Field label="Business name *" htmlFor="cl-business_name" error={errors.business_name} className="col-span-2">
              <Input {...bind("business_name")} autoFocus />
            </Field>
            <Field label="Market" htmlFor="cl-market">
              <Select {...bind("market")}><option value="local">Local</option><option value="international">International</option></Select>
            </Field>
            <Field label="Industry" htmlFor="cl-industry"><Input {...bind("industry")} /></Field>
            <Field label="Country" htmlFor="cl-country"><Input {...bind("country")} /></Field>
            <Field label="City / municipality" htmlFor="cl-city"><Input {...bind("city")} /></Field>
            <Field label="Address" htmlFor="cl-address" className="col-span-2"><Input {...bind("address")} /></Field>
            <Field label="Website" htmlFor="cl-website_url"><Input {...bind("website_url")} /></Field>
            <Field label="Facebook" htmlFor="cl-facebook_url"><Input {...bind("facebook_url")} /></Field>
            <Field label="Instagram" htmlFor="cl-instagram_url"><Input {...bind("instagram_url")} /></Field>
            <Field label="Business phone" htmlFor="cl-business_phone"><Input {...bind("business_phone")} /></Field>
            <Field label="Business email" htmlFor="cl-business_email" error={errors.business_email}><Input {...bind("business_email")} /></Field>
          </div>
          {!client && (
            <div className="grid grid-cols-2 gap-4">
              <Field label="Contact person" htmlFor="cl-contact_name"><Input {...bind("contact_name")} /></Field>
              <Field label="Position" htmlFor="cl-contact_position"><Input {...bind("contact_position")} /></Field>
              <Field label="Contact email" htmlFor="cl-contact_email" error={errors.contact_email}><Input {...bind("contact_email")} /></Field>
              <Field label="Contact phone" htmlFor="cl-contact_phone"><Input {...bind("contact_phone")} /></Field>
            </div>
          )}
          <div className="grid grid-cols-3 gap-4">
            <Field label="Status" htmlFor="cl-status">
              <Select {...bind("status")}>{(Object.keys(CLIENT_STATUS_LABELS) as ClientStatus[]).map((st) => <option key={st} value={st}>{CLIENT_STATUS_LABELS[st]}</option>)}</Select>
            </Field>
            <Field label="Account manager" htmlFor="cl-account_manager_id">
              <Select {...bind("account_manager_id")}><option value="">None</option>{lookups.data?.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select>
            </Field>
            <Field label="Client since" htmlFor="cl-client_since"><Input {...bind("client_since")} type="date" /></Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Billing email" htmlFor="cl-billing_email" error={errors.billing_email}><Input {...bind("billing_email")} /></Field>
            <Field label="Billing address" htmlFor="cl-billing_address"><Input {...bind("billing_address")} /></Field>
            <Field label="Billing notes" htmlFor="cl-billing_notes" className="col-span-2"><Input {...bind("billing_notes")} placeholder="e.g. Pays by GCash on the 5th" /></Field>
            <Field label="Notes" htmlFor="cl-notes" className="col-span-2"><Textarea {...bind("notes")} rows={3} /></Field>
          </div>
          <DialogFooter className="sticky -bottom-6 z-10 -mx-6 -mb-6 mt-0 border-t border-line bg-overlay px-6 py-4">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" loading={create.isPending || update.isPending}>{client ? "Save" : "Add client"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
