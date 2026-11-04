import {
  ArrowLeft,
  CalendarClock,
  CalendarPlus,
  Check,
  ExternalLink,
  ListChecks,
  Package,
  Pencil,
  Plus,
  Star,
  Trash2,
} from "lucide-react";
import * as React from "react";
import { Link, useNavigate, useParams } from "react-router";

import { FilesPanel } from "@/components/files-panel";
import { PageHeader } from "@/components/layout/app-shell";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Checkbox, Tabs, Textarea } from "@/components/ui/form-controls";
import { Field, Input, Select } from "@/components/ui/input";
import { Avatar, Progress } from "@/components/ui/misc";
import { useAuth, useMe } from "@/features/auth/auth-context";
import { FormAlert } from "@/features/auth/auth-layout";
import { useLookups } from "@/features/leads/api";
import { CURRENCIES } from "@/features/leads/lead-form";
import { FollowUpRow, MeetingRow } from "@/features/sales/activity-pages";
import { useFollowUps, useMeetings } from "@/features/sales/api";
import { FollowUpDialog, MeetingDialog } from "@/features/sales/dialogs";
import { ApiError, errorMessage } from "@/lib/api";
import { displayUrl, openExternal } from "@/lib/external";
import { formatDate, formatMoney, formatPlainDate, formatRelative } from "@/lib/format";
import type { ClientDetail, ClientService, ClientStatus, Contact } from "@/types/clients";
import { CLIENT_STATUS_LABELS } from "@/types/clients";
import { BILLING_LABELS, type BillingType } from "@/types/sales";

import {
  useClient,
  useClientHistory,
  useClientServiceMutations,
  useClientStatus,
  useContactMutations,
  useDeleteClient,
  useOnboarding,
  type ServiceInput,
} from "./api";
import { ClientFormDialog, ClientStatusBadge, monthlyLabel } from "./clients-page";
import { ContractsTable } from "./contracts-page";

/** Tabs other modules add to the client workspace (Phase 5: projects, content, websites). */
export const clientDetailExtensions: {
  tabs: { value: string; label: string; count?: (c: ClientDetail) => number; component: React.ComponentType<{ client: ClientDetail }> }[];
} = { tabs: [] };

