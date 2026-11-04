import * as Popover from "@radix-ui/react-popover";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, Copy, Search, X } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/form-controls";
import { Field, Input, Select } from "@/components/ui/input";
import { useAuth } from "@/features/auth/auth-context";
import { api, errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { Page } from "@/types/leads";

import { useDraft, type DraftKind } from "./api";

export const DRAFT_KINDS: { value: DraftKind; label: string; needs: "lead" | "client" | "lead_or_client" | "notes" | "none"; hint: string }[] = [
  { value: "outreach", label: "Outreach message", needs: "lead", hint: "A first message to a lead, based on its details and research." },
  { value: "follow_up", label: "Follow-up message", needs: "lead", hint: "Builds on the outreach already logged for the lead." },
  { value: "proposal_description", label: "Proposal description", needs: "lead_or_client", hint: "Scope and introduction text for a proposal." },
  { value: "caption", label: "Social media captions", needs: "client", hint: "Three caption options for a client's post." },
  { value: "content_ideas", label: "Content ideas", needs: "client", hint: "Post ideas based on the client and their recent content." },
  { value: "meeting_summary", label: "Meeting summary", needs: "notes", hint: "Turns your meeting notes into a summary with action items." },
  { value: "client_summary", label: "Client summary", needs: "client", hint: "An account overview from the client's record and history." },
  { value: "weekly_summary", label: "Weekly summary", needs: "none", hint: "The past 7 days across the data you can see." },
];

const CHANNELS = [
  ["email", "Email"],
  ["facebook", "Facebook message"],
  ["instagram", "Instagram DM"],
  ["linkedin", "LinkedIn message"],
  ["whatsapp", "WhatsApp"],
  ["sms", "SMS"],
  ["phone", "Call script"],
] as const;

const TONES = ["friendly and professional", "formal", "casual and warm", "short and direct", "enthusiastic"];

export interface RecordRef {
  type: "lead" | "client";
  id: string;
  name: string;
}

/** Search-as-you-type picker for a lead or client the user can see. */
export function RecordPicker({
  type,
  value,
  onChange,
  id,
}: {
  type: "lead" | "client";
  value: RecordRef | null;
  onChange: (r: RecordRef | null) => void;
  id?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const results = useQuery({
    queryKey: ["record-picker", type, search],
    queryFn: async () => {
      if (type === "lead") {
        const page = await api<Page<{ id: string; business_name: string; city: string | null }>>("/leads", { query: { search, per_page: 8 } });
        return page.items.map((l) => ({ id: l.id, name: l.business_name, sub: l.city }));
      }
      const page = await api<Page<{ id: string; name: string; city: string | null }>>("/clients", { query: { search, status: "all", per_page: 8 } });
      return page.items.map((c) => ({ id: c.id, name: c.name, sub: c.city }));
    },
    enabled: open,
  });

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button id={id} type="button" variant="secondary" className="w-full justify-between font-normal">
          <span className={cn("truncate", !value && "text-subtle")}>{value?.name ?? `Choose a ${type}…`}</span>
          {value ? (
            <X
              className="text-subtle"
              onClick={(e) => {
                e.stopPropagation();
                onChange(null);
              }}
            />
          ) : (
            <ChevronDown className="text-subtle" />
          )}
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          className="z-[60] w-[var(--radix-popover-trigger-width)] min-w-64 rounded-md border border-line bg-overlay p-1.5 shadow-pop focus:outline-none"
        >
          <div className="relative mb-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-subtle" />
            <Input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`Search ${type}s`} className="pl-8" />
          </div>
          <ul className="max-h-64 overflow-y-auto">
            {results.isPending ? (
              <li className="px-2.5 py-2 text-sm text-subtle">Searching…</li>
            ) : results.isError ? (
              <li className="px-2.5 py-2 text-sm text-danger-fg">{errorMessage(results.error)}</li>
            ) : results.data.length === 0 ? (
              <li className="px-2.5 py-2 text-sm text-subtle">No matches</li>
            ) : (
              results.data.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange({ type, id: r.id, name: r.name });
                      setOpen(false);
                    }}
                    className="flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-raised"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-fg">{r.name}</span>
                      {r.sub && <span className="block truncate text-xs text-subtle">{r.sub}</span>}
                    </span>
                    {value?.id === r.id && <Check className="size-4 shrink-0 text-accent" />}
                  </button>
                </li>
              ))
            )}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function CopyButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={className}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}
    </Button>
  );
}

