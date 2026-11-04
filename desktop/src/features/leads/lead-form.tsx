import { TriangleAlert } from "lucide-react";
import * as React from "react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { TagInput, Textarea } from "@/components/ui/form-controls";
import { Field, Input, Select } from "@/components/ui/input";
import { FormAlert } from "@/features/auth/auth-layout";
import { useMe } from "@/features/auth/auth-context";
import { ApiError, errorMessage } from "@/lib/api";
import { fromLocalInput, toLocalInput, tomorrowMorning } from "@/lib/dates";
import type { DuplicateMatch, Lead, LeadInput, Market } from "@/types/leads";

import { useCreateLead, useLookups, useUpdateLead } from "./api";

export const SERVICE_SUGGESTIONS = [
  "Social media management",
  "Content creation",
  "Graphic design",
  "Branding",
  "Website development",
  "Website maintenance",
  "SEO",
  "Paid ads",
  "Photography / video",
];

export const CURRENCIES = ["PHP", "USD", "AUD", "GBP", "CAD", "EUR", "SGD"];

type FormState = Record<
  | "business_name" | "industry" | "category" | "country" | "region" | "city" | "address" | "website_url"
  | "facebook_url" | "instagram_url" | "linkedin_url" | "google_maps_url" | "business_phone" | "business_email"
  | "contact_name" | "contact_position" | "contact_email" | "contact_phone" | "source_id" | "source_detail"
  | "stage_id" | "status" | "priority" | "assigned_to" | "estimated_value" | "currency" | "research_notes"
  | "next_action" | "next_action_due_at" | "lost_reason",
  string
> & { market: Market; potential_services: string[] };

function initialState(lead: Lead | undefined, market: Market, me: string): FormState {
  const s = (v: string | null | undefined) => v ?? "";
  return {
    business_name: s(lead?.business_name),
    market: lead?.market ?? market,
    industry: s(lead?.industry),
    category: s(lead?.category),
    country: lead ? s(lead.country) : market === "local" ? "Philippines" : "",
    region: lead ? s(lead.region) : market === "local" ? "Cebu" : "",
    city: s(lead?.city),
    address: s(lead?.address),
    website_url: s(lead?.website_url),
    facebook_url: s(lead?.facebook_url),
    instagram_url: s(lead?.instagram_url),
    linkedin_url: s(lead?.linkedin_url),
    google_maps_url: s(lead?.google_maps_url),
    business_phone: s(lead?.business_phone),
    business_email: s(lead?.business_email),
    contact_name: s(lead?.contact_name),
    contact_position: s(lead?.contact_position),
    contact_email: s(lead?.contact_email),
    contact_phone: s(lead?.contact_phone),
    source_id: s(lead?.source_id),
    source_detail: s(lead?.source_detail),
    stage_id: s(lead?.stage_id),
    status: lead?.status ?? "active",
    priority: lead?.priority ?? "medium",
    assigned_to: lead ? s(lead.assigned_to) : me,
    potential_services: lead?.potential_services ?? [],
    estimated_value: s(lead?.estimated_value),
    currency: lead?.currency ?? (market === "local" ? "PHP" : "USD"),
    research_notes: s(lead?.research_notes),
    next_action: lead ? s(lead.next_action) : "Research the business",
    next_action_due_at: lead ? toLocalInput(lead.next_action_due_at) : tomorrowMorning(),
    lost_reason: s(lead?.lost_reason),
  };
}

function toInput(f: FormState): LeadInput {
  const n = (v: string) => (v.trim() ? v.trim() : null);
  return {
    business_name: f.business_name.trim(),
    market: f.market,
    industry: n(f.industry),
    category: n(f.category),
    country: n(f.country),
    region: n(f.region),
    city: n(f.city),
    address: n(f.address),
    website_url: n(f.website_url),
    facebook_url: n(f.facebook_url),
    instagram_url: n(f.instagram_url),
    linkedin_url: n(f.linkedin_url),
    google_maps_url: n(f.google_maps_url),
    business_phone: n(f.business_phone),
    business_email: n(f.business_email),
    contact_name: n(f.contact_name),
    contact_position: n(f.contact_position),
    contact_email: n(f.contact_email),
    contact_phone: n(f.contact_phone),
    source_id: n(f.source_id),
    source_detail: n(f.source_detail),
    stage_id: n(f.stage_id) ?? undefined,
    status: f.status as LeadInput["status"],
    priority: f.priority as LeadInput["priority"],
    assigned_to: n(f.assigned_to),
    potential_services: f.potential_services,
    estimated_value: n(f.estimated_value),
    currency: f.currency,
    research_notes: n(f.research_notes),
    next_action: n(f.next_action),
    next_action_due_at: fromLocalInput(f.next_action_due_at),
    lost_reason: n(f.lost_reason),
  };
}

