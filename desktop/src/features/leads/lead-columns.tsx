import { Globe } from "lucide-react";

import { Badge, PriorityBadge } from "@/components/ui/badge";
import type { Column } from "@/components/ui/data-table";
import type { ExportColumn } from "@/lib/spreadsheet";
import { formatDate, formatMoney, formatRelative } from "@/lib/format";
import type { Lead } from "@/types/leads";

export function StageDot({ name, color }: { name: string; color: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[13px] text-muted">
      <span className="size-2 rounded-full" style={{ background: color }} />
      {name}
    </span>
  );
}

export function leadColumns(timeZone: string): Column<Lead>[] {
  return [
    {
      key: "business",
      header: "Business",
      sortKey: "business_name",
      cell: (l) => (
        <div className="min-w-0 max-w-[280px]">
          <p className="truncate font-medium text-fg">{l.business_name}</p>
          <p className="flex items-center gap-1.5 truncate text-xs text-subtle">
            {l.market === "international" && <Globe className="size-3 shrink-0" />}
            {[l.city, l.region, l.market === "international" ? l.country : null].filter(Boolean).join(", ") ||
              l.industry ||
              "—"}
          </p>
        </div>
      ),
    },
    {
      key: "contact",
      header: "Contact",
      cell: (l) =>
        l.contact_name || l.contact_email ? (
          <div className="max-w-[200px]">
            <p className="truncate text-[13px] text-muted">{l.contact_name ?? "—"}</p>
            <p className="truncate text-xs text-subtle">{l.contact_email ?? l.contact_phone ?? l.business_phone ?? ""}</p>
          </div>
        ) : (
          <span className="text-xs text-subtle">{l.business_phone ?? l.business_email ?? "—"}</span>
        ),
    },
    {
      key: "stage",
      header: "Stage",
      sortKey: "stage",
      cell: (l) => (
        <div className="flex flex-col items-start gap-1">
          <StageDot name={l.stage_name} color={l.stage_color} />
          {l.status !== "active" && <Badge tone={l.status === "converted" ? "success" : "neutral"}>{l.status}</Badge>}
        </div>
      ),
    },
    { key: "priority", header: "Priority", sortKey: "priority", cell: (l) => <PriorityBadge priority={l.priority} /> },
    {
      key: "assigned",
      header: "Owner",
      cell: (l) => <span className="whitespace-nowrap text-[13px] text-muted">{l.assigned_name ?? "Unassigned"}</span>,
    },
    {
      key: "next",
      header: "Next action",
      sortKey: "next_action_due_at",
      cell: (l) => {
        const overdue = l.status === "active" && l.next_action_due_at && new Date(l.next_action_due_at) < new Date();
        return (
          <div className="max-w-[220px]">
            <p className="truncate text-[13px] text-muted">{l.next_action ?? "—"}</p>
            {l.next_action_due_at && (
              <p className={overdue ? "text-xs text-[#fca5a5]" : "text-xs text-subtle"}>
                {overdue ? "Overdue · " : ""}
                {formatDate(l.next_action_due_at, timeZone)}
              </p>
            )}
          </div>
        );
      },
    },
    {
      key: "contacted",
      header: "Last contact",
      sortKey: "last_contacted_at",
      cell: (l) => (
        <span className="whitespace-nowrap text-[13px] text-subtle">{l.last_contacted_at ? formatRelative(l.last_contacted_at) : "Never"}</span>
      ),
    },
    {
      key: "value",
      header: "Est. value",
      sortKey: "estimated_value",
      headerClassName: "text-right",
      className: "text-right",
      cell: (l) => (
        <span className="whitespace-nowrap text-[13px] tabular-nums text-muted">
          {l.estimated_value ? formatMoney(l.estimated_value, l.currency, { compact: Number(l.estimated_value) >= 100_000 }) : "—"}
        </span>
      ),
    },
  ];
}

/** Spreadsheet columns, in the same order import mapping expects them. */
export const LEAD_EXPORT_COLUMNS: ExportColumn<Lead>[] = [
  { header: "Business name", value: (l) => l.business_name },
  { header: "Industry", value: (l) => l.industry },
  { header: "Category", value: (l) => l.category },
  { header: "Market", value: (l) => (l.market === "local" ? "Local" : "International") },
  { header: "Country", value: (l) => l.country },
  { header: "Region / state", value: (l) => l.region },
  { header: "City / municipality", value: (l) => l.city },
  { header: "Address", value: (l) => l.address },
  { header: "Website", value: (l) => l.website_url },
  { header: "Facebook", value: (l) => l.facebook_url },
  { header: "Instagram", value: (l) => l.instagram_url },
  { header: "LinkedIn", value: (l) => l.linkedin_url },
  { header: "Google Maps", value: (l) => l.google_maps_url },
  { header: "Business phone", value: (l) => l.business_phone },
  { header: "Business email", value: (l) => l.business_email },
  { header: "Contact person", value: (l) => l.contact_name },
  { header: "Contact position", value: (l) => l.contact_position },
  { header: "Contact email", value: (l) => l.contact_email },
  { header: "Contact phone", value: (l) => l.contact_phone },
  { header: "Lead source", value: (l) => l.source_name },
  { header: "Source details", value: (l) => l.source_detail },
  { header: "Stage", value: (l) => l.stage_name },
  { header: "Status", value: (l) => l.status },
  { header: "Priority", value: (l) => l.priority },
  { header: "Assigned to", value: (l) => l.assigned_name },
  { header: "Potential services", value: (l) => l.potential_services.join(", ") },
  { header: "Estimated value", value: (l) => (l.estimated_value ? Number(l.estimated_value) : null) },
  { header: "Currency", value: (l) => l.currency },
  { header: "Next action", value: (l) => l.next_action },
  { header: "Next action due", value: (l) => l.next_action_due_at?.slice(0, 10) },
  { header: "Last contacted", value: (l) => l.last_contacted_at?.slice(0, 10) },
  { header: "Research notes", value: (l) => l.research_notes },
  { header: "Created", value: (l) => l.created_at.slice(0, 10) },
];
