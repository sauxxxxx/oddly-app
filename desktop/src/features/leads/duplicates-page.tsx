import { CopyCheck, GitMerge, Lock } from "lucide-react";
import * as React from "react";
import { Link } from "react-router";

import { PageHeader } from "@/components/layout/app-shell";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useAuth, useMe } from "@/features/auth/auth-context";
import { errorMessage } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { DuplicateGroup } from "@/types/leads";

import { useDuplicateGroups, useMergeLeads } from "./api";

export function DuplicatesPage() {
  const { can } = useAuth();
  const allowed = can("leads.view_all") && can("leads.edit");
  const groups = useDuplicateGroups(allowed);

  return (
    <>
      <PageHeader
        title="Duplicate management"
        description="Leads that share a website, email, phone number, or name and city. Merge them to keep one clean record."
      />
      {!allowed ? (
        <Card><EmptyState icon={Lock} title="Needs access to all leads" description="Ask an administrator to review duplicates." /></Card>
      ) : groups.isPending ? (
        <Card className="p-6"><ListSkeleton rows={5} /></Card>
      ) : groups.isError ? (
        <Card><ErrorState error={groups.error} onRetry={() => void groups.refetch()} /></Card>
      ) : groups.data.length === 0 ? (
        <Card><EmptyState icon={CopyCheck} title="No duplicates found" description="Imports and new leads are checked automatically, so this should stay clean." /></Card>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted">{groups.data.length} possible duplicate group{groups.data.length === 1 ? "" : "s"}</p>
          {groups.data.map((g) => <GroupCard key={`${g.matched_by}:${g.value}`} group={g} />)}
        </div>
      )}
    </>
  );
}

function GroupCard({ group }: { group: DuplicateGroup }) {
  const me = useMe();
  const merge = useMergeLeads();
  const [keep, setKeep] = React.useState(group.leads[0]!.id);
  const [confirm, setConfirm] = React.useState(false);
  const others = group.leads.filter((l) => l.id !== keep);

  return (
    <Card>
      <CardHeader
        title={<span className="flex items-center gap-2">Same {group.matched_by} <Badge>{group.value}</Badge></span>}
        description="Choose the lead to keep. The others are merged into it."
        action={
          <Button variant="secondary" onClick={() => setConfirm(true)} loading={merge.isPending}>
            {!merge.isPending && <GitMerge />} Merge {others.length} into kept lead
          </Button>
        }
      />
      <CardBody>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
          {group.leads.map((l) => (
            <label
              key={l.id}
              className={cn(
                "flex cursor-pointer gap-3 rounded-control border p-3 transition-colors",
                keep === l.id ? "border-accent/50 bg-accent-soft/40" : "border-line hover:border-line-strong",
              )}
            >
              <input type="radio" name={`keep-${group.value}`} checked={keep === l.id} onChange={() => setKeep(l.id)} className="mt-1 accent-[#A855F7]" />
              <div className="min-w-0 text-sm">
                <Link to={`/leads/record/${l.id}`} className="font-medium hover:underline">{l.business_name}</Link>
                {keep === l.id && <Badge tone="accent" className="ml-2">Keep</Badge>}
                <p className="truncate text-xs text-subtle">{[l.city, l.contact_name, l.contact_email, l.website_url].filter(Boolean).join(" · ") || "No details"}</p>
                <p className="mt-1 text-xs text-subtle">
                  {l.stage_name} · {l.assigned_name ?? "Unassigned"} · added {formatDate(l.created_at, me.timezone, { year: "numeric" })}
                </p>
              </div>
            </label>
          ))}
        </div>
        {merge.isError && <p className="mt-3 text-sm text-danger">{errorMessage(merge.error)}</p>}
      </CardBody>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Merge these leads?"
        description="Outreach history, follow-ups, lists, deals and proposals move to the kept lead, and its blank details are filled from the others. The duplicates are then removed."
        confirmLabel="Merge"
        destructive={false}
        onConfirm={() => merge.mutateAsync({ keep_id: keep, merge_ids: others.map((o) => o.id) })}
      />
    </Card>
  );
}