export function ClientDetailPage() {
  const { id = "" } = useParams();
  const client = useClient(id);
  const { can } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = React.useState("overview");
  const [editing, setEditing] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const status = useClientStatus(id);
  const remove = useDeleteClient();

  if (client.isPending) return <Card className="p-6"><ListSkeleton rows={6} /></Card>;
  if (client.isError) {
    return client.error instanceof ApiError && client.error.status === 404 ? (
      <Card><EmptyState title="Client not found" action={<Button asChild variant="secondary" size="sm"><Link to="/clients"><ArrowLeft /> Clients</Link></Button>} /></Card>
    ) : (
      <Card><ErrorState error={client.error} onRetry={() => void client.refetch()} /></Card>
    );
  }
  const c = client.data;
  const extra = clientDetailExtensions.tabs;
  const ExtraTab = extra.find((t) => t.value === tab)?.component;

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-3"><Link to="/clients"><ArrowLeft /> Clients</Link></Button>
      <PageHeader
        title={<span className="flex items-center gap-3"><Avatar name={c.company.name} className="size-10 rounded-md" />{c.company.name}</span>}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <ClientStatusBadge status={c.status} />
            <span>{[c.company.industry, c.company.city, c.company.country].filter(Boolean).join(", ")}</span>
            <span className="text-subtle">· client since {formatPlainDate(c.client_since, { month: "short", year: "numeric" })}</span>
          </span>
        }
        actions={
          can("clients.manage") && (
            <>
              <DropdownMenu>
                <DropdownMenuTrigger asChild><Button variant="secondary" loading={status.isPending}>Set status</Button></DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {(Object.keys(CLIENT_STATUS_LABELS) as ClientStatus[]).map((s) => (
                    <DropdownMenuItem key={s} onSelect={() => status.mutate(s)}>{c.status === s && <Check />} {CLIENT_STATUS_LABELS[s]}</DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <Button variant="secondary" onClick={() => setEditing(true)}><Pencil /> Edit</Button>
              <Button variant="ghost" size="icon" aria-label="Delete client" onClick={() => setDeleting(true)}><Trash2 /></Button>
            </>
          )
        }
      />
      {status.isError && <div className="mb-4"><FormAlert>{errorMessage(status.error)}</FormAlert></div>}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Tabs
            value={tab}
            onChange={setTab}
            className="self-start"
            tabs={[
              { value: "overview", label: "Overview" },
              { value: "services", label: "Services", count: c.services.length || undefined },
              { value: "contracts", label: "Contracts", count: c.counts.contracts || undefined },
              ...extra.map((t) => ({ value: t.value, label: t.label, count: t.count?.(c) || undefined })),
              { value: "activity", label: "Activity" },
              { value: "files", label: "Files", count: c.counts.files || undefined },
            ]}
          />
          {tab === "overview" && <Overview client={c} />}
          {tab === "services" && <Services client={c} />}
          {tab === "contracts" && <Card className="overflow-hidden"><ContractsTable clientId={c.id} /></Card>}
          {tab === "activity" && <Activity client={c} />}
          {tab === "files" && (
            <Card><CardBody className="pt-5"><FilesPanel target={{ bucket: "documents", entity_type: "client", entity_id: c.id }} canEdit={can("clients.manage")} title="Documents" /></CardBody></Card>
          )}
          {ExtraTab && <ExtraTab client={c} />}
        </div>
        <Sidebar client={c} />
      </div>

      <ClientFormDialog open={editing} onOpenChange={setEditing} client={c} />
      <ConfirmDialog open={deleting} onOpenChange={setDeleting} title={`Delete ${c.company.name}?`} description="The client is removed from lists and reports. Its history stays in the audit log." onConfirm={() => remove.mutateAsync(c.id).then(() => navigate("/clients"))} />
    </>
  );
}

function Sidebar({ client: c }: { client: ClientDetail }) {
  const rows: [string, React.ReactNode][] = [
    ["Account manager", c.account_manager_name ?? "—"],
    ["Recurring", monthlyLabel(c.monthly_value)],
    ["Active services", c.services.filter((s) => s.status === "active").length],
    ["Open tasks", c.counts.open_tasks],
    ["Projects", c.counts.projects],
    ["Websites", c.counts.websites],
  ];
  return (
    <div className="flex flex-col gap-4 self-start">
      <Card>
        <CardBody className="pt-5">
          <dl className="flex flex-col gap-3">
            {rows.map(([k, v]) => (
              <div key={k} className="flex items-center justify-between gap-3 text-sm">
                <dt className="text-subtle">{k}</dt>
                <dd className="truncate text-right">{v}</dd>
              </div>
            ))}
          </dl>
          {(c.lead_id || c.proposal_id) && (
            <div className="mt-4 flex flex-col gap-1.5 border-t border-line pt-4 text-sm">
              {c.lead_id && <Link to={`/leads/record/${c.lead_id}`} className="text-accent hover:underline">Original lead & sales history</Link>}
              {c.proposal_id && <Link to={`/sales/proposals/${c.proposal_id}`} className="text-accent hover:underline">Winning proposal {c.proposal_number}</Link>}
            </div>
          )}
        </CardBody>
      </Card>
      <Onboarding client={c} />
    </div>
  );
}

function Onboarding({ client: c }: { client: ClientDetail }) {
  const { can } = useAuth();
  const { start, toggle } = useOnboarding(c.id);
  const done = c.onboarding.filter((i) => i.status === "done").length;
  if (c.onboarding.length === 0 && c.status !== "onboarding") return null;
  return (
    <Card>
      <CardHeader title="Onboarding" description={c.onboarding.length ? `${done} of ${c.onboarding.length} done` : "Get the client set up"} />
      <CardBody>
        {c.onboarding.length === 0 ? (
          can("clients.manage") ? (
            <Button variant="secondary" size="sm" loading={start.isPending} onClick={() => start.mutate(undefined)}><ListChecks /> Start onboarding checklist</Button>
          ) : (
            <p className="text-sm text-subtle">No checklist yet.</p>
          )
        ) : (
          <>
            <Progress value={(done / c.onboarding.length) * 100} className="mb-3" />
            <ul className="flex flex-col gap-2">
              {c.onboarding.map((i) => (
                <li key={i.id} className="flex items-start gap-2.5 text-sm">
                  <Checkbox checked={i.status === "done"} label={i.title} disabled={toggle.isPending} onChange={(v) => toggle.mutate({ taskId: i.id, done: v })} className="mt-0.5" />
                  <span className={i.status === "done" ? "text-subtle line-through" : ""}>{i.title}</span>
                </li>
              ))}
            </ul>
            {done === c.onboarding.length && c.status === "onboarding" && <p className="mt-3 text-xs text-success-fg">All done. The client is now active.</p>}
          </>
        )}
      </CardBody>
    </Card>
  );
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 py-2">
      <div>
        <p className="text-xs text-subtle">{label}</p>
        <div className="mt-0.5 break-words text-sm">{children}</div>
      </div>
    </div>
  );
}

