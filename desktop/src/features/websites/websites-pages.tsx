import {
  Activity,
  ArrowLeft,
  Check,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  Globe,
  KeyRound,
  Lock,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  Trash2,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import * as React from "react";
import { Link, useNavigate, useParams } from "react-router";

import { FilesPanel } from "@/components/files-panel";
import { PageHeader } from "@/components/layout/app-shell";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/states";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { TagInput, Tabs, Textarea } from "@/components/ui/form-controls";
import { Field, Input, Select } from "@/components/ui/input";
import { useAuth, useMe } from "@/features/auth/auth-context";
import { FormAlert } from "@/features/auth/auth-layout";
import { PasswordInput } from "@/features/auth/password-input";
import { useLookups } from "@/features/leads/api";
import {
  revealSecret,
  useCheckWebsite,
  useDeleteWebsite,
  useMaintenance,
  useMaintenanceMutations,
  useSaveWebsite,
  useSecretMutations,
  useWebsite,
  useWebsites,
  type MaintenanceInput,
} from "@/features/ops/api";
import { ApiError, errorMessage } from "@/lib/api";
import { openExternal } from "@/lib/external";
import { formatDate, formatPlainDate, formatRelative, formatTime, humanize, todayIn } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Maintenance, Website, WebsiteDetail } from "@/types/ops";
import { MAINTENANCE_TYPES } from "@/types/ops";

const STATUS_TONE: Record<Website["status"], BadgeTone> = { in_development: "info", active: "success", paused: "warning", archived: "neutral" };

function daysUntil(date: string | null, today: string) {
  if (!date) return null;
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400_000);
}

function DueBadge({ date, today }: { date: string | null; today: string }) {
  const d = daysUntil(date, today);
  if (d === null || date === null) return <span className="text-subtle">—</span>;
  const label = formatPlainDate(date, { month: "short", day: "numeric", year: "numeric" });
  if (d < 0) return <Badge tone="danger">Expired {label}</Badge>;
  if (d <= 30) return <Badge tone={d <= 7 ? "danger" : "warning"}>{label} · {d}d</Badge>;
  return <span className="text-[13px] text-muted">{label}</span>;
}

export function UpBadge({ w }: { w: Pick<Website, "is_up" | "last_status_code" | "last_checked_at"> }) {
  if (w.is_up === null) return <Badge>Not checked</Badge>;
  return w.is_up ? <Badge tone="success" dot>Up</Badge> : <Badge tone="danger" dot>Down{w.last_status_code ? ` · ${w.last_status_code}` : ""}</Badge>;
}

// ---------------------------------------------------------------------------

