import { Plus, Trash2 } from "lucide-react";
import * as React from "react";
import { useNavigate } from "react-router";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Checkbox, Textarea } from "@/components/ui/form-controls";
import { Field, Input, Select } from "@/components/ui/input";
import { FormAlert } from "@/features/auth/auth-layout";
import { useMe } from "@/features/auth/auth-context";
import { useLookups } from "@/features/leads/api";
import { CURRENCIES } from "@/features/leads/lead-form";
import { ApiError, errorMessage } from "@/lib/api";
import { fromLocalInput, toLocalInput, tomorrowMorning } from "@/lib/dates";
import type { Deal, FollowUp, Meeting } from "@/types/sales";
import { BILLING_LABELS, CHANNEL_LABELS, type BillingType, type Channel } from "@/types/sales";

import {
  useConvertLead,
  useLogInteraction,
  useSaveDeal,
  useSaveFollowUp,
  useSaveMeeting,
  type ConvertInput,
} from "./api";

function useFieldErrors() {
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const fromError = (e: unknown) => e instanceof ApiError && setErrors(e.fields);
  return { errors, setErrors, fromError };
}

function GeneralError({ error }: { error: unknown }) {
  if (!error || (error instanceof ApiError && error.code === "validation_failed")) return null;
  return <FormAlert>{errorMessage(error)}</FormAlert>;
}

// ---------------------------------------------------------------------------
// Log outreach / note
// ---------------------------------------------------------------------------

