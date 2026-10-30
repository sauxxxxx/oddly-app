import {
  Bookmark,
  ChevronDown,
  Download,
  FileSpreadsheet,
  ListPlus,
  Plus,
  Search,
  Trash2,
  Upload,
  Users,
  X,
} from "lucide-react";
import * as React from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

import { PageHeader } from "@/components/layout/app-shell";
import { EmptyState, ErrorState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DataTable, Pagination, type SortState } from "@/components/ui/data-table";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Checkbox } from "@/components/ui/form-controls";
import { Field, Input, Select } from "@/components/ui/input";
import { useAuth, useMe } from "@/features/auth/auth-context";
import { FormAlert } from "@/features/auth/auth-layout";
import { errorMessage } from "@/lib/api";
import { exportRows } from "@/lib/spreadsheet";
import { cn } from "@/lib/utils";
import type { LeadFilters, Market } from "@/types/leads";

import {
  exportLeads,
  useBulkLeads,
  useDeleteSavedFilter,
  useFacets,
  useLeads,
  useLookups,
  useSaveFilter,
  useSavedFilters,
  type BulkAction,
} from "./api";
import { LEAD_EXPORT_COLUMNS, leadColumns } from "./lead-columns";
import { LeadFormDialog } from "./lead-form";

const FILTER_KEYS = [
  "search", "status", "stage_id", "source_id", "assigned", "list_id", "priority", "country", "industry",
  "stale_days", "researched", "sort", "dir", "page",
] as const;

/** Filters live in the URL so Back returns to the same view. */
function useUrlFilters(market?: Market, listId?: string) {
  const [params, setParams] = useSearchParams();
  const filters: LeadFilters = { per_page: 50, status: "active" };
  for (const k of FILTER_KEYS) {
    const v = params.get(k);
    if (v === null) continue;
    if (k === "page" || k === "stale_days") (filters as Record<string, unknown>)[k] = Number(v);
    else if (k === "researched") filters.researched = v === "true";
    else (filters as Record<string, unknown>)[k] = v;
  }
  if (params.get("status") === "all") filters.status = "";
  if (market) filters.market = market;
  if (listId) filters.list_id = listId;

  // `status` also accepts "all" (stored in the URL to mean "no status filter").
  const update = (patch: Partial<Omit<LeadFilters, "status">> & { status?: string }, keepPage = false) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(patch)) {
          if (v === undefined || v === null || v === "") next.delete(k);
          else next.set(k, String(v));
        }
        if (!keepPage) next.delete("page");
        return next;
      },
      { replace: true },
    );
  };
  const reset = () => setParams(new URLSearchParams(), { replace: true });
  return { filters, update, reset, params };
}