export function WebsitesPage({ clientId, embedded }: { clientId?: string; embedded?: boolean }) {
  const { can } = useAuth();
  const me = useMe();
  const navigate = useNavigate();
  const today = todayIn(me.timezone);
  const [search, setSearch] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const sites = useWebsites({ client_id: clientId, search: search || undefined });

  return (
    <>
      {!embedded && (
        <PageHeader
          title="Client websites"
          description="Every site you build or maintain: hosting, renewals, uptime and maintenance."
          actions={can("websites.manage") && <Button onClick={() => setCreating(true)}><Plus /> Add website</Button>}
        />
      )}
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-4">
          <div className="relative min-w-60 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search domain, site or client…" className="pl-9" aria-label="Search websites" />
          </div>
          {embedded && can("websites.manage") && <Button size="sm" variant="secondary" onClick={() => setCreating(true)}><Plus /> Add website</Button>}
        </div>
        {sites.isError ? <ErrorState error={sites.error} onRetry={() => void sites.refetch()} />
          : sites.isPending ? <div className="p-6"><ListSkeleton rows={4} /></div>
          : sites.data.length === 0 ? <EmptyState icon={Globe} title="No websites yet" description="Add the sites you build or maintain to track renewals, uptime and maintenance." />
          : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs uppercase tracking-[0.06em] text-subtle">
                    <th className="px-5 py-3 font-medium">Website</th><th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Uptime</th><th className="px-4 py-3 font-medium">Domain</th>
                    <th className="px-4 py-3 font-medium">Hosting</th><th className="px-4 py-3 font-medium">SSL</th><th className="px-4 py-3 font-medium">Developer</th>
                  </tr>
                </thead>
                <tbody>
                  {sites.data.map((w) => (
                    <tr key={w.id} onClick={() => navigate(`/websites/record/${w.id}`)} className="cursor-pointer border-b border-line/60 last:border-0 hover:bg-raised/40">
                      <td className="px-5 py-3">
                        <p className="font-medium">{w.domain}</p>
                        <p className="text-xs text-subtle">{w.client_name}{w.hosting_provider && ` · ${w.hosting_provider}`}</p>
                      </td>
                      <td className="px-4 py-3"><Badge tone={STATUS_TONE[w.status]}>{humanize(w.status)}</Badge></td>
                      <td className="px-4 py-3"><UpBadge w={w} />{w.uptime_7d !== null && <span className="ml-2 text-xs text-subtle">{w.uptime_7d}% 7d</span>}</td>
                      <td className="px-4 py-3"><DueBadge date={w.domain_expires_on} today={today} /></td>
                      <td className="px-4 py-3"><DueBadge date={w.hosting_renews_on} today={today} /></td>
                      <td className="px-4 py-3"><DueBadge date={w.ssl_expires_on} today={today} /></td>
                      <td className="px-4 py-3 text-[13px] text-muted">{w.developer_name ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </Card>
      <WebsiteDialog open={creating} onOpenChange={setCreating} clientId={clientId} onSaved={(w) => navigate(`/websites/record/${w.id}`)} />
    </>
  );
}

export function WebsiteDialog({ open, onOpenChange, website, clientId, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; website?: WebsiteDetail; clientId?: string; onSaved?: (w: WebsiteDetail) => void }) {
  const lookups = useLookups();
  const save = useSaveWebsite(website?.id);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const s = (v: string | null | undefined) => v ?? "";
  const init = () => ({
    client_id: website?.client_id ?? clientId ?? "",
    name: s(website?.name), domain: s(website?.domain), url: s(website?.url), status: website?.status ?? "active",
    hosting_provider: s(website?.hosting_provider), tech_stack: website?.tech_stack ?? [], domain_registrar: s(website?.domain_registrar),
    domain_expires_on: s(website?.domain_expires_on), hosting_renews_on: s(website?.hosting_renews_on), ssl_expires_on: s(website?.ssl_expires_on),
    maintenance_frequency: website?.maintenance_frequency ?? "monthly", developer_id: s(website?.developer_id),
    backup_notes: s(website?.backup_notes), notes: s(website?.notes),
  });
  const [f, setF] = React.useState(init);
  React.useEffect(() => { if (open) { setF(init()); setErrors({}); save.reset(); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps -- reset when opened
  const bind = (k: keyof typeof f) => ({ id: `ws-${k}`, value: f[k] as string, onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value }) });
  const n = (v: string) => v.trim() || null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={website ? `Edit ${website.domain}` : "Add a website"} className="max-h-[calc(100vh-4rem)] max-w-2xl overflow-y-auto">
        <form className="flex flex-col gap-4" onSubmit={(e) => {
          e.preventDefault();
          const errs: Record<string, string> = {};
          if (!f.client_id) errs.client_id = "Choose the client.";
          if (!f.domain.trim()) errs.domain = "Enter the domain.";
          setErrors(errs);
          if (Object.keys(errs).length) return;
          save.mutate({
            client_id: f.client_id, name: f.name.trim() || f.domain.trim(), domain: f.domain, url: n(f.url), status: f.status,
            hosting_provider: n(f.hosting_provider), tech_stack: f.tech_stack, domain_registrar: n(f.domain_registrar),
            domain_expires_on: n(f.domain_expires_on), hosting_renews_on: n(f.hosting_renews_on), ssl_expires_on: n(f.ssl_expires_on),
            maintenance_frequency: f.maintenance_frequency, developer_id: n(f.developer_id), backup_notes: n(f.backup_notes), notes: n(f.notes),
          }, { onSuccess: (w) => { onOpenChange(false); onSaved?.(w); }, onError: (err) => err instanceof ApiError && setErrors(err.fields) });
        }}>
          {save.isError && !(save.error instanceof ApiError && save.error.code === "validation_failed") && <FormAlert>{errorMessage(save.error)}</FormAlert>}
          <div className="grid grid-cols-2 gap-4">
            <Field label="Client" htmlFor="ws-client_id" error={errors.client_id}>
              <Select {...bind("client_id")}><option value="">Choose…</option>{lookups.data?.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
            </Field>
            <Field label="Status" htmlFor="ws-status">
              <Select {...bind("status")}>{["in_development", "active", "paused", "archived"].map((x) => <option key={x} value={x}>{humanize(x)}</option>)}</Select>
            </Field>
            <Field label="Domain" htmlFor="ws-domain" error={errors.domain}><Input {...bind("domain")} placeholder="example.com" /></Field>
            <Field label="Site name" htmlFor="ws-name"><Input {...bind("name")} placeholder="Defaults to the domain" /></Field>
            <Field label="URL to monitor" htmlFor="ws-url" hint="Defaults to https://domain" className="col-span-2"><Input {...bind("url")} /></Field>
            <Field label="Hosting provider" htmlFor="ws-hosting_provider"><Input {...bind("hosting_provider")} placeholder="Hostinger, SiteGround…" /></Field>
            <Field label="Domain registrar" htmlFor="ws-domain_registrar"><Input {...bind("domain_registrar")} /></Field>
            <Field label="Domain expires" htmlFor="ws-domain_expires_on"><Input {...bind("domain_expires_on")} type="date" /></Field>
            <Field label="Hosting renews" htmlFor="ws-hosting_renews_on"><Input {...bind("hosting_renews_on")} type="date" /></Field>
            <Field label="SSL expires" htmlFor="ws-ssl_expires_on"><Input {...bind("ssl_expires_on")} type="date" /></Field>
            <Field label="Maintenance" htmlFor="ws-maintenance_frequency">
              <Select {...bind("maintenance_frequency")}>{["none", "weekly", "monthly", "quarterly"].map((x) => <option key={x} value={x}>{humanize(x)}</option>)}</Select>
            </Field>
            <Field label="Developer" htmlFor="ws-developer_id">
              <Select {...bind("developer_id")}><option value="">None</option>{lookups.data?.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select>
            </Field>
            <Field label="Technology" htmlFor="ws-tech"><TagInput id="ws-tech" value={f.tech_stack} onChange={(v) => setF({ ...f, tech_stack: v })} placeholder="WordPress, Elementor…" /></Field>
            <Field label="Backups" htmlFor="ws-backup_notes" className="col-span-2"><Input {...bind("backup_notes")} placeholder="Where and how often backups run" /></Field>
            <Field label="Notes" htmlFor="ws-notes" className="col-span-2"><Textarea {...bind("notes")} rows={2} /></Field>
          </div>
          <p className="text-xs text-subtle">Don't put passwords in notes — use the encrypted Credentials tab.</p>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" loading={save.isPending}>{website ? "Save" : "Add website"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------

export function WebsiteDetailPage() {
  const { id = "" } = useParams();
  const me = useMe();
  const { can } = useAuth();
  const navigate = useNavigate();
  const site = useWebsite(id);
  const check = useCheckWebsite(id);
  const remove = useDeleteWebsite();
  const [tab, setTab] = React.useState("overview");
  const [editing, setEditing] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const today = todayIn(me.timezone);

  if (site.isPending) return <Card className="p-6"><ListSkeleton rows={5} /></Card>;
  if (site.isError) return <Card><ErrorState error={site.error} onRetry={() => void site.refetch()} /></Card>;
  const w = site.data;
  const url = w.url ?? `https://${w.domain}`;

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-3"><Link to="/websites"><ArrowLeft /> Websites</Link></Button>
      <PageHeader
        title={w.domain}
        description={<span className="flex flex-wrap items-center gap-2"><UpBadge w={w} /><Badge tone={STATUS_TONE[w.status]}>{humanize(w.status)}</Badge><Link to={`/clients/record/${w.client_id}`} className="text-accent hover:underline">{w.client_name}</Link></span>}
        actions={
          <>
            <Button variant="secondary" onClick={() => openExternal(url)}><ExternalLink /> Visit</Button>
            <Button variant="secondary" loading={check.isPending} onClick={() => check.mutate(undefined)}>{!check.isPending && <RefreshCw />} Check now</Button>
            {can("websites.manage") && <Button variant="secondary" onClick={() => setEditing(true)}><Pencil /> Edit</Button>}
            {can("websites.manage") && <Button variant="ghost" size="icon" aria-label="Delete website" onClick={() => setDeleting(true)}><Trash2 /></Button>}
          </>
        }
      />
      {check.isError && <div className="mb-4"><FormAlert>{errorMessage(check.error)}</FormAlert></div>}
      <Tabs className="mb-4" value={tab} onChange={setTab} tabs={[
        { value: "overview", label: "Overview" },
        { value: "maintenance", label: "Maintenance", count: w.open_maintenance || undefined },
        ...(can("websites.secrets") ? [{ value: "credentials", label: "Credentials", count: w.secrets.length || undefined }] : []),
        { value: "monitoring", label: "Monitoring" },
        { value: "files", label: "Files" },
      ]} />
      {tab === "overview" && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Renewals" />
            <CardBody className="flex flex-col gap-3 text-sm">
              <div className="flex items-center justify-between"><span className="text-subtle">Domain{w.domain_registrar && ` · ${w.domain_registrar}`}</span><DueBadge date={w.domain_expires_on} today={today} /></div>
              <div className="flex items-center justify-between"><span className="text-subtle">Hosting{w.hosting_provider && ` · ${w.hosting_provider}`}</span><DueBadge date={w.hosting_renews_on} today={today} /></div>
              <div className="flex items-center justify-between"><span className="text-subtle">SSL certificate</span><DueBadge date={w.ssl_expires_on} today={today} /></div>
              <p className="text-xs text-subtle">Reminders go to the developer and account manager 30 and 7 days before each date.</p>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Details" />
            <CardBody className="flex flex-col gap-3 text-sm">
              <div className="flex justify-between"><span className="text-subtle">Developer</span><span>{w.developer_name ?? "—"}</span></div>
              <div className="flex justify-between"><span className="text-subtle">Maintenance</span><span>{humanize(w.maintenance_frequency)}{w.last_maintenance_at && ` · last ${formatRelative(w.last_maintenance_at)}`}</span></div>
              <div className="flex flex-wrap justify-between gap-2"><span className="text-subtle">Technology</span><span className="flex flex-wrap gap-1">{w.tech_stack.length ? w.tech_stack.map((t) => <Badge key={t}>{t}</Badge>) : "—"}</span></div>
              {w.backup_notes && <div><p className="text-subtle">Backups</p><p className="mt-0.5 text-muted">{w.backup_notes}</p></div>}
              {w.notes && <div><p className="text-subtle">Notes</p><p className="mt-0.5 whitespace-pre-wrap text-muted">{w.notes}</p></div>}
            </CardBody>
          </Card>
        </div>
      )}
      {tab === "maintenance" && <Card className="overflow-hidden"><MaintenanceList websiteId={w.id} /></Card>}
      {tab === "credentials" && <Credentials site={w} />}
      {tab === "monitoring" && <Monitoring site={w} />}
      {tab === "files" && <Card><CardBody className="pt-5"><FilesPanel target={{ bucket: "documents", entity_type: "website", entity_id: w.id }} canEdit={can("websites.manage")} /></CardBody></Card>}
      <WebsiteDialog open={editing} onOpenChange={setEditing} website={w} />
      <ConfirmDialog open={deleting} onOpenChange={setDeleting} title={`Delete ${w.domain}?`} description="Its maintenance history, credentials and checks are removed too." onConfirm={() => remove.mutateAsync(w.id).then(() => navigate("/websites"))} />
    </>
  );
}

function Monitoring({ site: w }: { site: WebsiteDetail }) {
  const me = useMe();
  const recent = w.checks.slice(0, 48).reverse();
  const max = Math.max(1, ...recent.map((c) => c.response_ms ?? 0));
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-4">
        <Card className="p-5"><p className="text-xs text-subtle">Uptime (7 days)</p><p className="mt-1 text-2xl font-semibold tabular-nums">{w.uptime_7d !== null ? `${w.uptime_7d}%` : "—"}</p></Card>
        <Card className="p-5"><p className="text-xs text-subtle">Avg response (24h)</p><p className="mt-1 text-2xl font-semibold tabular-nums">{w.avg_response_ms !== null ? `${Math.round(w.avg_response_ms)} ms` : "—"}</p></Card>
        <Card className="p-5"><p className="text-xs text-subtle">Last checked</p><p className="mt-1 text-2xl font-semibold">{w.last_checked_at ? formatRelative(w.last_checked_at) : "Never"}</p></Card>
      </div>
      <Card>
        <CardHeader title="Recent checks" description="Checked every 10 minutes while the site is active. Down alerts go to the developer and account manager." />
        <CardBody>
          {recent.length === 0 ? <EmptyState icon={Activity} title="No checks yet" description="Use “Check now”, or wait for the next automatic check." compact /> : (
            <>
              <div className="flex h-24 items-end gap-1" role="img" aria-label="Response times">
                {recent.map((c, i) => (
                  <div key={i} title={`${formatDate(c.checked_at, me.timezone)} ${formatTime(c.checked_at, me.timezone)} · ${c.ok ? `${c.response_ms} ms` : c.error ?? `HTTP ${c.status_code}`}`}
                    className={cn("flex-1 rounded-sm", c.ok ? "bg-accent/70" : "bg-danger")}
                    style={{ height: c.ok ? `${Math.max(8, ((c.response_ms ?? 0) / max) * 100)}%` : "100%" }} />
                ))}
              </div>
              <ul className="mt-4 divide-y divide-line/60 text-sm">
                {w.checks.slice(0, 10).map((c, i) => (
                  <li key={i} className="flex items-center gap-3 py-2">
                    {c.ok ? <Check className="size-4 text-success" /> : <Activity className="size-4 text-danger" />}
                    <span className="flex-1 text-muted">{c.ok ? `HTTP ${c.status_code} · ${c.response_ms} ms` : c.error ?? `HTTP ${c.status_code}`}</span>
                    <span className="text-xs text-subtle">{formatRelative(c.checked_at)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function Credentials({ site: w }: { site: WebsiteDetail }) {
  const { can } = useAuth();
  const m = useSecretMutations(w.id);
  const [editing, setEditing] = React.useState<WebsiteDetail["secrets"][number] | "new" | null>(null);
  const [shown, setShown] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState<string | null>(null);
  const [deleting, setDeleting] = React.useState<string | null>(null);

  if (!w.vault_configured) {
    return <Card><EmptyState icon={Lock} title="The credential vault isn't set up" description="An administrator needs to set SECRETS_KEY on the API server before credentials can be stored." /></Card>;
  }
  async function reveal(id: string) {
    if (shown[id]) return setShown(({ [id]: _, ...rest }) => rest);
    setBusy(id);
    setError(null);
    try {
      const { secret } = await revealSecret(id);
      setShown((s) => ({ ...s, [id]: secret }));
      setTimeout(() => setShown(({ [id]: _, ...rest }) => rest), 30_000);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }
  return (
    <Card>
      <CardHeader
        title={<span className="flex items-center gap-2"><ShieldCheck className="size-4 text-success" /> Credentials</span>}
        description="Encrypted with AES-256-GCM before they're stored. Every reveal is recorded in the activity log, and hides again after 30 seconds."
        action={can("websites.manage") && <Button size="sm" variant="secondary" onClick={() => setEditing("new")}><Plus /> Add</Button>}
      />
      <CardBody>
        {error && <p className="mb-2 text-sm text-danger">{error}</p>}
        {w.secrets.length === 0 ? <EmptyState icon={KeyRound} title="No credentials stored" description="WordPress admin, hosting panel, FTP, domain registrar…" compact /> : (
          <ul className="divide-y divide-line/60">
            {w.secrets.map((s) => (
              <li key={s.id} className="flex items-center gap-3 py-3">
                <KeyRound className="size-4 shrink-0 text-subtle" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{s.label}</p>
                  <p className="truncate text-xs text-subtle">{[s.username, s.login_url].filter(Boolean).join(" · ") || "—"}</p>
                  <p className="mt-1 font-mono text-sm">{shown[s.id] ?? "••••••••••••"}</p>
                </div>
                {s.login_url && <Button variant="ghost" size="icon-sm" aria-label="Open login page" onClick={() => openExternal(s.login_url!)}><ExternalLink /></Button>}
                <Button variant="ghost" size="icon-sm" aria-label={shown[s.id] ? "Hide" : "Reveal"} loading={busy === s.id} onClick={() => void reveal(s.id)}>{busy !== s.id && (shown[s.id] ? <EyeOff /> : <Eye />)}</Button>
                {shown[s.id] && (
                  <Button variant="ghost" size="icon-sm" aria-label="Copy" onClick={() => navigator.clipboard.writeText(shown[s.id]!).then(() => { setCopied(s.id); setTimeout(() => setCopied(null), 1500); }).catch(() => undefined)}>
                    {copied === s.id ? <Check /> : <Copy />}
                  </Button>
                )}
                {can("websites.manage") && <Button variant="ghost" size="icon-sm" aria-label="Edit" onClick={() => setEditing(s)}><Pencil /></Button>}
                {can("websites.manage") && <Button variant="ghost" size="icon-sm" aria-label="Delete" onClick={() => setDeleting(s.id)}><Trash2 /></Button>}
              </li>
            ))}
          </ul>
        )}
      </CardBody>
      {editing && <SecretDialog secret={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} onSave={(b) => (editing === "new" ? m.add.mutateAsync(b) : m.update.mutateAsync({ ...b, id: editing.id }))} />}
      <ConfirmDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)} title="Delete this credential?" description="It can't be recovered." onConfirm={() => m.remove.mutateAsync(deleting!)} />
    </Card>
  );
}

function SecretDialog({ secret, onClose, onSave }: { secret?: WebsiteDetail["secrets"][number]; onClose: () => void; onSave: (b: { label: string; login_url: string | null; username: string | null; secret: string | null }) => Promise<unknown> }) {
  const [f, setF] = React.useState({ label: secret?.label ?? "", login_url: secret?.login_url ?? "", username: secret?.username ?? "", secret: "" });
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={secret ? "Edit credential" : "Add a credential"} className="max-w-md">
        <form className="flex flex-col gap-4" onSubmit={async (e) => {
          e.preventDefault();
          if (!f.label.trim()) return setError("Give it a label.");
          if (!secret && !f.secret) return setError("Enter the password or key.");
          setBusy(true);
          setError(null);
          try {
            await onSave({ label: f.label.trim(), login_url: f.login_url || null, username: f.username || null, secret: f.secret || null });
            onClose();
          } catch (err) {
            setError(errorMessage(err));
          } finally {
            setBusy(false);
          }
        }}>
          {error && <FormAlert>{error}</FormAlert>}
          <Field label="Label" htmlFor="sec-label"><Input id="sec-label" autoFocus value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} placeholder="WordPress admin, cPanel, FTP…" /></Field>
          <Field label="Login URL" htmlFor="sec-url"><Input id="sec-url" value={f.login_url} onChange={(e) => setF({ ...f, login_url: e.target.value })} /></Field>
          <Field label="Username" htmlFor="sec-user"><Input id="sec-user" autoComplete="off" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} /></Field>
          <Field label={secret ? "New password (leave blank to keep)" : "Password / key"} htmlFor="sec-secret">
            <PasswordInput id="sec-secret" autoComplete="new-password" value={f.secret} onChange={(e) => setF({ ...f, secret: e.target.value })} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={busy}>Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------

function MaintenanceList({ websiteId, assigneeMe }: { websiteId?: string; assigneeMe?: boolean }) {
  const { can } = useAuth();
  const [status, setStatus] = React.useState("open");
  const items = useMaintenance({ website_id: websiteId, status, assignee: assigneeMe ? "me" : undefined });
  const m = useMaintenanceMutations(websiteId);
  const [editing, setEditing] = React.useState<Maintenance | "new" | null>(null);
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line p-4">
        <Tabs value={status} onChange={setStatus} tabs={[{ value: "open", label: "To do" }, { value: "done", label: "Done" }, { value: "all", label: "All" }]} />
        {websiteId && can("websites.manage") && <Button size="sm" variant="secondary" onClick={() => setEditing("new")}><Plus /> Log / schedule</Button>}
      </div>
      {items.isError ? <ErrorState error={items.error} onRetry={() => void items.refetch()} />
        : items.isPending ? <div className="p-6"><ListSkeleton rows={3} /></div>
        : items.data.length === 0 ? <EmptyState icon={Wrench} title={status === "open" ? "Nothing scheduled" : "No maintenance history"} description="Plugin updates, backups, security checks and renewals are tracked here." />
        : (
          <ul className="divide-y divide-line/60">
            {items.data.map((x) => (
              <li key={x.id} className="group flex items-center gap-3 px-5 py-3">
                {x.status === "scheduled" || x.status === "in_progress" ? (
                  can("websites.manage") ? (
                    <button aria-label={`Mark “${x.title}” done`} onClick={() => m.update.mutate({ id: x.id, task_type: x.task_type, title: x.title, notes: x.notes, scheduled_for: x.scheduled_for, assigned_to: x.assigned_to, status: "done" })}
                      className="flex size-6 shrink-0 items-center justify-center rounded-full border border-line-strong text-transparent hover:border-success hover:text-success"><Check className="size-3.5" /></button>
                  ) : <span className="size-6" />
                ) : <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-success-soft text-success"><Check className="size-3.5" /></span>}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{x.title}</p>
                  <p className="truncate text-xs text-subtle">
                    {!websiteId && <><Link to={`/websites/record/${x.website_id}`} className="text-accent hover:underline">{x.domain}</Link> · </>}
                    {MAINTENANCE_TYPES[x.task_type] ?? x.task_type}
                    {x.completed_at ? ` · done ${formatRelative(x.completed_at)}${x.completed_by_name ? ` by ${x.completed_by_name}` : ""}` : x.scheduled_for ? ` · ${formatPlainDate(x.scheduled_for, { month: "short", day: "numeric" })}` : ""}
                    {x.assigned_name && !x.completed_at && ` · ${x.assigned_name}`}
                  </p>
                </div>
                {x.overdue && <Badge tone="danger">Overdue</Badge>}
                {can("websites.manage") && <Button variant="ghost" size="icon-sm" className="opacity-0 group-hover:opacity-100 focus:opacity-100" aria-label="Edit" onClick={() => setEditing(x)}><Pencil /></Button>}
              </li>
            ))}
          </ul>
        )}
      {editing && (
        <MaintenanceDialog item={editing === "new" ? undefined : editing} onClose={() => setEditing(null)}
          onSave={(b) => (editing === "new" ? m.add.mutateAsync(b) : m.update.mutateAsync({ ...b, id: editing.id }))}
          onDelete={editing !== "new" ? () => m.remove.mutateAsync(editing.id) : undefined} />
      )}
    </>
  );
}

function MaintenanceDialog({ item, onClose, onSave, onDelete }: { item?: Maintenance; onClose: () => void; onSave: (b: MaintenanceInput) => Promise<unknown>; onDelete?: () => Promise<unknown> }) {
  const lookups = useLookups();
  const [f, setF] = React.useState({ task_type: item?.task_type ?? "plugin_update", title: item?.title ?? "", notes: item?.notes ?? "", status: item?.status ?? "scheduled", scheduled_for: item?.scheduled_for ?? new Date().toISOString().slice(0, 10), assigned_to: item?.assigned_to ?? "" });
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try { await fn(); onClose(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={item ? "Maintenance task" : "Log or schedule maintenance"} className="max-w-lg">
        <form className="flex flex-col gap-4" onSubmit={(e) => {
          e.preventDefault();
          void run(() => onSave({ ...f, title: f.title.trim() || MAINTENANCE_TYPES[f.task_type]!, notes: f.notes || null, scheduled_for: f.scheduled_for || null, assigned_to: f.assigned_to || null }));
        }}>
          {error && <FormAlert>{error}</FormAlert>}
          <div className="grid grid-cols-2 gap-4">
            <Field label="Type" htmlFor="mt-type"><Select id="mt-type" value={f.task_type} onChange={(e) => setF({ ...f, task_type: e.target.value })}>{Object.entries(MAINTENANCE_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
            <Field label="Status" htmlFor="mt-status"><Select id="mt-status" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as typeof f.status })}>
              <option value="scheduled">Scheduled</option><option value="in_progress">In progress</option><option value="done">Done</option><option value="skipped">Skipped</option>
            </Select></Field>
            <Field label="Title" htmlFor="mt-title" className="col-span-2"><Input id="mt-title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder={MAINTENANCE_TYPES[f.task_type]} /></Field>
            <Field label="Date" htmlFor="mt-date"><Input id="mt-date" type="date" value={f.scheduled_for} onChange={(e) => setF({ ...f, scheduled_for: e.target.value })} /></Field>
            <Field label="Assigned to" htmlFor="mt-assign"><Select id="mt-assign" value={f.assigned_to} onChange={(e) => setF({ ...f, assigned_to: e.target.value })}><option value="">Site developer</option>{lookups.data?.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select></Field>
            <Field label="Notes" htmlFor="mt-notes" className="col-span-2"><Textarea id="mt-notes" rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
          </div>
          <DialogFooter>
            {onDelete && <Button type="button" variant="ghost" className="mr-auto text-[#fca5a5]" onClick={() => void run(onDelete)}><Trash2 /> Delete</Button>}
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={busy}>Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function MaintenancePage() {
  const [mine, setMine] = React.useState(false);
  return (
    <>
      <PageHeader title="Website maintenance" description="Scheduled and completed maintenance across every client site. Log new work from a website's page." />
      <Tabs className="mb-4" value={mine ? "mine" : "all"} onChange={(v) => setMine(v === "mine")} tabs={[{ value: "all", label: "Everyone" }, { value: "mine", label: "Mine" }]} />
      <Card className="overflow-hidden"><MaintenanceList key={String(mine)} assigneeMe={mine} /></Card>
    </>
  );
}

/** Domain, hosting or SSL renewals as a focused table. */
function RenewalsTable({ field, title, description, icon: Icon }: { field: "domain_expires_on" | "hosting_renews_on" | "ssl_expires_on"; title: string; description: string; icon: LucideIcon }) {
  const me = useMe();
  const navigate = useNavigate();
  const today = todayIn(me.timezone);
  const sites = useWebsites({});
  const rows = [...(sites.data ?? [])].sort((a, b) => (a[field] ?? "9999").localeCompare(b[field] ?? "9999"));
  return (
    <>
      <PageHeader title={title} description={description} />
      <Card className="overflow-hidden">
        {sites.isError ? <ErrorState error={sites.error} onRetry={() => void sites.refetch()} />
          : sites.isPending ? <div className="p-6"><ListSkeleton rows={4} /></div>
          : rows.length === 0 ? <EmptyState icon={Icon} title="No websites yet" />
          : (
            <ul className="divide-y divide-line/60">
              {rows.map((w) => (
                <li key={w.id} onClick={() => navigate(`/websites/record/${w.id}`)} className="flex cursor-pointer items-center gap-4 px-5 py-3.5 hover:bg-raised/40">
                  <Icon className="size-4 text-subtle" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{w.domain}</p>
                    <p className="truncate text-xs text-subtle">{w.client_name}{field === "domain_expires_on" && w.domain_registrar && ` · ${w.domain_registrar}`}{field === "hosting_renews_on" && w.hosting_provider && ` · ${w.hosting_provider}`}</p>
                  </div>
                  <DueBadge date={w[field]} today={today} />
                </li>
              ))}
            </ul>
          )}
      </Card>
    </>
  );
}

export const DomainsPage = () => <RenewalsTable field="domain_expires_on" title="Domain management" description="Domain expiry dates, soonest first. Reminders are sent at 30 and 7 days." icon={Globe} />;
export const HostingPage = () => <RenewalsTable field="hosting_renews_on" title="Hosting information" description="Hosting providers and renewal dates, soonest first." icon={Server} />;

export function MonitoringPage() {
  const navigate = useNavigate();
  const sites = useWebsites({ status: "active" });
  const rows = [...(sites.data ?? [])].sort((a, b) => Number(a.is_up ?? 2) - Number(b.is_up ?? 2));
  const down = rows.filter((w) => w.is_up === false).length;
  return (
    <>
      <PageHeader title="Website monitoring" description="Active sites are checked every 10 minutes. The developer and account manager are alerted when a site goes down." />
      {down > 0 && <div className="mb-4"><FormAlert>{down} site{down === 1 ? " is" : "s are"} down right now.</FormAlert></div>}
      <Card className="overflow-hidden">
        {sites.isError ? <ErrorState error={sites.error} onRetry={() => void sites.refetch()} />
          : sites.isPending ? <div className="p-6"><ListSkeleton rows={4} /></div>
          : rows.length === 0 ? <EmptyState icon={Activity} title="No active websites" />
          : (
            <ul className="divide-y divide-line/60">
              {rows.map((w) => (
                <li key={w.id} onClick={() => navigate(`/websites/record/${w.id}`)} className="flex cursor-pointer items-center gap-4 px-5 py-3.5 hover:bg-raised/40">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{w.domain}</p>
                    <p className="truncate text-xs text-subtle">{w.client_name} · {w.last_checked_at ? `checked ${formatRelative(w.last_checked_at)}` : "not checked yet"}</p>
                  </div>
                  <span className="w-24 text-right text-xs tabular-nums text-muted">{w.avg_response_ms !== null ? `${Math.round(w.avg_response_ms)} ms` : "—"}</span>
                  <span className="w-20 text-right text-xs tabular-nums text-muted">{w.uptime_7d !== null ? `${w.uptime_7d}%` : "—"}</span>
                  <UpBadge w={w} />
                </li>
              ))}
            </ul>
          )}
      </Card>
    </>
  );
}
