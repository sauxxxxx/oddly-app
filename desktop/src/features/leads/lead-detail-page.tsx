import {
  ArrowLeft,
  AtSign,
  Building2,
  ExternalLink,
  Globe,
  MapPin,
  Pencil,
  Phone,
  Trash2,
  UserRound,
} from "lucide-react";
import * as React from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";

import { FacebookIcon as Facebook, InstagramIcon as Instagram, LinkedinIcon as Linkedin } from "@/components/brand/social-icons";
import { PageHeader } from "@/components/layout/app-shell";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/states";
import { Badge, PriorityBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Tabs } from "@/components/ui/form-controls";
import { Avatar } from "@/components/ui/misc";
import { useAuth, useMe } from "@/features/auth/auth-context";
import { ApiError } from "@/lib/api";
import { displayUrl, openExternal } from "@/lib/external";
import { formatDate, formatMoney, formatRelative, formatTime } from "@/lib/format";
import type { LeadDetail } from "@/types/leads";

import { useDeleteLead, useLead } from "./api";
import { StageDot } from "./lead-columns";
import { LeadFormDialog } from "./lead-form";
import { ResearchPanel } from "./research-panel";

export type LeadTab = "overview" | "research" | "activity";

/**
 * Extra panels other modules contribute to the lead page (Phase 3 adds outreach,
 * follow-ups and meetings). Registered in features/sales.
 */
export const leadDetailExtensions: {
  actions: React.ComponentType<{ lead: LeadDetail }>[];
  activity: React.ComponentType<{ lead: LeadDetail }>[];
} = { actions: [], activity: [] };