export function InteractionDialog({
  leadId,
  leadName,
  open,
  onOpenChange,
  defaultChannel = "facebook",
}: {
  leadId: string;
  leadName: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  defaultChannel?: Channel;
}) {
  const log = useLogInteraction(leadId);
  const { errors, setErrors, fromError } = useFieldErrors();
  const empty = () => ({
    channel: defaultChannel as string,
    direction: "outbound",
    subject: "",
    body: "",
    outcome: "",
    occurred_at: toLocalInput(new Date().toISOString()),
    next_action: "",
    next_action_due_at: "",
    add_follow_up: false,
    follow_up_title: "",
    follow_up_due: tomorrowMorning(),
  });
  const [f, setF] = React.useState(empty);
  React.useEffect(() => {
    if (open) {
      setF(empty());
      setErrors({});
      log.reset();
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps -- reset when opened

  const isNote = f.channel === "note";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={isNote ? "Add a note" : "Log outreach"} description={leadName} className="max-w-xl">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!f.body.trim() && !f.subject.trim()) {
              setErrors({ body: "Write what happened." });
              return;
            }
            log.mutate(
              {
                channel: f.channel,
                direction: isNote ? "internal" : f.direction,
                subject: f.subject || null,
                body: f.body || null,
                outcome: f.outcome || null,
                occurred_at: fromLocalInput(f.occurred_at),
                next_action: f.next_action || null,
                next_action_due_at: fromLocalInput(f.next_action_due_at),
                follow_up:
                  f.add_follow_up && f.follow_up_title.trim()
                    ? { title: f.follow_up_title.trim(), due_at: fromLocalInput(f.follow_up_due)! }
                    : null,
              },
              { onSuccess: () => onOpenChange(false), onError: fromError },
            );
          }}
        >
          <GeneralError error={log.error} />
          <div className="grid grid-cols-2 gap-4">
            <Field label="Type" htmlFor="ix-channel">
              <Select id="ix-channel" value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })}>
                {(Object.keys(CHANNEL_LABELS) as Channel[]).map((c) => <option key={c} value={c}>{CHANNEL_LABELS[c]}</option>)}
              </Select>
            </Field>
            {!isNote ? (
              <Field label="Direction" htmlFor="ix-dir">
                <Select id="ix-dir" value={f.direction} onChange={(e) => setF({ ...f, direction: e.target.value })}>
                  <option value="outbound">We reached out</option>
                  <option value="inbound">They contacted us</option>
                </Select>
              </Field>
            ) : <div />}
            {f.channel === "email" && (
              <Field label="Subject" htmlFor="ix-subject" className="col-span-2">
                <Input id="ix-subject" value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} />
              </Field>
            )}
            <Field label={isNote ? "Note" : "What happened"} htmlFor="ix-body" error={errors.body} className="col-span-2">
              <Textarea id="ix-body" autoFocus rows={4} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />
            </Field>
            {!isNote && (
              <Field label="Outcome" htmlFor="ix-outcome">
                <Input id="ix-outcome" value={f.outcome} onChange={(e) => setF({ ...f, outcome: e.target.value })} placeholder="e.g. Asked for pricing" />
              </Field>
            )}
            <Field label="When" htmlFor="ix-when">
              <Input id="ix-when" type="datetime-local" value={f.occurred_at} onChange={(e) => setF({ ...f, occurred_at: e.target.value })} />
            </Field>
            <Field label="New next action" htmlFor="ix-next" hint="Leave blank to keep the current one.">
              <Input id="ix-next" value={f.next_action} onChange={(e) => setF({ ...f, next_action: e.target.value })} />
            </Field>
            <Field label="Next action due" htmlFor="ix-next-due">
              <Input id="ix-next-due" type="datetime-local" value={f.next_action_due_at} onChange={(e) => setF({ ...f, next_action_due_at: e.target.value })} />
            </Field>
          </div>
          <label className="flex items-center gap-2.5 text-sm text-muted">
            <Checkbox checked={f.add_follow_up} onChange={(v) => setF({ ...f, add_follow_up: v, follow_up_title: f.follow_up_title || `Follow up with ${leadName}` })} label="Schedule a follow-up" />
            Schedule a follow-up reminder
          </label>
          {f.add_follow_up && (
            <div className="grid grid-cols-2 gap-4">
              <Field label="Reminder" htmlFor="ix-fu-title">
                <Input id="ix-fu-title" value={f.follow_up_title} onChange={(e) => setF({ ...f, follow_up_title: e.target.value })} />
              </Field>
              <Field label="Due" htmlFor="ix-fu-due">
                <Input id="ix-fu-due" type="datetime-local" value={f.follow_up_due} onChange={(e) => setF({ ...f, follow_up_due: e.target.value })} />
              </Field>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" loading={log.isPending}>Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Follow-up
// ---------------------------------------------------------------------------

export function FollowUpDialog({
  open,
  onOpenChange,
  followUp,
  leadId,
  clientId,
  defaultTitle,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  followUp?: FollowUp;
  leadId?: string;
  clientId?: string;
  defaultTitle?: string;
}) {
  const me = useMe();
  const lookups = useLookups();
  const save = useSaveFollowUp(followUp?.id);
  const { errors, setErrors, fromError } = useFieldErrors();
  const init = () => ({
    title: followUp?.title ?? defaultTitle ?? "",
    notes: followUp?.notes ?? "",
    due_at: followUp ? toLocalInput(followUp.due_at) : tomorrowMorning(),
    priority: followUp?.priority ?? "medium",
    recurrence: followUp?.recurrence ?? "",
    assigned_to: followUp?.assigned_to ?? me.id,
  });
  const [f, setF] = React.useState(init);
  React.useEffect(() => {
    if (open) {
      setF(init());
      setErrors({});
      save.reset();
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps -- reset when opened

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={followUp ? "Edit follow-up" : "Schedule a follow-up"} className="max-w-lg">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!f.title.trim()) return setErrors({ title: "What needs to happen?" });
            if (!f.due_at) return setErrors({ due_at: "Choose when." });
            save.mutate(
              {
                lead_id: followUp?.lead_id ?? leadId ?? null,
                client_id: followUp?.client_id ?? clientId ?? null,
                deal_id: followUp?.deal_id ?? null,
                title: f.title.trim(),
                notes: f.notes || null,
                due_at: fromLocalInput(f.due_at)!,
                priority: f.priority,
                recurrence: f.recurrence || null,
                assigned_to: f.assigned_to || null,
              },
              { onSuccess: () => onOpenChange(false), onError: fromError },
            );
          }}
        >
          <GeneralError error={save.error} />
          <Field label="Reminder" htmlFor="fu-title" error={errors.title}>
            <Input id="fu-title" autoFocus value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Call back about the website quote" />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Due" htmlFor="fu-due" error={errors.due_at}>
              <Input id="fu-due" type="datetime-local" value={f.due_at} onChange={(e) => setF({ ...f, due_at: e.target.value })} />
            </Field>
            <Field label="Priority" htmlFor="fu-priority">
              <Select id="fu-priority" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value as typeof f.priority })}>
                <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option>
              </Select>
            </Field>
            <Field label="Repeat" htmlFor="fu-repeat">
              <Select id="fu-repeat" value={f.recurrence} onChange={(e) => setF({ ...f, recurrence: e.target.value as typeof f.recurrence })}>
                <option value="">Doesn't repeat</option><option value="daily">Daily</option><option value="weekly">Weekly</option>
                <option value="biweekly">Every 2 weeks</option><option value="monthly">Monthly</option>
              </Select>
            </Field>
            <Field label="Assigned to" htmlFor="fu-assign">
              <Select id="fu-assign" value={f.assigned_to} onChange={(e) => setF({ ...f, assigned_to: e.target.value })}>
                {lookups.data?.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </Select>
            </Field>
          </div>
          <Field label="Notes" htmlFor="fu-notes">
            <Textarea id="fu-notes" rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" loading={save.isPending}>{followUp ? "Save" : "Schedule"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Meeting
// ---------------------------------------------------------------------------

export function MeetingDialog({
  open,
  onOpenChange,
  meeting,
  leadId,
  clientId,
  defaultTitle,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  meeting?: Meeting;
  leadId?: string;
  clientId?: string;
  defaultTitle?: string;
}) {
  const me = useMe();
  const lookups = useLookups();
  const save = useSaveMeeting(meeting?.id);
  const { errors, setErrors, fromError } = useFieldErrors();
  const init = () => {
    const start = meeting ? toLocalInput(meeting.starts_at) : tomorrowMorning();
    const end = meeting?.ends_at ? toLocalInput(meeting.ends_at) : toLocalInput(new Date(new Date(start).getTime() + 3600_000).toISOString());
    return {
      title: meeting?.title ?? defaultTitle ?? "",
      starts_at: start,
      ends_at: end,
      location: meeting?.location ?? "",
      meeting_url: meeting?.meeting_url ?? "",
      notes: meeting?.notes ?? "",
      outcome: meeting?.outcome ?? "",
      next_action: meeting?.next_action ?? "",
      status: meeting?.status ?? "scheduled",
      participant_ids: meeting?.participants.filter((p) => p.user_id).map((p) => p.user_id!) ?? [me.id],
      external: meeting?.participants.filter((p) => !p.user_id).map((p) => ({ name: p.name ?? "", email: p.email ?? "" })) ?? [],
    };
  };
  const [f, setF] = React.useState(init);
  React.useEffect(() => {
    if (open) {
      setF(init());
      setErrors({});
      save.reset();
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps -- reset when opened

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={meeting ? "Meeting" : "Schedule a meeting"} description={meeting?.related_name ?? undefined} className="max-h-[calc(100vh-4rem)] max-w-2xl overflow-y-auto">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!f.title.trim()) return setErrors({ title: "Give the meeting a title." });
            save.mutate(
              {
                title: f.title.trim(),
                starts_at: fromLocalInput(f.starts_at)!,
                ends_at: fromLocalInput(f.ends_at),
                location: f.location || null,
                meeting_url: f.meeting_url || null,
                lead_id: meeting?.lead_id ?? leadId ?? null,
                client_id: meeting?.client_id ?? clientId ?? null,
                deal_id: meeting?.deal_id ?? null,
                notes: f.notes || null,
                outcome: f.outcome || null,
                next_action: f.next_action || null,
                status: f.status,
                participant_ids: f.participant_ids,
                external: f.external.filter((x) => x.name.trim()),
              },
              { onSuccess: () => onOpenChange(false), onError: fromError },
            );
          }}
        >
          <GeneralError error={save.error} />
          <div className="grid grid-cols-2 gap-4">
            <Field label="Title" htmlFor="mt-title" error={errors.title} className="col-span-2">
              <Input id="mt-title" autoFocus value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
            </Field>
            <Field label="Starts" htmlFor="mt-start">
              <Input id="mt-start" type="datetime-local" value={f.starts_at} onChange={(e) => setF({ ...f, starts_at: e.target.value })} />
            </Field>
            <Field label="Ends" htmlFor="mt-end" error={errors.ends_at}>
              <Input id="mt-end" type="datetime-local" value={f.ends_at} onChange={(e) => setF({ ...f, ends_at: e.target.value })} />
            </Field>
            <Field label="Location" htmlFor="mt-loc">
              <Input id="mt-loc" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} placeholder="Office, café, client's shop…" />
            </Field>
            <Field label="Online meeting link" htmlFor="mt-url">
              <Input id="mt-url" value={f.meeting_url} onChange={(e) => setF({ ...f, meeting_url: e.target.value })} placeholder="Zoom / Meet / Teams link" />
            </Field>
          </div>
          <div>
            <p className="mb-2 text-[13px] font-medium text-muted">Team participants</p>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {lookups.data?.members.map((m) => (
                <label key={m.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={f.participant_ids.includes(m.id)}
                    label={m.name}
                    onChange={(on) => setF({ ...f, participant_ids: on ? [...f.participant_ids, m.id] : f.participant_ids.filter((x) => x !== m.id) })}
                  />
                  {m.name}
                </label>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[13px] font-medium text-muted">Client-side participants</p>
              <Button type="button" variant="ghost" size="sm" onClick={() => setF({ ...f, external: [...f.external, { name: "", email: "" }] })}>
                <Plus /> Add
              </Button>
            </div>
            {f.external.map((x, i) => (
              <div key={i} className="mb-2 flex gap-2">
                <Input aria-label="Name" placeholder="Name" value={x.name} onChange={(e) => setF({ ...f, external: f.external.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)) })} />
                <Input aria-label="Email" placeholder="Email (optional)" value={x.email} onChange={(e) => setF({ ...f, external: f.external.map((y, j) => (j === i ? { ...y, email: e.target.value } : y)) })} />
                <Button type="button" variant="ghost" size="icon" aria-label="Remove" onClick={() => setF({ ...f, external: f.external.filter((_, j) => j !== i) })}><Trash2 /></Button>
              </div>
            ))}
          </div>
          <Field label="Notes" htmlFor="mt-notes">
            <Textarea id="mt-notes" rows={3} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
          </Field>
          {meeting && (
            <div className="grid grid-cols-2 gap-4 rounded-control border border-line p-4">
              <Field label="Status" htmlFor="mt-status">
                <Select id="mt-status" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as typeof f.status })}>
                  <option value="scheduled">Scheduled</option><option value="completed">Completed</option>
                  <option value="no_show">No-show</option><option value="cancelled">Cancelled</option>
                </Select>
              </Field>
              <Field label="Next action" htmlFor="mt-next">
                <Input id="mt-next" value={f.next_action} onChange={(e) => setF({ ...f, next_action: e.target.value })} />
              </Field>
              <Field label="Outcome" htmlFor="mt-outcome" className="col-span-2">
                <Textarea id="mt-outcome" rows={2} value={f.outcome} onChange={(e) => setF({ ...f, outcome: e.target.value })} />
              </Field>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" loading={save.isPending}>{meeting ? "Save" : "Schedule"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Deal
// ---------------------------------------------------------------------------

export function DealDialog({
  open,
  onOpenChange,
  deal,
  leadId,
  defaultTitle,
  defaultValue,
  defaultCurrency = "PHP",
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  deal?: Deal;
  leadId?: string;
  defaultTitle?: string;
  defaultValue?: string | null;
  defaultCurrency?: string;
}) {
  const lookups = useLookups();
  const save = useSaveDeal(deal?.id);
  const { errors, setErrors, fromError } = useFieldErrors();
  const init = () => ({
    title: deal?.title ?? defaultTitle ?? "",
    value: deal?.value ?? defaultValue ?? "",
    currency: deal?.currency ?? defaultCurrency,
    expected_close_date: deal?.expected_close_date ?? "",
    owner_id: deal?.owner_id ?? "",
  });
  const [f, setF] = React.useState(init);
  React.useEffect(() => {
    if (open) {
      setF(init());
      setErrors({});
      save.reset();
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps -- reset when opened

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={deal ? "Edit deal" : "Open a deal"} className="max-w-lg">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!f.title.trim()) return setErrors({ title: "Name the deal." });
            if (!(Number(f.value) >= 0) || f.value === "") return setErrors({ value: "Enter the deal value." });
            save.mutate(
              { lead_id: leadId, title: f.title.trim(), value: f.value, currency: f.currency, expected_close_date: f.expected_close_date || null, owner_id: f.owner_id || null },
              { onSuccess: () => onOpenChange(false), onError: fromError },
            );
          }}
        >
          <GeneralError error={save.error} />
          <Field label="Deal" htmlFor="dl-title" error={errors.title}>
            <Input id="dl-title" autoFocus value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Social media package" />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Value" htmlFor="dl-value" error={errors.value}>
              <Input id="dl-value" inputMode="decimal" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} />
            </Field>
            <Field label="Currency" htmlFor="dl-cur">
              <Select id="dl-cur" value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })}>
                {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
              </Select>
            </Field>
            <Field label="Expected close" htmlFor="dl-close">
              <Input id="dl-close" type="date" value={f.expected_close_date} onChange={(e) => setF({ ...f, expected_close_date: e.target.value })} />
            </Field>
            <Field label="Owner" htmlFor="dl-owner">
              <Select id="dl-owner" value={f.owner_id} onChange={(e) => setF({ ...f, owner_id: e.target.value })}>
                <option value="">Lead's owner</option>
                {lookups.data?.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </Select>
            </Field>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" loading={save.isPending}>{deal ? "Save" : "Open deal"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Convert lead -> client
// ---------------------------------------------------------------------------

export function ConvertDialog({
  open,
  onOpenChange,
  leadId,
  leadName,
  defaultManager,
  dealId,
  proposalId,
  presetServices = [],
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  leadId: string;
  leadName: string;
  defaultManager?: string | null;
  dealId?: string | null;
  proposalId?: string | null;
  presetServices?: ConvertInput["services"];
}) {
  const lookups = useLookups();
  const convert = useConvertLead(leadId);
  const navigate = useNavigate();
  const init = () => ({
    account_manager_id: defaultManager ?? "",
    status: "onboarding",
    client_since: new Date().toISOString().slice(0, 10),
    notes: "",
    services: presetServices.length ? presetServices : [{ name: "", price: "", currency: "PHP", billing_type: "monthly" }],
  });
  const [f, setF] = React.useState(init);
  React.useEffect(() => {
    if (open) {
      setF(init());
      convert.reset();
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps -- reset when opened

  const setService = (i: number, patch: Partial<ConvertInput["services"][number]>) =>
    setF({ ...f, services: f.services.map((s, j) => (j === i ? { ...s, ...patch } : s)) });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={`Convert ${leadName} into a client`}
        description="The business, contacts and history carry over — nothing is re-entered. Any open deal is marked won."
        className="max-h-[calc(100vh-4rem)] max-w-2xl overflow-y-auto"
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            convert.mutate(
              {
                account_manager_id: f.account_manager_id || null,
                status: f.status,
                client_since: f.client_since || null,
                deal_id: dealId ?? null,
                proposal_id: proposalId ?? null,
                notes: f.notes || null,
                services: f.services.filter((s) => s.name.trim()).map((s) => ({ ...s, price: s.price || "0" })),
              },
              { onSuccess: (r) => { onOpenChange(false); navigate(`/clients/record/${r.client_id}`); } },
            );
          }}
        >
          <GeneralError error={convert.error} />
          <div className="grid grid-cols-3 gap-4">
            <Field label="Account manager" htmlFor="cv-am">
              <Select id="cv-am" value={f.account_manager_id} onChange={(e) => setF({ ...f, account_manager_id: e.target.value })}>
                <option value="">Lead's owner</option>
                {lookups.data?.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </Select>
            </Field>
            <Field label="Starting status" htmlFor="cv-status">
              <Select id="cv-status" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
                <option value="onboarding">Onboarding</option>
                <option value="active">Active</option>
              </Select>
            </Field>
            <Field label="Client since" htmlFor="cv-since">
              <Input id="cv-since" type="date" value={f.client_since} onChange={(e) => setF({ ...f, client_since: e.target.value })} />
            </Field>
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[13px] font-medium text-muted">Services purchased</p>
              <Button type="button" variant="ghost" size="sm" onClick={() => setF({ ...f, services: [...f.services, { name: "", price: "", currency: "PHP", billing_type: "monthly" }] })}>
                <Plus /> Add service
              </Button>
            </div>
            <div className="flex flex-col gap-2">
              {f.services.map((s, i) => (
                <div key={i} className="grid grid-cols-[minmax(0,1fr)_110px_90px_120px_40px] gap-2">
                  <Input aria-label="Service" placeholder="Service" value={s.name} list="cv-services" onChange={(e) => setService(i, { name: e.target.value })} />
                  <Input aria-label="Price" placeholder="Price" inputMode="decimal" value={s.price} onChange={(e) => setService(i, { price: e.target.value })} />
                  <Select aria-label="Currency" value={s.currency} onChange={(e) => setService(i, { currency: e.target.value })}>
                    {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
                  </Select>
                  <Select aria-label="Billing" value={s.billing_type} onChange={(e) => setService(i, { billing_type: e.target.value })}>
                    {(Object.keys(BILLING_LABELS) as BillingType[]).map((b) => <option key={b} value={b}>{BILLING_LABELS[b]}</option>)}
                  </Select>
                  <Button type="button" variant="ghost" size="icon" aria-label="Remove service" onClick={() => setF({ ...f, services: f.services.filter((_, j) => j !== i) })}>
                    <Trash2 />
                  </Button>
                </div>
              ))}
              <datalist id="cv-services">
                {lookups.data?.services.map((s) => <option key={s.id} value={s.name} />)}
              </datalist>
            </div>
          </div>
          <Field label="Onboarding notes" htmlFor="cv-notes">
            <Textarea id="cv-notes" rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" loading={convert.isPending}>Create client</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
