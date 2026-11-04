/**
 * Sales features contributed to the lead detail page: action buttons and the outreach,
 * follow-up, meeting and deal panels on its Activity tab.
 */
import { CalendarPlus, ChevronDown, FilePlus2, Handshake, MessageSquare, Plus, Trash2 } from "lucide-react";
import * as React from "react";
import { Link } from "react-router";

import { EmptyState, ListSkeleton } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth, useMe } from "@/features/auth/auth-context";
import { leadDetailExtensions } from "@/features/leads/lead-detail-page";
import { formatDate, formatMoney, formatTime } from "@/lib/format";
import type { LeadDetail } from "@/types/leads";
import { CHANNEL_LABELS } from "@/types/sales";

import { useDeals, useDeleteInteraction, useFollowUps, useInteractions, useMeetings, useProposals } from "./api";
import { FollowUpRow, MeetingRow } from "./activity-pages";
import { DealActions } from "./deals-page";
import { ConvertDialog, DealDialog, FollowUpDialog, InteractionDialog, MeetingDialog } from "./dialogs";
import { NewProposalDialog, PROPOSAL_LABEL, PROPOSAL_TONE } from "./proposals-page";

function LeadSalesActions({ lead }: { lead: LeadDetail }) {
  const { can } = useAuth();
  const [open, setOpen] = React.useState<null | "log" | "note" | "follow" | "meet" | "deal" | "proposal" | "convert">(null);
  if (!can("sales.manage")) return null;
  const close = (o: boolean) => !o && setOpen(null);
  const converted = lead.status === "converted" || !!lead.client_id;

  return (
    <>
      <Button onClick={() => setOpen("log")}><MessageSquare /> Log outreach</Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary"><Plus /> Add <ChevronDown className="text-subtle" /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setOpen("note")}>Note</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setOpen("follow")}>Follow-up</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setOpen("meet")}><CalendarPlus /> Meeting</DropdownMenuItem><DropdownMenuItem onSelect={() => setOpen("deal")}>Deal</DropdownMenuItem>
          {can("proposals.manage") && <DropdownMenuItem onSelect={() => setOpen("proposal")}>Proposal</DropdownMenuItem>}
          {!converted && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setOpen("convert")}>Convert to client</DropdownMenuItem>
            </>
          )}
          {lead.client_id && (
            <DropdownMenuItem asChild><Link to={`/clients/record/${lead.client_id}`}>Open client</Link></DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <InteractionDialog open={open === "log"} onOpenChange={close} leadId={lead.id} leadName={lead.business_name} />
      <InteractionDialog open={open === "note"} onOpenChange={close} leadId={lead.id} leadName={lead.business_name} defaultChannel="note" />
      <FollowUpDialog open={open === "follow"} onOpenChange={close} leadId={lead.id} defaultTitle={`Follow up with ${lead.business_name}`} />
      <MeetingDialog open={open === "meet"} onOpenChange={close} leadId={lead.id} defaultTitle={`Meeting with ${lead.business_name}`} />
      <DealDialog
        open={open === "deal"}
        onOpenChange={close}
        leadId={lead.id}
        defaultTitle={lead.potential_services.join(" + ") || `${lead.business_name} engagement`}
        defaultValue={lead.estimated_value}
        defaultCurrency={lead.currency}
      />
      <NewProposalDialog mode={open === "proposal" ? "proposal" : null} onClose={() => setOpen(null)} leadId={lead.id} />
      <ConvertDialog open={open === "convert"} onOpenChange={close} leadId={lead.id} leadName={lead.business_name} defaultManager={lead.assigned_to} />
    </>
  );
}