export function LeadsPage({
  market,
  listId,
  title,
  description,
  embedded,
}: {
  market?: Market;
  listId?: string;
  title?: string;
  description?: string;
  /** Rendered inside another page (lead list detail): no page header. */
  embedded?: boolean;
}) {
  const me = useMe();
  const { can } = useAuth();
  const navigate = useNavigate();
  const { filters, update, reset, params } = useUrlFilters(market, listId);
  const leads = useLeads(filters);
  const lookups = useLookups();
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [adding, setAdding] = React.useState(false);
  const [exporting, setExporting] = React.useState<string | null>(null);
  const [exportError, setExportError] = React.useState<string | null>(null);
  const [searchDraft, setSearchDraft] = React.useState(filters.search ?? "");

  // Debounced search.
  React.useEffect(() => {
    const t = setTimeout(() => {
      if ((filters.search ?? "") !== searchDraft) update({ search: searchDraft });
    }, 300);
    return () => clearTimeout(t);
  }, [searchDraft]); // eslint-disable-line react-hooks/exhaustive-deps -- only react to typing

  React.useEffect(() => {
    setSelected(new Set());
  }, [params.toString()]); // eslint-disable-line react-hooks/exhaustive-deps -- clear selection when the view changes

  const columns = React.useMemo(() => leadColumns(me.timezone), [me.timezone]);
  const activeFilterCount = FILTER_KEYS.filter(
    (k) => !["search", "sort", "dir", "page"].includes(k) && params.get(k) !== null,
  ).length;
  const data = leads.data;
  const pageTitle = title ?? (market === "local" ? "Local leads" : market === "international" ? "International leads" : "All leads");

  async function doExport(format: "xlsx" | "csv") {
    setExporting(format);
    setExportError(null);
    try {
      const rows = await exportLeads(filters);
      await exportRows(format, pageTitle, LEAD_EXPORT_COLUMNS, rows);
    } catch (e) {
      setExportError(errorMessage(e));
    } finally {
      setExporting(null);
    }
  }

  const header = (
    <PageHeader
      title={pageTitle}
      description={
        description ??
        (data ? `${data.total.toLocaleString()} ${filters.status === "active" ? "active " : ""}lead${data.total === 1 ? "" : "s"}` : " ")
      }
      actions={
        <>
          {can("leads.import") && (
            <Button asChild variant="secondary">
              <Link to="/leads/import">
                <Upload /> Import
              </Link>
            </Button>
          )}
          {can("leads.export") && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" loading={!!exporting} disabled={!data?.total}>
                  {!exporting && <Download />} Export <ChevronDown className="text-subtle" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Exports every lead matching the current filters</DropdownMenuLabel>
                <DropdownMenuItem onSelect={() => void doExport("xlsx")}>
                  <FileSpreadsheet /> Excel (.xlsx)
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void doExport("csv")}>
                  <FileSpreadsheet /> CSV
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {can("leads.create") && (
            <Button onClick={() => setAdding(true)}>
              <Plus /> Add lead
            </Button>
          )}
        </>
      }
    />
  );

  return (
    <>
      {!embedded && header}
      {exportError && <div className="mb-4"><FormAlert>{exportError}</FormAlert></div>}

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-4">
          <div className="relative min-w-60 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
            <Input
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              placeholder="Search business, contact, city, email, website…"
              className="pl-9"
              aria-label="Search leads"
            />
          </div>
          <FilterSelect
            label="Status"
            value={params.get("status") ?? "active"}
            onChange={(v) => update({ status: v === "active" ? "" : v })}
            options={[
              ["active", "Active"],
              ["all", "All statuses"],
              ["converted", "Converted"],
              ["disqualified", "Disqualified"],
              ["archived", "Archived"],
            ]}
          />
          <FilterSelect
            label="Stage"
            value={filters.stage_id ?? ""}
            onChange={(v) => update({ stage_id: v })}
            options={[["", "All stages"], ...(lookups.data?.pipeline_stages.map((s) => [s.id, s.name] as [string, string]) ?? [])]}
          />
          <FilterSelect
            label="Owner"
            value={filters.assigned ?? ""}
            onChange={(v) => update({ assigned: v })}
            options={[
              ["", "Anyone"],
              ["me", "Me"],
              ["unassigned", "Unassigned"],
              ...(lookups.data?.members.filter((m) => m.id !== me.id).map((m) => [m.id, m.name] as [string, string]) ?? []),
            ]}
          />
          <FilterSelect
            label="Priority"
            value={filters.priority ?? ""}
            onChange={(v) => update({ priority: v as LeadFilters["priority"] })}
            options={[["", "Any priority"], ["urgent", "Urgent"], ["high", "High"], ["medium", "Medium"], ["low", "Low"]]}
          />
          <MoreFilters filters={filters} update={update} hideList={!!listId} />
          <SavedFilters filters={filters} onApply={(f) => {
            reset();
            update({ ...f, page: undefined } as LeadFilters);
          }} />
          {activeFilterCount > 0 && (
            <Button variant="ghost" size="sm" onClick={() => { reset(); setSearchDraft(""); }}>
              <X /> Clear
            </Button>
          )}
        </div>

        {selected.size > 0 && (
          <BulkBar
            ids={[...selected]}
            onDone={() => setSelected(new Set())}
            listId={listId}
          />
        )}

        {leads.isError && !data ? (
          <ErrorState error={leads.error} onRetry={() => void leads.refetch()} />
        ) : data && data.total === 0 && !leads.isFetching ? (
          activeFilterCount > 0 || filters.search ? (
            <EmptyState
              icon={Search}
              title="No leads match these filters"
              description="Try removing a filter or searching for something else."
              action={<Button variant="secondary" size="sm" onClick={() => { reset(); setSearchDraft(""); }}>Clear filters</Button>}
            />
          ) : (
            <EmptyState
              icon={Users}
              title={listId ? "This list is empty" : "No leads yet"}
              description={
                listId
                  ? "Add leads to this list from any lead table: select them, then use “Add to list”."
                  : "Add businesses one by one, or import your existing spreadsheets — ODDLY maps the columns and flags duplicates."
              }
              action={
                !listId && (
                  <div className="flex gap-2">
                    {can("leads.import") && (
                      <Button asChild variant="secondary" size="sm">
                        <Link to="/leads/import"><Upload /> Import spreadsheet</Link>
                      </Button>
                    )}
                    {can("leads.create") && (
                      <Button size="sm" onClick={() => setAdding(true)}>
                        <Plus /> Add lead
                      </Button>
                    )}
                  </div>
                )
              }
            />
          )
        ) : (
          <>
            <div className={cn(leads.isPlaceholderData && "opacity-60 transition-opacity")}>
              <DataTable
                columns={columns}
                rows={data?.items ?? []}
                loading={leads.isPending}
                sort={{ sort: filters.sort ?? "created_at", dir: filters.dir ?? "desc" }}
                onSort={(s: SortState) => update({ sort: s.sort, dir: s.dir })}
                selected={can("leads.edit") ? selected : undefined}
                onSelectedChange={setSelected}
                onRowClick={(l) => navigate(`/leads/record/${l.id}`)}
              />
            </div>
            {data && data.total > 0 && (
              <Pagination page={data.page} perPage={data.per_page} total={data.total} onPage={(p) => update({ page: p }, true)} />
            )}
          </>
        )}
      </Card>

      <LeadFormDialog
        open={adding}
        onOpenChange={setAdding}
        defaultMarket={market ?? "local"}
        onSaved={(l) => navigate(`/leads/record/${l.id}`)}
      />
    </>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
}) {
  return (
    <Select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="h-10 w-auto min-w-36">
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </Select>
  );
}