/** The draft form + editable result. Nothing is sent anywhere — the user copies what they want. */
export function DraftWriter({
  initialKind = "outreach",
  initialRecord = null,
  lockRecord,
  kinds,
}: {
  initialKind?: DraftKind;
  initialRecord?: RecordRef | null;
  lockRecord?: boolean;
  kinds?: DraftKind[];
}) {
  const { can } = useAuth();
  const draft = useDraft();
  const [kind, setKind] = React.useState<DraftKind>(initialKind);
  const [record, setRecord] = React.useState<RecordRef | null>(initialRecord);
  const [forType, setForType] = React.useState<"lead" | "client">(initialRecord?.type ?? "lead");
  const [channel, setChannel] = React.useState("email");
  const [tone, setTone] = React.useState(TONES[0]!);
  const [instructions, setInstructions] = React.useState("");
  const [text, setText] = React.useState("");

  const options = DRAFT_KINDS.filter((k) => !kinds || kinds.includes(k.value)).filter((k) => {
    if (k.needs === "lead") return can("leads.view");
    if (k.needs === "client") return can("clients.view");
    return true;
  });
  const meta = DRAFT_KINDS.find((k) => k.value === kind)!;
  const needsType: "lead" | "client" | null =
    meta.needs === "lead" ? "lead" : meta.needs === "client" ? "client" : meta.needs === "lead_or_client" ? forType : null;
  const recordOk =
    meta.needs === "lead" ? record?.type === "lead" : meta.needs === "client" ? record?.type === "client" : meta.needs === "lead_or_client" ? record?.type === forType : true;
  const notesOk = meta.needs !== "notes" || instructions.trim().length > 0;
  const showChannel = kind === "outreach" || kind === "follow_up" || kind === "caption";

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!recordOk || !notesOk) return;
    draft.mutate(
      {
        kind,
        lead_id: record?.type === "lead" && meta.needs !== "client" ? record.id : undefined,
        client_id: record?.type === "client" && meta.needs !== "lead" ? record.id : undefined,
        channel: showChannel ? channel : undefined,
        tone,
        instructions: instructions.trim() || undefined,
      },
      { onSuccess: (d) => setText(d.text) },
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="What to write" htmlFor="draft-kind" hint={meta.hint}>
          <Select
            id="draft-kind"
            value={kind}
            onChange={(e) => {
              const next = e.target.value as DraftKind;
              setKind(next);
              const needs = DRAFT_KINDS.find((k) => k.value === next)!.needs;
              if (!lockRecord && record && ((needs === "lead" && record.type !== "lead") || (needs === "client" && record.type !== "client"))) setRecord(null);
            }}
          >
            {options.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </Select>
        </Field>
        {meta.needs === "lead_or_client" && !lockRecord && (
          <Field label="For" htmlFor="draft-for-type">
            <Select
              id="draft-for-type"
              value={forType}
              onChange={(e) => {
                const t = e.target.value as "lead" | "client";
                setForType(t);
                if (record?.type !== t) setRecord(null);
              }}
            >
              <option value="lead">A lead</option>
              <option value="client">A client</option>
            </Select>
          </Field>
        )}
        {needsType && (
          <Field label={needsType === "lead" ? "Lead" : "Client"} htmlFor="draft-record">
            {lockRecord && record ? (
              <p className="rounded-control border border-line bg-raised px-3 py-2 text-sm">{record.name}</p>
            ) : (
              <RecordPicker id="draft-record" type={needsType} value={record} onChange={setRecord} />
            )}
          </Field>
        )}
        {showChannel && (
          <Field label={kind === "caption" ? "Platform" : "Channel"} htmlFor="draft-channel">
            <Select id="draft-channel" value={channel} onChange={(e) => setChannel(e.target.value)}>
              {(kind === "caption" ? CHANNELS.filter(([v]) => ["facebook", "instagram", "linkedin"].includes(v)) : CHANNELS).map(([v, l]) => (
                <option key={v} value={v}>
                  {kind === "caption" ? l.replace(/ (message|DM)$/, "") : l}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {meta.needs !== "notes" && kind !== "weekly_summary" && (
          <Field label="Tone" htmlFor="draft-tone">
            <Select id="draft-tone" value={tone} onChange={(e) => setTone(e.target.value)}>
              {TONES.map((t) => (
                <option key={t} value={t}>
                  {t[0]!.toUpperCase() + t.slice(1)}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field
          label={meta.needs === "notes" ? "Meeting notes" : "Extra direction (optional)"}
          htmlFor="draft-notes"
          hint={meta.needs === "notes" ? undefined : "e.g. mention our website package, keep it under 80 words"}
        >
          <Textarea
            id="draft-notes"
            rows={meta.needs === "notes" ? 8 : 3}
            maxLength={6000}
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
          />
        </Field>
        <Button type="submit" disabled={!recordOk || !notesOk || draft.isPending}>
          {draft.isPending ? "Writing…" : text ? "Write again" : "Write draft"}
        </Button>
        {draft.isError && <p className="text-sm text-danger-fg">{errorMessage(draft.error)}</p>}
      </form>

      <div className="flex min-h-80 flex-col rounded-card border border-line bg-raised/40">
        <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
          <span className="flex items-center gap-2 text-xs font-medium text-accent-fg">
            AI draft. Review before using.
          </span>
          {text && <CopyButton text={text} />}
        </div>
        {text ? (
          <Textarea
            aria-label="Draft text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="min-h-80 flex-1 resize-y rounded-none border-0 bg-transparent p-4 leading-relaxed focus-visible:ring-0"
          />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-sm text-subtle">
            
            {draft.isPending ? "Writing your draft…" : "Your draft appears here. Nothing is sent."}
          </div>
        )}
      </div>
    </div>
  );
}

/** The draft writer in a dialog, for a specific lead or client. */
export function DraftDialog({
  open,
  onOpenChange,
  record,
  kind,
  kinds,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  record: RecordRef;
  kind: DraftKind;
  kinds: DraftKind[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={`Draft for ${record.name}`} description="Nothing is sent." className="max-w-4xl">
        <DraftWriter initialKind={kind} initialRecord={record} lockRecord kinds={kinds} />
      </DialogContent>
    </Dialog>
  );
}
