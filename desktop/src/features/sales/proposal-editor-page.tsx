import {
  ArrowLeft,
  Download,
  GripVertical,
  Plus,
  RotateCcw,
  Save,
  Send,
  ThumbsDown,
  Trash2,
  Trophy,
  UserPlus,
} from "lucide-react";
import * as React from "react";
import { Link, useNavigate, useParams } from "react-router";

import { PageHeader } from "@/components/layout/app-shell";
import { ErrorState, ListSkeleton } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TagInput, Textarea } from "@/components/ui/form-controls";
import { Field, Input, Select } from "@/components/ui/input";
import { useAuth, useMe } from "@/features/auth/auth-context";
import { FormAlert } from "@/features/auth/auth-layout";
import { useLookups } from "@/features/leads/api";
import { CURRENCIES } from "@/features/leads/lead-form";
import { ApiError, errorMessage } from "@/lib/api";
import { formatDate, formatMoney } from "@/lib/format";
import type { BillingType, ProposalDetail, ProposalItem } from "@/types/sales";
import { BILLING_LABELS } from "@/types/sales";

import { useDeleteProposal, useDuplicateProposal, useProposal, useProposalStatus, useSaveProposal } from "./api";
import { ConvertDialog } from "./dialogs";
import { downloadProposalPdf } from "./proposal-pdf";
import { PROPOSAL_LABEL, PROPOSAL_TONE } from "./proposals-page";

interface Draft {
  title: string;
  currency: string;
  discount_type: "none" | "percent" | "fixed";
  discount_value: string;
  tax_rate: string;
  valid_until: string;
  introduction: string;
  terms: string;
  items: (Omit<ProposalItem, "quantity" | "unit_price"> & { quantity: string; unit_price: string; key: string })[];
}

const DEFAULT_TERMS = `• 50% down payment to start; balance due on delivery.
• Monthly services are billed at the start of each month and can be cancelled with 30 days' notice.
• Prices exclude third-party costs (ad spend, domains, hosting) unless listed.
• This proposal is valid until the date shown above.`;

function toDraft(p: ProposalDetail): Draft {
  return {
    title: p.title,
    currency: p.currency,
    discount_type: p.discount_type,
    discount_value: String(Number(p.discount_value)),
    tax_rate: String(Number(p.tax_rate)),
    valid_until: p.valid_until ?? "",
    introduction: p.introduction ?? "",
    terms: p.terms ?? "",
    items: p.items.map((i, n) => ({ ...i, quantity: String(Number(i.quantity)), unit_price: String(Number(i.unit_price)), key: `${n}-${i.name}` })),
  };
}

/** Same math as the API, for an instant preview; the API's totals are authoritative. */
function preview(d: Draft) {
  const round = (n: number) => Math.round(n * 100) / 100;
  const subtotal = d.items.reduce((s, i) => s + round((Number(i.quantity) || 0) * (Number(i.unit_price) || 0)), 0);
  const dv = Number(d.discount_value) || 0;
  const discount = d.discount_type === "percent" ? round((subtotal * Math.min(dv, 100)) / 100) : d.discount_type === "fixed" ? Math.min(dv, subtotal) : 0;
  const tax = round(((subtotal - discount) * (Number(d.tax_rate) || 0)) / 100);
  return { subtotal, discount, tax, total: subtotal - discount + tax };
}

export function ProposalEditorPage() {
  const { id = "" } = useParams();
  const proposal = useProposal(id);
  if (proposal.isPending) return <Card className="p-6"><ListSkeleton rows={6} /></Card>;
  if (proposal.isError) return <Card><ErrorState error={proposal.error} onRetry={() => void proposal.refetch()} /></Card>;
  return <Editor key={`${proposal.data.id}-${proposal.data.current_version}-${proposal.data.status}`} proposal={proposal.data} />;
}