export function LeadDetailPage() {
  const { id = "" } = useParams();
  const lead = useLead(id);
  const navigate = useNavigate();
  const { can } = useAuth();
  const [params] = useSearchParams();
  const [tab, setTab] = React.useState<LeadTab>(() => (params.get("tab") as LeadTab | null) ?? "overview");
  const [editing, setEditing] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const remove = useDeleteLead();

  if (lead.isPending) return <Card className="p-6"><ListSkeleton rows={6} /></Card>;
  if (lead.isError) {
    if (lead.error instanceof ApiError && lead.error.status === 404) {
      return (
        <Card>
          <EmptyState
            icon={Building2}
            title="Lead not found"
            description="It may have been deleted or merged into another lead, or it isn't assigned to you."
            action={<Button asChild variant="secondary" size="sm"><Link to="/leads"><ArrowLeft /> All leads</Link></Button>}
          />
        </Card>
      );
    }
    return <Card><ErrorState error={lead.error} onRetry={() => void lead.refetch()} /></Card>;
  }

  const l = lead.data;
  const Actions = leadDetailExtensions.actions;

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-3">
        <Link to={l.market === "international" ? "/leads/international" : "/leads/local"}>
          <ArrowLeft /> {l.market === "international" ? "International leads" : "Local leads"}
        </Link>
      </Button>
      <PageHeader
        title={l.business_name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StageDot name={l.stage_name} color={l.stage_color} />
            <span className="text-subtle">·</span>
            <span>{[l.industry, l.city, l.country].filter(Boolean).join(" · ") || "No details yet"}</span>
            {l.status !== "active" && <Badge tone={l.status === "converted" ? "success" : "neutral"}>{l.status}</Badge>}
            {l.client_id && <Badge tone="success">Client</Badge>}
          </span>
        }
        actions={
          <>
            {Actions.map((A, i) => <A key={i} lead={l} />)}
            {can("leads.edit") && (
              <Button variant="secondary" onClick={() => setEditing(true)}>
                <Pencil /> Edit
              </Button>
            )}
            {can("leads.delete") && (
              <Button variant="ghost" size="icon" aria-label="Delete lead" onClick={() => setDeleting(true)}>
                <Trash2 />
              </Button>
            )}
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { value: "overview", label: "Overview" },
              { value: "research", label: "Research" },
              { value: "activity", label: "Activity", count: l.timeline.length || undefined },
            ]}
            className="self-start"
          />
          {tab === "overview" && <Overview lead={l} />}
          {tab === "research" && <ResearchPanel leadId={l.id} />}
          {tab === "activity" && <Activity lead={l} />}
        </div>
        <Summary lead={l} />
      </div>

      <LeadFormDialog open={editing} onOpenChange={setEditing} lead={l} />
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete ${l.business_name}?`}
        description="The lead disappears from lists and reports. Its history is kept for the audit log."
        onConfirm={() => remove.mutateAsync(l.id).then(() => navigate("/leads"))}
      />
    </>
  );
}

function InfoRow({ icon: Icon, label, children }: { icon: React.ComponentType<{ className?: string }>; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-2">
      <Icon className="mt-0.5 size-4 shrink-0 text-subtle" />
      <div className="min-w-0 flex-1">
        <p className="text-xs text-subtle">{label}</p>
        <div className="mt-0.5 break-words text-sm text-fg">{children}</div>
      </div>
    </div>
  );
}

function LinkValue({ url }: { url: string | null }) {
  if (!url) return <span className="text-subtle">—</span>;
  return (
    <button onClick={() => openExternal(url)} className="inline-flex max-w-full items-center gap-1 text-left text-accent hover:underline">
      <span className="truncate">{displayUrl(url)}</span>
      <ExternalLink className="size-3 shrink-0" />
    </button>
  );
}

function Overview({ lead: l }: { lead: LeadDetail }) {
  const dash = <span className="text-subtle">—</span>;
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader title="Business" />
        <CardBody className="pt-2">
          <InfoRow icon={Building2} label="Industry / category">{[l.industry, l.category].filter(Boolean).join(" · ") || dash}</InfoRow>
          <InfoRow icon={MapPin} label="Location">
            {[l.address, l.city, l.region, l.country].filter(Boolean).join(", ") || dash}
            <span className="ml-2"><Badge>{l.market === "local" ? "Local" : "International"}</Badge></span>
          </InfoRow>
          <InfoRow icon={Phone} label="Business phone">{l.business_phone ?? dash}</InfoRow>
          <InfoRow icon={AtSign} label="Business email">{l.business_email ?? dash}</InfoRow>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Online presence" />
        <CardBody className="pt-2">
          <InfoRow icon={Globe} label="Website"><LinkValue url={l.website_url} /></InfoRow>
          <InfoRow icon={Facebook} label="Facebook"><LinkValue url={l.facebook_url} /></InfoRow>
          <InfoRow icon={Instagram} label="Instagram"><LinkValue url={l.instagram_url} /></InfoRow>
          <InfoRow icon={Linkedin} label="LinkedIn"><LinkValue url={l.linkedin_url} /></InfoRow>
          <InfoRow icon={MapPin} label="Google Maps"><LinkValue url={l.google_maps_url} /></InfoRow>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Contact person" />
        <CardBody className="pt-2">
          {l.contact_name || l.contact_email || l.contact_phone ? (
            <>
              <InfoRow icon={UserRound} label="Name">
                {l.contact_name ?? dash}
                {l.contact_position && <span className="text-subtle"> · {l.contact_position}</span>}
              </InfoRow>
              <InfoRow icon={AtSign} label="Email">{l.contact_email ?? dash}</InfoRow>
              <InfoRow icon={Phone} label="Phone">{l.contact_phone ?? dash}</InfoRow>
            </>
          ) : (
            <EmptyState icon={UserRound} title="No contact person yet" description="Add one with Edit once you find who makes decisions." compact />
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Notes" />
        <CardBody className="pt-2">
          {l.research_notes ? (
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted">{l.research_notes}</p>
          ) : (
            <EmptyState icon={Pencil} title="No notes" description="Quick notes from your research go here." compact />
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function Activity({ lead }: { lead: LeadDetail }) {
  const Extra = leadDetailExtensions.activity;
  return (
    <div className="flex flex-col gap-4">
      {Extra.map((E, i) => <E key={i} lead={lead} />)}
      <Card>
        <CardHeader title="History" description="Every change to this lead" />
        <CardBody>
          {lead.timeline.length === 0 ? (
            <EmptyState icon={Building2} title="No history yet" compact />
          ) : (
            <ol className="relative flex flex-col gap-4 before:absolute before:bottom-2 before:left-[17px] before:top-2 before:w-px before:bg-line">
              {lead.timeline.map((a) => (
                <li key={a.id} className="relative flex items-start gap-3">
                  <Avatar name={a.actor_name ?? "System"} className="size-9 ring-4" />
                  <div className="pt-0.5">
                    <p className="text-sm text-fg">{a.summary}</p>
                    <p className="mt-0.5 text-xs text-subtle">{formatRelative(a.created_at)}</p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function Summary({ lead: l }: { lead: LeadDetail }) {
  const me = useMe();
  const overdue = l.status === "active" && l.next_action_due_at && new Date(l.next_action_due_at) < new Date();
  const rows: [string, React.ReactNode][] = [
    ["Owner", l.assigned_name ?? "Unassigned"],
    ["Priority", <PriorityBadge key="p" priority={l.priority} />],
    ["Estimated value", l.estimated_value ? formatMoney(l.estimated_value, l.currency) : "—"],
    ["Source", [l.source_name, l.source_detail].filter(Boolean).join(" · ") || "—"],
    ["Last contacted", l.last_contacted_at ? formatRelative(l.last_contacted_at) : "Never"],
    ["Added", formatDate(l.created_at, me.timezone, { year: "numeric" })],
  ];
  return (
    <div className="flex flex-col gap-4 self-start">
      <Card className={overdue ? "border-danger/40" : "border-accent/30"}>
        <CardBody className="pt-5">
          <p className="text-xs font-medium uppercase tracking-[0.08em] text-subtle">Next action</p>
          <p className="mt-2 text-[15px] font-medium text-fg">{l.next_action ?? "None set"}</p>
          {l.next_action_due_at && (
            <p className={overdue ? "mt-1 text-sm text-danger-fg" : "mt-1 text-sm text-muted"}>
              {overdue ? "Overdue · " : "Due "}
              {formatDate(l.next_action_due_at, me.timezone, { weekday: "short", month: "short", day: "numeric" })}{" "}
              {formatTime(l.next_action_due_at, me.timezone)}
            </p>
          )}
        </CardBody>
      </Card>
      <Card>
        <CardBody className="pt-5">
          <dl className="flex flex-col gap-3">
            {rows.map(([k, v]) => (
              <div key={k} className="flex items-center justify-between gap-3 text-sm">
                <dt className="text-subtle">{k}</dt>
                <dd className="truncate text-right text-fg">{v}</dd>
              </div>
            ))}
          </dl>
          {l.potential_services.length > 0 && (
            <div className="mt-4 border-t border-line pt-4">
              <p className="mb-2 text-xs text-subtle">Potential services</p>
              <div className="flex flex-wrap gap-1.5">
                {l.potential_services.map((s) => <Badge key={s} tone="accent">{s}</Badge>)}
              </div>
            </div>
          )}
          {l.lists.length > 0 && (
            <div className="mt-4 border-t border-line pt-4">
              <p className="mb-2 text-xs text-subtle">Lead lists</p>
              <div className="flex flex-wrap gap-1.5">
                {l.lists.map((list) => (
                  <Link key={list.id} to={`/leads/lists/${list.id}`}>
                    <Badge className="hover:border-line-strong">
                      <span className="size-1.5 rounded-full" style={{ background: list.color }} /> {list.name}
                    </Badge>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