export function LeadFormDialog({
  open,
  onOpenChange,
  lead,
  defaultMarket = "local",
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  lead?: Lead;
  defaultMarket?: Market;
  onSaved?: (lead: Lead) => void;
}) {
  const me = useMe();
  const lookups = useLookups();
  const [form, setForm] = React.useState(() => initialState(lead, defaultMarket, me.id));
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [duplicates, setDuplicates] = React.useState<DuplicateMatch[] | null>(null);
  const create = useCreateLead();
  const update = useUpdateLead(lead?.id ?? "");
  const saving = create.isPending || update.isPending;
  const failure = create.error ?? update.error;

  React.useEffect(() => {
    if (open) {
      setForm(initialState(lead, defaultMarket, me.id));
      setErrors({});
      setDuplicates(null);
      create.reset();
      update.reset();
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps -- reset each time the dialog opens

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setDuplicates(null);
  };
  const bind = (key: keyof FormState) => ({
    id: `lead-${key}`,
    value: form[key] as string,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => set(key, e.target.value as never),
    "aria-invalid": !!errors[key],
  });

  function validate() {
    const e: Record<string, string> = {};
    if (!form.business_name.trim()) e.business_name = "Enter the business name.";
    for (const k of ["business_email", "contact_email"] as const) {
      if (form[k].trim() && !/^\S+@\S+\.\S+$/.test(form[k].trim())) e[k] = "Enter a valid email address.";
    }
    if (form.estimated_value && !(Number(form.estimated_value) >= 0)) e.estimated_value = "Enter a positive amount.";
    if (form.status === "active" && !form.next_action.trim()) e.next_action = "Active leads need a next action.";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function submit(force = false) {
    if (!validate()) return;
    const input = toInput(form);
    try {
      if (lead) {
        const saved = await update.mutateAsync(input);
        onSaved?.(saved);
        onOpenChange(false);
      } else {
        const res = await create.mutateAsync({ ...input, force });
        if (res.result === "possible_duplicates") {
          setDuplicates(res.duplicates);
        } else {
          onSaved?.(res.lead);
          onOpenChange(false);
        }
      }
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fields);
    }
  }

  const stages = lookups.data?.pipeline_stages ?? [];
  const sources = lookups.data?.lead_sources ?? [];
  const members = lookups.data?.members ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={lead ? `Edit ${lead.business_name}` : "Add a lead"}
        description="Only the business name is required."
        className="max-h-[calc(100vh-4rem)] max-w-3xl overflow-y-auto"
      >
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void submit(false);
          }}
          className="flex flex-col gap-6"
        >
          {failure && !(failure instanceof ApiError && failure.code === "validation_failed") && (
            <FormAlert>{errorMessage(failure)}</FormAlert>
          )}

          <Section title="Business">
            <Field label="Business name *" htmlFor="lead-business_name" error={errors.business_name} className="col-span-2">
              <Input {...bind("business_name")} autoFocus placeholder="e.g. Barili Bakeshop" />
            </Field>
            <Field label="Market" htmlFor="lead-market">
              <Select {...bind("market")}>
                <option value="local">Local (Philippines)</option>
                <option value="international">International</option>
              </Select>
            </Field>
            <Field label="Industry" htmlFor="lead-industry" error={errors.industry}>
              <Input {...bind("industry")} placeholder="Restaurant, Resort, Real estate…" />
            </Field>
            <Field label="Category" htmlFor="lead-category" error={errors.category}>
              <Input {...bind("category")} placeholder="e.g. Café" />
            </Field>
            <Field label="Country" htmlFor="lead-country" error={errors.country}>
              <Input {...bind("country")} />
            </Field>
            <Field label="Region / state" htmlFor="lead-region" error={errors.region}>
              <Input {...bind("region")} />
            </Field>
            <Field label="City / municipality" htmlFor="lead-city" error={errors.city}>
              <Input {...bind("city")} />
            </Field>
            <Field label="Full address" htmlFor="lead-address" error={errors.address} className="col-span-2">
              <Input {...bind("address")} />
            </Field>
          </Section>

          <Section title="Online presence">
            <Field label="Website" htmlFor="lead-website_url" error={errors.website_url}>
              <Input {...bind("website_url")} placeholder="https://" />
            </Field>
            <Field label="Facebook" htmlFor="lead-facebook_url" error={errors.facebook_url}>
              <Input {...bind("facebook_url")} placeholder="facebook.com/…" />
            </Field>
            <Field label="Instagram" htmlFor="lead-instagram_url" error={errors.instagram_url}>
              <Input {...bind("instagram_url")} placeholder="instagram.com/…" />
            </Field>
            <Field label="LinkedIn" htmlFor="lead-linkedin_url" error={errors.linkedin_url}>
              <Input {...bind("linkedin_url")} />
            </Field>
            <Field label="Google Maps link" htmlFor="lead-google_maps_url" error={errors.google_maps_url} className="col-span-2">
              <Input {...bind("google_maps_url")} />
            </Field>
          </Section>

          <Section title="Contact">
            <Field label="Business phone" htmlFor="lead-business_phone" error={errors.business_phone}>
              <Input {...bind("business_phone")} />
            </Field>
            <Field label="Business email" htmlFor="lead-business_email" error={errors.business_email}>
              <Input {...bind("business_email")} type="email" />
            </Field>
            <Field label="Contact person" htmlFor="lead-contact_name" error={errors.contact_name}>
              <Input {...bind("contact_name")} />
            </Field>
            <Field label="Position" htmlFor="lead-contact_position" error={errors.contact_position}>
              <Input {...bind("contact_position")} placeholder="Owner, Marketing manager…" />
            </Field>
            <Field label="Contact email" htmlFor="lead-contact_email" error={errors.contact_email}>
              <Input {...bind("contact_email")} type="email" />
            </Field>
            <Field label="Contact phone" htmlFor="lead-contact_phone" error={errors.contact_phone}>
              <Input {...bind("contact_phone")} />
            </Field>
          </Section>

          <Section title="Sales">
            <Field label="Lead source" htmlFor="lead-source_id">
              <Select {...bind("source_id")}>
                <option value="">Not specified</option>
                {sources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Source details" htmlFor="lead-source_detail" error={errors.source_detail}>
              <Input {...bind("source_detail")} placeholder="e.g. Search 'Barili restaurants'" />
            </Field>
            <Field label="Pipeline stage" htmlFor="lead-stage_id">
              <Select {...bind("stage_id")}>
                {!lead && <option value="">Default (first stage)</option>}
                {stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Status" htmlFor="lead-status">
              <Select {...bind("status")}>
                <option value="active">Active</option>
                <option value="converted">Converted</option>
                <option value="disqualified">Disqualified</option>
                <option value="archived">Archived</option>
              </Select>
            </Field>
            <Field label="Priority" htmlFor="lead-priority">
              <Select {...bind("priority")}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </Select>
            </Field>
            <Field label="Assigned to" htmlFor="lead-assigned_to">
              <Select {...bind("assigned_to")}>
                <option value="">Unassigned</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Potential services" htmlFor="lead-services" className="col-span-2" hint="Press Enter or comma to add.">
              <TagInput
                id="lead-services"
                value={form.potential_services}
                onChange={(v) => set("potential_services", v)}
                suggestions={SERVICE_SUGGESTIONS}
                placeholder="Social media management, Website…"
              />
            </Field>
            <Field label="Estimated deal value" htmlFor="lead-estimated_value" error={errors.estimated_value}>
              <Input {...bind("estimated_value")} inputMode="decimal" placeholder="0.00" />
            </Field>
            <Field label="Currency" htmlFor="lead-currency">
              <Select {...bind("currency")}>
                {CURRENCIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
            </Field>
            <Field
              label={form.status === "active" ? "Next action *" : "Next action"}
              htmlFor="lead-next_action"
              error={errors.next_action}
            >
              <Input {...bind("next_action")} placeholder="e.g. Call the owner" />
            </Field>
            <Field label="Next action due" htmlFor="lead-next_action_due_at">
              <Input {...bind("next_action_due_at")} type="datetime-local" />
            </Field>
            {form.status === "disqualified" && (
              <Field label="Reason" htmlFor="lead-lost_reason" error={errors.lost_reason} className="col-span-2">
                <Input {...bind("lost_reason")} placeholder="Why this lead isn't a fit" />
              </Field>
            )}
            <Field label="Research notes" htmlFor="lead-research_notes" error={errors.research_notes} className="col-span-2">
              <Textarea {...bind("research_notes")} rows={3} />
            </Field>
          </Section>

          {duplicates && (
            <div className="rounded-card border border-warning/30 bg-warning-soft p-4">
              <p className="flex items-center gap-2 text-sm font-medium text-warning-fg">
                <TriangleAlert className="size-4" /> This business may already be in ODDLY
              </p>
              <ul className="mt-2 flex flex-col gap-1.5 text-sm">
                {duplicates.map((d) => (
                  <li key={d.lead_id} className="flex items-center justify-between gap-3">
                    <span className="text-muted">
                      {d.business_name}
                      {d.city && `, ${d.city}`} <span className="text-subtle">· same {d.matched_by}</span>
                    </span>
                    <Link to={`/leads/record/${d.lead_id}`} className="text-accent hover:underline" onClick={() => onOpenChange(false)}>
                      Open
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <DialogFooter className="sticky -bottom-6 z-10 -mx-6 -mb-6 mt-0 border-t border-line bg-overlay px-6 py-4">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            {duplicates ? (
              <Button type="button" variant="secondary" loading={saving} onClick={() => void submit(true)}>
                Create anyway
              </Button>
            ) : (
              <Button type="submit" loading={saving}>
                {lead ? "Save changes" : "Add lead"}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="grid grid-cols-2 gap-4">
      <legend className="col-span-2 mb-3 text-xs font-medium text-subtle">{title}</legend>
      {children}
    </fieldset>
  );
}