function LinkValue({ url }: { url: string | null }) {
  if (!url) return <span className="text-subtle">—</span>;
  return (
    <button onClick={() => openExternal(url)} className="inline-flex max-w-full items-center gap-1 text-left text-accent hover:underline">
      <span className="truncate">{displayUrl(url)}</span><ExternalLink className="size-3 shrink-0" />
    </button>
  );
}

function Overview({ client: c }: { client: ClientDetail }) {
  const dash = <span className="text-subtle">—</span>;
  const co = c.company;
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader title="Business" />
        <CardBody className="pt-2">
          <InfoRow label="Industry">{[co.industry, co.category].filter(Boolean).join(", ") || dash}</InfoRow>
          <InfoRow label="Location">{[co.address, co.city, co.region, co.country].filter(Boolean).join(", ") || dash}</InfoRow>
          <InfoRow label="Phone">{co.phone ?? dash}</InfoRow>
          <InfoRow label="Email">{co.email ?? dash}</InfoRow>
          <InfoRow label="Website"><LinkValue url={co.website_url} /></InfoRow>
          <InfoRow label="Facebook"><LinkValue url={co.facebook_url} /></InfoRow>
          <InfoRow label="Instagram"><LinkValue url={co.instagram_url} /></InfoRow>
        </CardBody>
      </Card>
      <div className="flex flex-col gap-4">
        <Contacts client={c} />
        <Card>
          <CardHeader title="Billing" />
          <CardBody className="pt-2 text-sm">
            <InfoRow label="Billing email">{c.billing_email ?? dash}</InfoRow>
            <InfoRow label="Billing address">{c.billing_address ?? dash}</InfoRow>
            {c.billing_notes && <p className="mt-2 text-muted">{c.billing_notes}</p>}
          </CardBody>
        </Card>
        {c.notes && (
          <Card>
            <CardHeader title="Notes" />
            <CardBody><p className="whitespace-pre-wrap text-sm text-muted">{c.notes}</p></CardBody>
          </Card>
        )}
      </div>
    </div>
  );
}