function MoreFilters({
  filters,
  update,
  hideList,
}: {
  filters: LeadFilters;
  update: (p: Partial<LeadFilters>) => void;
  hideList?: boolean;
}) {
  const lookups = useLookups();
  const facets = useFacets();
  const [open, setOpen] = React.useState(false);
  const count = [filters.source_id, filters.country, filters.industry, filters.stale_days, filters.researched, !hideList && filters.list_id].filter(
    (v) => v !== undefined && v !== "" && v !== false,
  ).length;

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        More filters{count > 0 && <span className="rounded-md bg-accent-soft px-1.5 text-xs text-accent">{count}</span>}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="More filters" className="max-w-lg">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Lead source" htmlFor="f-source">
              <Select id="f-source" value={filters.source_id ?? ""} onChange={(e) => update({ source_id: e.target.value })}>
                <option value="">Any source</option>
                {lookups.data?.lead_sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </Field>
            {!hideList && (
              <Field label="Lead list" htmlFor="f-list">
                <Select id="f-list" value={filters.list_id ?? ""} onChange={(e) => update({ list_id: e.target.value })}>
                  <option value="">Any list</option>
                  {lookups.data?.lead_lists.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </Select>
              </Field>
            )}
            <Field label="Country" htmlFor="f-country">
              <Select id="f-country" value={filters.country ?? ""} onChange={(e) => update({ country: e.target.value })}>
                <option value="">Any country</option>
                {facets.data?.countries.map((c) => <option key={c}>{c}</option>)}
              </Select>
            </Field>
            <Field label="Industry" htmlFor="f-industry">
              <Select id="f-industry" value={filters.industry ?? ""} onChange={(e) => update({ industry: e.target.value })}>
                <option value="">Any industry</option>
                {facets.data?.industries.map((c) => <option key={c}>{c}</option>)}
              </Select>
            </Field>
            <Field label="Not contacted in" htmlFor="f-stale" hint="Active leads with no outreach in this period (or ever).">
              <Select id="f-stale" value={filters.stale_days ?? ""} onChange={(e) => update({ stale_days: e.target.value ? Number(e.target.value) : undefined })}>
                <option value="">Any time</option>
                <option value="7">7 days</option>
                <option value="14">14 days</option>
                <option value="30">30 days</option>
                <option value="60">60 days</option>
              </Select>
            </Field>
            <Field label="Research" htmlFor="f-research">
              <Select
                id="f-research"
                value={filters.researched === undefined ? "" : String(filters.researched)}
                onChange={(e) => update({ researched: e.target.value === "" ? undefined : e.target.value === "true" })}
              >
                <option value="">Any</option>
                <option value="false">Not researched yet</option>
                <option value="true">Researched</option>
              </Select>
            </Field>
          </div>
          <DialogFooter>
            <Button onClick={() => setOpen(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function SavedFilters({ filters, onApply }: { filters: LeadFilters; onApply: (f: LeadFilters) => void }) {
  const saved = useSavedFilters();
  const save = useSaveFilter();
  const remove = useDeleteSavedFilter();
  const [naming, setNaming] = React.useState(false);
  const [name, setName] = React.useState("");
  const [shared, setShared] = React.useState(false);

  const { page: _p, per_page: _pp, market: _m, ...toSave } = filters;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" aria-label="Saved filters">
            <Bookmark /> Saved
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          {saved.data?.length ? (
            saved.data.map((f) => (
              <DropdownMenuItem key={f.id} onSelect={() => onApply(f.filters)} className="justify-between">
                <span className="truncate">{f.name}</span>
                {f.mine ? (
                  <button
                    className="text-subtle hover:text-danger"
                    aria-label={`Delete ${f.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      remove.mutate(f.id);
                    }}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                ) : (
                  <span className="text-xs text-subtle">Shared</span>
                )}
              </DropdownMenuItem>
            ))
          ) : (
            <DropdownMenuLabel>No saved filters yet</DropdownMenuLabel>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setNaming(true)}>
            <Plus /> Save current filters…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={naming} onOpenChange={setNaming}>
        <DialogContent title="Save filters" description="Get back to this view in one click." className="max-w-md">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim()) return;
              save.mutate({ name, filters: toSave, is_shared: shared }, { onSuccess: () => { setNaming(false); setName(""); } });
            }}
            className="flex flex-col gap-4"
          >
            <Field label="Name" htmlFor="sf-name" error={save.error ? errorMessage(save.error) : undefined}>
              <Input id="sf-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Hot Cebu resorts" />
            </Field>
            <label className="flex items-center gap-2.5 text-sm text-muted">
              <Checkbox checked={shared} onChange={setShared} label="Share with the team" /> Share with the team
            </label>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setNaming(false)}>Cancel</Button>
              <Button type="submit" loading={save.isPending} disabled={!name.trim()}>Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function BulkBar({ ids, onDone, listId }: { ids: string[]; onDone: () => void; listId?: string }) {
  const lookups = useLookups();
  const bulk = useBulkLeads();
  const { can } = useAuth();
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const run = (action: BulkAction) => bulk.mutate({ ...action, ids }, { onSuccess: onDone });

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-line bg-accent-soft/40 px-4 py-2.5 animate-fade-in">
      <span className="mr-2 text-sm font-medium">{ids.length} selected</span>
      <BulkMenu label="Assign" loading={bulk.isPending}>
        <DropdownMenuItem onSelect={() => run({ action: "assign", user_id: null })}>Unassigned</DropdownMenuItem>
        {lookups.data?.members.map((m) => (
          <DropdownMenuItem key={m.id} onSelect={() => run({ action: "assign", user_id: m.id })}>{m.name}</DropdownMenuItem>
        ))}
      </BulkMenu>
      <BulkMenu label="Move to stage">
        {lookups.data?.pipeline_stages.map((s) => (
          <DropdownMenuItem key={s.id} onSelect={() => run({ action: "stage", stage_id: s.id })}>
            <span className="size-2 rounded-full" style={{ background: s.color }} /> {s.name}
          </DropdownMenuItem>
        ))}
      </BulkMenu>
      <BulkMenu label="Priority">
        {["urgent", "high", "medium", "low"].map((p) => (
          <DropdownMenuItem key={p} onSelect={() => run({ action: "priority", priority: p })} className="capitalize">{p}</DropdownMenuItem>
        ))}
      </BulkMenu>
      <BulkMenu label="Status">
        {["active", "disqualified", "archived"].map((s) => (
          <DropdownMenuItem key={s} onSelect={() => run({ action: "status", status: s })} className="capitalize">{s}</DropdownMenuItem>
        ))}
      </BulkMenu>
      <BulkMenu label="Add to list" icon={<ListPlus />}>
        {lookups.data?.lead_lists.length ? (
          lookups.data.lead_lists.map((l) => (
            <DropdownMenuItem key={l.id} onSelect={() => run({ action: "add_to_list", list_id: l.id })}>{l.name}</DropdownMenuItem>
          ))
        ) : (
          <DropdownMenuLabel>Create a list in Lead Lists first</DropdownMenuLabel>
        )}
      </BulkMenu>
      {listId && (
        <Button variant="secondary" size="sm" onClick={() => run({ action: "remove_from_list", list_id: listId })}>
          Remove from this list
        </Button>
      )}
      {can("leads.delete") && (
        <Button variant="ghost" size="sm" className="text-danger-fg" onClick={() => setConfirmDelete(true)}>
          <Trash2 /> Delete
        </Button>
      )}
      <Button variant="ghost" size="sm" onClick={onDone} className="ml-auto">
        Clear selection
      </Button>
      {bulk.isError && <span className="w-full text-xs text-danger">{errorMessage(bulk.error)}</span>}
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete ${ids.length} lead${ids.length === 1 ? "" : "s"}?`}
        description="They'll disappear from every list and report. An administrator can still recover them from the database."
        onConfirm={() => bulk.mutateAsync({ action: "delete", ids }).then(onDone)}
      />
    </div>
  );
}

function BulkMenu({ label, children, loading, icon }: { label: string; children: React.ReactNode; loading?: boolean; icon?: React.ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" size="sm" disabled={loading}>
          {icon}
          {label} <ChevronDown className="text-subtle" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