function Editor({ proposal: p }: { proposal: ProposalDetail }) {
  const me = useMe();
  const { can } = useAuth();
  const navigate = useNavigate();
  const lookups = useLookups();
  const save = useSaveProposal(p.id);
  const status = useProposalStatus(p.id);
  const duplicate = useDuplicateProposal();
  const remove = useDeleteProposal();
  const [draft, setDraft] = React.useState<Draft>(() => toDraft(p));
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [deleting, setDeleting] = React.useState(false);
  const [converting, setConverting] = React.useState(false);
  const [pdfError, setPdfError] = React.useState<string | null>(null);

  const editable = can("proposals.manage") && (p.is_template || p.status === "draft" || p.status === "ready");
  const dirty = JSON.stringify(toDraft(p)) !== JSON.stringify(draft);
  const totals = preview(draft);
  const currency = draft.currency;
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const setItem = (key: string, patch: Partial<Draft["items"][number]>) =>
    setDraft((d) => ({ ...d, items: d.items.map((i) => (i.key === key ? { ...i, ...patch } : i)) }));

  function addItem(service?: { id: string; name: string }) {
    setDraft((d) => ({
      ...d,
      items: [
        ...d.items,
        { key: crypto.randomUUID(), service_id: service?.id ?? null, name: service?.name ?? "", description: null, deliverables: [], quantity: "1", unit_price: "0", billing_type: "one_time" as BillingType },
      ],
    }));
  }

  /** Saves the draft; resolves to the saved proposal, or null if validation failed. */
  async function persist(): Promise<ProposalDetail | null> {
    setErrors({});
    try {
      return await save.mutateAsync({
        title: draft.title,
        currency: draft.currency,
        discount_type: draft.discount_type,
        discount_value: draft.discount_value || "0",
        tax_rate: draft.tax_rate || "0",
        valid_until: draft.valid_until || null,
        introduction: draft.introduction || null,
        terms: draft.terms || null,
        items: draft.items.map(({ key: _k, ...i }) => ({ ...i, quantity: i.quantity || "0", unit_price: i.unit_price || "0" })),
      });
    } catch (e) {
      if (e instanceof ApiError) setErrors(e.fields);
      return null;
    }
  }

  async function changeStatus(next: string) {
    if (dirty && editable && !(await persist())) return;
    status.mutate(next);
  }

  const failure = save.error ?? status.error ?? duplicate.error ?? remove.error;

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-3">
        <Link to="/sales/proposals"><ArrowLeft /> Proposals</Link>
      </Button>
      <PageHeader
        title={p.is_template ? draft.title || "Untitled template" : `${p.number}, ${p.recipient.company_name ?? ""}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {p.is_template ? <Badge tone="accent">Template</Badge> : <Badge tone={PROPOSAL_TONE[p.status]} dot>{PROPOSAL_LABEL[p.status]}</Badge>}
            {!p.is_template && <span>Version {p.current_version}</span>}
            {p.sent_at && <span>· sent {formatDate(p.sent_at, me.timezone, { year: "numeric" })}</span>}
            {p.lead_id && <Link to={`/leads/record/${p.lead_id}`} className="text-accent hover:underline">· Open lead</Link>}
          </span>
        }
        actions={
          <>
            {!p.is_template && (
              <Button
                variant="secondary"
                onClick={async () => {
                  setPdfError(null);
                  try {
                    let latest: ProposalDetail | null = p;
                    if (dirty && editable) latest = await persist();
                    if (latest) await downloadProposalPdf(latest, { name: me.full_name, email: me.email });
                  } catch (e) {
                    setPdfError(errorMessage(e));
                  }
                }}
              >
                <Download /> PDF
              </Button>
            )}
            {can("proposals.manage") && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild><Button variant="secondary">More</Button></DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => duplicate.mutate({ id: p.id, as_template: false }, { onSuccess: (n) => navigate(`/sales/proposals/${n.id}`) })}>Duplicate
                  </DropdownMenuItem>
                  {!p.is_template && (
                    <DropdownMenuItem onSelect={() => duplicate.mutate({ id: p.id, as_template: true }, { onSuccess: (n) => navigate(`/sales/proposals/${n.id}`) })}>Save as template
                    </DropdownMenuItem>
                  )}
                  {p.status !== "accepted" && <DropdownMenuItem destructive onSelect={() => setDeleting(true)}>Delete</DropdownMenuItem>}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {editable && (
              <Button variant={p.is_template ? "primary" : "secondary"} onClick={() => void persist()} loading={save.isPending} disabled={!dirty}>
                {!save.isPending && <Save />} {dirty ? "Save" : "Saved"}
              </Button>
            )}
            {!p.is_template && can("proposals.manage") && <StatusActions proposal={p} busy={status.isPending} onChange={(s) => void changeStatus(s)} onConvert={() => setConverting(true)} />}
          </>
        }
      />
      {failure && !(failure instanceof ApiError && failure.code === "validation_failed") && <div className="mb-4"><FormAlert>{errorMessage(failure)}</FormAlert></div>}
      {pdfError && <div className="mb-4"><FormAlert>{pdfError}</FormAlert></div>}
      {!editable && !p.is_template && (
        <div className="mb-4"><FormAlert tone="info">This proposal was sent, so it's locked. Use “Revise” to make a new version.</FormAlert></div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardBody className="flex flex-col gap-4 pt-5">
              <Field label="Title" htmlFor="pp-title" error={errors.title}>
                <Input id="pp-title" disabled={!editable} value={draft.title} onChange={(e) => set("title", e.target.value)} />
              </Field>
              <Field label="Introduction" htmlFor="pp-intro" hint="A short, personal opening: what you understood about their business and goals.">
                <Textarea id="pp-intro" disabled={!editable} rows={4} value={draft.introduction} onChange={(e) => set("introduction", e.target.value)} />
              </Field>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Services & pricing"
              action={
                editable && (
                  <>
                    {lookups.data?.services.length ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild><Button variant="secondary" size="sm"><Plus /> From services</Button></DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="max-h-72 overflow-y-auto">
                          {lookups.data.services.map((s) => <DropdownMenuItem key={s.id} onSelect={() => addItem(s)}>{s.name}</DropdownMenuItem>)}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : null}
                    <Button variant="secondary" size="sm" onClick={() => addItem()}><Plus /> Add line</Button>
                  </>
                )
              }
            />
            <CardBody>
              {draft.items.length === 0 ? (
                <p className="rounded-control border border-dashed border-line py-8 text-center text-sm text-subtle">No services yet. Add a line to start pricing.</p>
              ) : (
                <div className="flex flex-col gap-3">
                  {draft.items.map((item, idx) => (
                    <div key={item.key} className="rounded-control border border-line bg-raised/30 p-3">
                      <div className="grid grid-cols-[20px_minmax(0,1fr)_120px_80px_120px_110px_36px] items-start gap-2">
                        <GripVertical className="mt-3 size-4 text-subtle" />
                        <Input aria-label="Service name" disabled={!editable} value={item.name} placeholder="Service" onChange={(e) => setItem(item.key, { name: e.target.value })} aria-invalid={!!errors[`items.${idx}.name`]} />
                        <Select aria-label="Billing" disabled={!editable} value={item.billing_type} onChange={(e) => setItem(item.key, { billing_type: e.target.value as BillingType })}>
                          {(Object.keys(BILLING_LABELS) as BillingType[]).map((b) => <option key={b} value={b}>{BILLING_LABELS[b]}</option>)}
                        </Select>
                        <Input aria-label="Quantity" disabled={!editable} inputMode="decimal" value={item.quantity} onChange={(e) => setItem(item.key, { quantity: e.target.value })} className="text-right" />
                        <Input aria-label="Unit price" disabled={!editable} inputMode="decimal" value={item.unit_price} onChange={(e) => setItem(item.key, { unit_price: e.target.value })} className="text-right" />
                        <p className="mt-2.5 text-right text-sm tabular-nums">{formatMoney((Number(item.quantity) || 0) * (Number(item.unit_price) || 0), currency)}</p>
                        {editable ? (
                          <Button variant="ghost" size="icon" aria-label="Remove line" onClick={() => setDraft((d) => ({ ...d, items: d.items.filter((i) => i.key !== item.key) }))}>
                            <Trash2 />
                          </Button>
                        ) : <span />}
                      </div>
                      <div className="mt-2 grid grid-cols-[20px_minmax(0,1fr)_minmax(0,1fr)_36px] gap-2">
                        <span />
                        <Input aria-label="Description" disabled={!editable} value={item.description ?? ""} placeholder="Description (optional)" onChange={(e) => setItem(item.key, { description: e.target.value || null })} />
                        <TagInput value={item.deliverables} onChange={(v) => editable && setItem(item.key, { deliverables: v })} placeholder="Deliverables, e.g. 12 posts/month" />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardBody className="pt-5">
              <Field label="Terms & conditions" htmlFor="pp-terms">
                <Textarea id="pp-terms" disabled={!editable} rows={6} value={draft.terms} onChange={(e) => set("terms", e.target.value)} placeholder={DEFAULT_TERMS} />
              </Field>
              {editable && !draft.terms && (
                <Button variant="link" size="sm" className="mt-2" onClick={() => set("terms", DEFAULT_TERMS)}>Use standard terms</Button>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="flex flex-col gap-4 self-start">
          <Card>
            <CardHeader title="Pricing" />
            <CardBody className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Currency" htmlFor="pp-cur">
                  <Select id="pp-cur" disabled={!editable} value={draft.currency} onChange={(e) => set("currency", e.target.value)}>
                    {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
                  </Select>
                </Field>
                {!p.is_template && (
                  <Field label="Valid until" htmlFor="pp-valid">
                    <Input id="pp-valid" type="date" disabled={!editable} value={draft.valid_until} onChange={(e) => set("valid_until", e.target.value)} />
                  </Field>
                )}
                <Field label="Discount" htmlFor="pp-dt">
                  <Select id="pp-dt" disabled={!editable} value={draft.discount_type} onChange={(e) => set("discount_type", e.target.value as Draft["discount_type"])}>
                    <option value="none">None</option><option value="percent">Percent</option><option value="fixed">Fixed amount</option>
                  </Select>
                </Field>
                <Field label={draft.discount_type === "percent" ? "Discount %" : "Amount"} htmlFor="pp-dv" error={errors.discount_value}>
                  <Input id="pp-dv" disabled={!editable || draft.discount_type === "none"} inputMode="decimal" value={draft.discount_value} onChange={(e) => set("discount_value", e.target.value)} />
                </Field>
                <Field label="Tax %" htmlFor="pp-tax" error={errors.tax_rate} hint="e.g. 12 for VAT">
                  <Input id="pp-tax" disabled={!editable} inputMode="decimal" value={draft.tax_rate} onChange={(e) => set("tax_rate", e.target.value)} />
                </Field>
              </div>
              <dl className="mt-2 flex flex-col gap-2 border-t border-line pt-4 text-sm">
                <Row label="Subtotal" value={formatMoney(totals.subtotal, currency)} />
                {totals.discount > 0 && <Row label="Discount" value={`− ${formatMoney(totals.discount, currency)}`} />}
                {totals.tax > 0 && <Row label={`Tax (${Number(draft.tax_rate)}%)`} value={formatMoney(totals.tax, currency)} />}
                <div className="mt-1 flex items-center justify-between border-t border-line pt-3">
                  <dt className="font-medium">Total</dt>
                  <dd className="text-xl font-semibold tabular-nums">{formatMoney(totals.total, currency)}</dd>
                </div>
              </dl>
            </CardBody>
          </Card>
          {!p.is_template && (
            <Card>
              <CardHeader title="Prepared for" />
              <CardBody className="text-sm">
                <p className="font-medium">{p.recipient.company_name}</p>
                {p.recipient.contact_name && <p className="text-muted">{p.recipient.contact_name}{p.recipient.contact_position && `, ${p.recipient.contact_position}`}</p>}
                <p className="text-subtle">{[p.recipient.contact_email, p.recipient.contact_phone].filter(Boolean).join(", ")}</p>
              </CardBody>
            </Card>
          )}
          {p.versions.length > 0 && (
            <Card>
              <CardHeader title="Versions sent" />
              <CardBody>
                <ul className="flex flex-col gap-2 text-sm">
                  {p.versions.map((v) => (
                    <li key={v.version} className="flex justify-between text-muted">
                      <span>Version {v.version}</span>
                      <span className="text-subtle">{formatDate(v.created_at, me.timezone, { year: "numeric" })}, {v.created_by_name}</span>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title="Delete this proposal?"
        description={p.title}
        onConfirm={() => remove.mutateAsync(p.id).then(() => navigate("/sales/proposals"))}
      />
      {p.lead_id && (
        <ConvertDialog
          open={converting}
          onOpenChange={setConverting}
          leadId={p.lead_id}
          leadName={p.recipient.company_name ?? p.title}
          dealId={p.deal_id}
          proposalId={p.id}
          presetServices={p.items.map((i) => ({ service_id: i.service_id, name: i.name, price: String(Number(i.quantity) * Number(i.unit_price)), currency: p.currency, billing_type: i.billing_type }))}
        />
      )}
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-muted">
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

function StatusActions({ proposal: p, busy, onChange, onConvert }: { proposal: ProposalDetail; busy: boolean; onChange: (s: string) => void; onConvert: () => void }) {
  switch (p.status) {
    case "draft":
      return (
        <>
          <Button variant="secondary" loading={busy} onClick={() => onChange("ready")}>Mark ready</Button>
          <Button loading={busy} onClick={() => onChange("sent")}>{!busy && <Send />} Mark sent</Button>
        </>
      );
    case "ready":
      return <Button loading={busy} onClick={() => onChange("sent")}>{!busy && <Send />} Mark sent</Button>;
    case "sent":
    case "expired":
      return (
        <>
          <Button variant="secondary" loading={busy} onClick={() => onChange("revise")}><RotateCcw /> Revise</Button>
          <Button variant="secondary" loading={busy} onClick={() => onChange("rejected")}><ThumbsDown /> Rejected</Button>
          <Button loading={busy} onClick={() => onChange("accepted")}>{!busy && <Trophy />} Accepted</Button>
        </>
      );
    case "accepted":
      return (
        <>
          <Button variant="secondary" loading={busy} onClick={() => onChange("revise")}><RotateCcw /> Revise</Button>
          {p.lead_id && <Button onClick={onConvert}><UserPlus /> Convert to client</Button>}
        </>
      );
    case "rejected":
      return <Button variant="secondary" loading={busy} onClick={() => onChange("revise")}><RotateCcw /> Revise</Button>;
  }
}