function Contacts({ client: c }: { client: ClientDetail }) {
  const { can } = useAuth();
  const [editing, setEditing] = React.useState<Contact | "new" | null>(null);
  const m = useContactMutations(c.id);
  return (
    <Card>
      <CardHeader title="Contacts" action={can("clients.manage") && <Button variant="ghost" size="sm" onClick={() => setEditing("new")}><Plus /> Add</Button>} />
      <CardBody>
        {c.contacts.length === 0 ? (
          <EmptyState title="No contacts" compact />
        ) : (
          <ul className="-mx-2 flex flex-col">
            {c.contacts.map((ct) => (
              <li key={ct.id} className="group flex items-center gap-3 rounded-md px-2 py-2 hover:bg-raised/50">
                <Avatar name={ct.full_name} className="size-8 text-[11px]" />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 truncate text-sm font-medium">{ct.full_name}{ct.is_primary && <Star className="size-3 fill-current text-warning" aria-label="Primary contact" />}</p>
                  <p className="truncate text-xs text-subtle">{[ct.position, ct.email, ct.phone].filter(Boolean).join(", ") || "—"}</p>
                </div>
                {can("clients.manage") && (
                  <Button variant="ghost" size="icon-sm" className="opacity-0 group-hover:opacity-100 focus:opacity-100" aria-label={`Edit ${ct.full_name}`} onClick={() => setEditing(ct)}><Pencil /></Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardBody>
      <ContactDialog
        contact={editing === "new" ? undefined : editing ?? undefined}
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        onSave={(b) => (editing && editing !== "new" ? m.update.mutateAsync({ ...b, contactId: editing.id }) : m.add.mutateAsync(b))}
        onDelete={editing && editing !== "new" ? () => m.remove.mutateAsync(editing.id) : undefined}
      />
    </Card>
  );
}

function ContactDialog({
  contact,
  open,
  onOpenChange,
  onSave,
  onDelete,
}: {
  contact?: Contact;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSave: (b: { full_name: string; position: string | null; email: string | null; phone: string | null; is_primary: boolean; notes: string | null }) => Promise<unknown>;
  onDelete?: () => Promise<unknown>;
}) {
  const [f, setF] = React.useState({ full_name: "", position: "", email: "", phone: "", is_primary: false, notes: "" });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (open) {
      setF({ full_name: contact?.full_name ?? "", position: contact?.position ?? "", email: contact?.email ?? "", phone: contact?.phone ?? "", is_primary: contact?.is_primary ?? false, notes: contact?.notes ?? "" });
      setErrors({});
      setError(null);
    }
  }, [open, contact]);
  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onOpenChange(false);
    } catch (e) {
      if (e instanceof ApiError && e.code === "validation_failed") setErrors(e.fields);
      else setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={contact ? "Edit contact" : "Add a contact"} className="max-w-md">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!f.full_name.trim()) return setErrors({ full_name: "Enter a name." });
            void run(() => onSave({ full_name: f.full_name.trim(), position: f.position || null, email: f.email || null, phone: f.phone || null, is_primary: f.is_primary, notes: f.notes || null }));
          }}
        >
          {error && <FormAlert>{error}</FormAlert>}
          <Field label="Name" htmlFor="ct-name" error={errors.full_name}><Input id="ct-name" autoFocus value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} /></Field>
          <Field label="Position" htmlFor="ct-pos"><Input id="ct-pos" value={f.position} onChange={(e) => setF({ ...f, position: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Email" htmlFor="ct-email" error={errors.email}><Input id="ct-email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
            <Field label="Phone" htmlFor="ct-phone"><Input id="ct-phone" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
          </div>
          <label className="flex items-center gap-2.5 text-sm text-muted"><Checkbox checked={f.is_primary} onChange={(v) => setF({ ...f, is_primary: v })} label="Primary contact" /> Primary contact</label>
          <DialogFooter>
            {onDelete && <Button type="button" variant="ghost" className="mr-auto text-danger-fg" onClick={() => void run(onDelete)}><Trash2 /> Remove</Button>}
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" loading={busy}>Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Services({ client: c }: { client: ClientDetail }) {
  const { can } = useAuth();
  const [editing, setEditing] = React.useState<ClientService | "new" | null>(null);
  const m = useClientServiceMutations(c.id);
  return (
    <Card>
      <CardHeader
        title="Services"
        description={`Recurring: ${monthlyLabel(c.monthly_value)}`}
        action={can("clients.manage") && <Button size="sm" variant="secondary" onClick={() => setEditing("new")}><Plus /> Add service</Button>}
      />
      <CardBody>
        {c.services.length === 0 ? (
          <EmptyState title="No services yet" compact />
        ) : (
          <ul className="-mx-2 flex flex-col">
            {c.services.map((s) => (
              <li key={s.id} className="group flex items-center gap-3 rounded-md px-2 py-2.5 hover:bg-raised/50">
                <Package className="size-4 shrink-0 text-subtle" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{s.name}</p>
                  <p className="truncate text-xs text-subtle">
                    {BILLING_LABELS[s.billing_type]}{s.start_date && `, since ${formatPlainDate(s.start_date, { month: "short", year: "numeric" })}`}{s.end_date && `, until ${formatPlainDate(s.end_date, { month: "short", day: "numeric", year: "numeric" })}`}
                  </p>
                </div>
                <span className="text-sm tabular-nums">{formatMoney(s.price, s.currency)}</span>
                <Badge tone={s.status === "active" ? "success" : s.status === "paused" ? "warning" : "neutral"}>{s.status}</Badge>
                {can("clients.manage") && (
                  <Button variant="ghost" size="icon-sm" className="opacity-0 group-hover:opacity-100 focus:opacity-100" aria-label={`Edit ${s.name}`} onClick={() => setEditing(s)}><Pencil /></Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardBody>
      <ServiceDialog
        service={editing === "new" ? undefined : editing ?? undefined}
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        onSave={(b) => (editing && editing !== "new" ? m.update.mutateAsync({ ...b, serviceId: editing.id }) : m.add.mutateAsync(b))}
        onDelete={editing && editing !== "new" ? () => m.remove.mutateAsync(editing.id) : undefined}
      />
    </Card>
  );
}

function ServiceDialog({
  service,
  open,
  onOpenChange,
  onSave,
  onDelete,
}: {
  service?: ClientService;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSave: (b: ServiceInput) => Promise<unknown>;
  onDelete?: () => Promise<unknown>;
}) {
  const lookups = useLookups();
  const init = () => ({
    service_id: service?.service_id ?? "",
    name: service?.name ?? "",
    price: service ? String(Number(service.price)) : "",
    currency: service?.currency ?? "PHP",
    billing_type: service?.billing_type ?? ("monthly" as BillingType),
    status: service?.status ?? "active",
    start_date: service?.start_date ?? new Date().toISOString().slice(0, 10),
    end_date: service?.end_date ?? "",
    notes: service?.notes ?? "",
  });
  const [f, setF] = React.useState(init);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    if (open) {
      setF(init());
      setErrors({});
      setError(null);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps -- reset when opened
  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onOpenChange(false);
    } catch (e) {
      if (e instanceof ApiError && e.code === "validation_failed") setErrors(e.fields);
      else setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={service ? "Edit service" : "Add a service"} className="max-w-lg">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!f.name.trim()) return setErrors({ name: "Name the service." });
            void run(() => onSave({ ...f, service_id: f.service_id || null, name: f.name.trim(), price: f.price || "0", end_date: f.end_date || null, start_date: f.start_date || null, notes: f.notes || null }));
          }}
        >
          {error && <FormAlert>{error}</FormAlert>}
          <Field label="From the catalog" htmlFor="sv-cat">
            <Select id="sv-cat" value={f.service_id} onChange={(e) => {
              const picked = lookups.data?.services.find((s) => s.id === e.target.value);
              setF({ ...f, service_id: e.target.value, name: picked?.name ?? f.name });
            }}>
              <option value="">Custom service</option>
              {lookups.data?.services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>
          <Field label="Name" htmlFor="sv-name" error={errors.name}><Input id="sv-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <div className="grid grid-cols-3 gap-4">
            <Field label="Price" htmlFor="sv-price" error={errors.price}><Input id="sv-price" inputMode="decimal" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></Field>
            <Field label="Currency" htmlFor="sv-cur"><Select id="sv-cur" value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
            <Field label="Billing" htmlFor="sv-bill">
              <Select id="sv-bill" value={f.billing_type} onChange={(e) => setF({ ...f, billing_type: e.target.value as BillingType })}>
                {(Object.keys(BILLING_LABELS) as BillingType[]).map((b) => <option key={b} value={b}>{BILLING_LABELS[b]}</option>)}
              </Select>
            </Field>
            <Field label="Status" htmlFor="sv-status">
              <Select id="sv-status" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as typeof f.status })}>
                <option value="active">Active</option><option value="paused">Paused</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option>
              </Select>
            </Field>
            <Field label="Start" htmlFor="sv-start"><Input id="sv-start" type="date" value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value })} /></Field>
            <Field label="End" htmlFor="sv-end" error={errors.end_date}><Input id="sv-end" type="date" value={f.end_date} onChange={(e) => setF({ ...f, end_date: e.target.value })} /></Field>
          </div>
          <Field label="Notes" htmlFor="sv-notes"><Textarea id="sv-notes" rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
          <DialogFooter>
            {onDelete && <Button type="button" variant="ghost" className="mr-auto text-danger-fg" onClick={() => void run(onDelete)}><Trash2 /> Remove</Button>}
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" loading={busy}>Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Activity({ client: c }: { client: ClientDetail }) {
  const me = useMe();
  const { can } = useAuth();
  const history = useClientHistory(c.id);
  const followUps = useFollowUps({ client_id: c.id, status: "pending" });
  const meetings = useMeetings({ client_id: c.id });
  const [open, setOpen] = React.useState<"follow" | "meet" | null>(null);
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Follow-ups" action={can("sales.manage") && <Button variant="ghost" size="sm" onClick={() => setOpen("follow")}><CalendarClock /> Add</Button>} />
          <CardBody>
            {followUps.data?.items.length ? <ul className="-mx-2">{followUps.data.items.map((f) => <FollowUpRow key={f.id} item={f} showOwner />)}</ul> : <EmptyState title="No follow-ups" compact />}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Meetings" action={can("sales.manage") && <Button variant="ghost" size="sm" onClick={() => setOpen("meet")}><CalendarPlus /> Add</Button>} />
          <CardBody>
            {meetings.data?.length ? <ul className="-mx-2">{meetings.data.map((m) => <MeetingRow key={m.id} meeting={m} />)}</ul> : <EmptyState title="No meetings" compact />}
          </CardBody>
        </Card>
      </div>
      <Card>
        <CardHeader title="History" />
        <CardBody>
          {history.isPending ? (
            <ListSkeleton rows={4} />
          ) : !history.data?.length ? (
            <EmptyState title="No history yet" compact />
          ) : (
            <ol className="relative flex flex-col gap-4 before:absolute before:bottom-2 before:left-[17px] before:top-2 before:w-px before:bg-line">
              {history.data.map((h) => (
                <li key={h.id} className="relative flex items-start gap-3">
                  <Avatar name={h.actor_name ?? "System"} className="size-9 ring-4" />
                  <div className="min-w-0 pt-0.5">
                    <p className="text-sm">{h.summary}</p>
                    {h.detail && <p className="mt-0.5 line-clamp-3 text-sm text-muted">{h.detail}</p>}
                    <p className="mt-0.5 text-xs text-subtle">{formatRelative(h.occurred_at)}, {formatDate(h.occurred_at, me.timezone, { year: "numeric" })}</p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </CardBody>
      </Card>
      <FollowUpDialog open={open === "follow"} onOpenChange={(o) => !o && setOpen(null)} clientId={c.id} defaultTitle={`Check in with ${c.company.name}`} />
      <MeetingDialog open={open === "meet"} onOpenChange={(o) => !o && setOpen(null)} clientId={c.id} defaultTitle={`Meeting with ${c.company.name}`} />
    </div>
  );
}