function LeadOutreach({ lead }: { lead: LeadDetail }) {
  const me = useMe();
  const { can } = useAuth();
  const items = useInteractions({ lead_id: lead.id });
  const remove = useDeleteInteraction();
  return (
    <Card>
      <CardHeader title="Outreach" description={lead.last_contacted_at ? `Last contact ${formatDate(lead.last_contacted_at, me.timezone, { year: "numeric" })}` : "Not contacted yet"} />
      <CardBody>
        {items.isPending ? (
          <ListSkeleton rows={2} />
        ) : !items.data?.items.length ? (
          <EmptyState title="No outreach yet" compact />
        ) : (
          <ol className="flex flex-col gap-4">
            {items.data.items.map((i) => (
              <li key={i.id} className="group flex gap-3">
                <span className="mt-1.5 size-2 shrink-0 rounded-full bg-accent" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-subtle">
                    {CHANNEL_LABELS[i.channel]}{i.direction === "inbound" ? ", incoming" : ""}, {formatDate(i.occurred_at, me.timezone)} {formatTime(i.occurred_at, me.timezone)}, {i.user_name}
                  </p>
                  {i.subject && <p className="mt-0.5 text-sm font-medium">{i.subject}</p>}
                  {i.body && <p className="mt-0.5 whitespace-pre-wrap text-sm text-muted">{i.body}</p>}
                  {i.outcome && <p className="mt-1 text-xs text-accent">Outcome: {i.outcome}</p>}
                </div>
                {can("sales.manage") && (i.user_id === me.id || can("leads.view_all")) && (
                  <Button variant="ghost" size="icon-sm" className="opacity-0 group-hover:opacity-100 focus:opacity-100" aria-label="Delete entry" onClick={() => remove.mutate(i.id)}>
                    <Trash2 />
                  </Button>
                )}
              </li>
            ))}
          </ol>
        )}
      </CardBody>
    </Card>
  );
}

function LeadSchedule({ lead }: { lead: LeadDetail }) {
  const followUps = useFollowUps({ lead_id: lead.id, status: "pending" });
  const meetings = useMeetings({ lead_id: lead.id });
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader title="Follow-ups" />
        <CardBody>
          {followUps.data?.items.length ? (
            <ul className="-mx-2 flex flex-col">{followUps.data.items.map((f) => <FollowUpRow key={f.id} item={f} showOwner />)}</ul>
          ) : (
            <EmptyState title="No follow-ups scheduled" compact />
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Meetings" />
        <CardBody>
          {meetings.data?.length ? (
            <ul className="-mx-2 flex flex-col">{meetings.data.map((m) => <MeetingRow key={m.id} meeting={m} />)}</ul>
          ) : (
            <EmptyState title="No meetings" compact />
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function LeadDeals({ lead }: { lead: LeadDetail }) {
  const deals = useDeals({ lead_id: lead.id });
  const proposals = useProposals({ lead_id: lead.id });
  if (!deals.data?.items.length && !proposals.data?.items.length) return null;
  return (
    <Card>
      <CardHeader title="Deals & proposals" />
      <CardBody className="flex flex-col gap-1">
        {deals.data?.items.map((d) => (
          <div key={d.id} className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-raised/50">
            <Handshake className="size-4 text-subtle" />
            <span className="flex-1 truncate text-sm">{d.title}</span>
            <span className="text-sm tabular-nums text-muted">{formatMoney(d.value, d.currency)}</span>
            <Badge tone={d.status === "won" ? "success" : d.status === "lost" ? "danger" : "info"}>{d.status}</Badge>
            <DealActions deal={d} />
          </div>
        ))}
        {proposals.data?.items.map((p) => (
          <Link key={p.id} to={`/sales/proposals/${p.id}`} className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-raised/50">
            <FilePlus2 className="size-4 text-subtle" />
            <span className="flex-1 truncate text-sm">{p.number}, {p.title}</span>
            <span className="text-sm tabular-nums text-muted">{formatMoney(p.total, p.currency)}</span>
            <Badge tone={PROPOSAL_TONE[p.status]}>{PROPOSAL_LABEL[p.status]}</Badge>
          </Link>
        ))}
      </CardBody>
    </Card>
  );
}

let registered = false;

/** Called once at startup (app.tsx). */
export function registerLeadSalesExtensions() {
  if (registered) return;
  registered = true;
  leadDetailExtensions.actions.push(LeadSalesActions);
  leadDetailExtensions.activity.push(LeadDeals, LeadSchedule, LeadOutreach);
}
