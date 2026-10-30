import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  CircleAlert,
  CircleCheck,
  Download,
  FileSpreadsheet,
  History,
  RefreshCw,
  Upload,
} from "lucide-react";
import * as React from "react";
import { Link } from "react-router";

import { PageHeader } from "@/components/layout/app-shell";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Tabs } from "@/components/ui/form-controls";
import { Field, Select } from "@/components/ui/input";
import { Progress } from "@/components/ui/misc";
import { useAuth, useMe } from "@/features/auth/auth-context";
import { FormAlert } from "@/features/auth/auth-layout";
import { api, errorMessage } from "@/lib/api";
import { formatRelative } from "@/lib/format";
import { exportRows, parseSpreadsheet, type ParsedSheet } from "@/lib/spreadsheet";
import { cn } from "@/lib/utils";
import type { ImportIssue, ImportRowResult, LeadStatus, Market } from "@/types/leads";

import { exportLeads, useImportHistory, useInvalidateLeads, useLookups } from "./api";
import { buildRow, guessMapping, IMPORT_FIELDS, type ImportField, type MarketDefault } from "./import-mapping";
import { LEAD_EXPORT_COLUMNS } from "./lead-columns";

const BATCH = 250;

type Step = "upload" | "map" | "preview" | "importing" | "done";
type Mode = "skip" | "update" | "create";

interface Options {
  marketDefault: MarketDefault;
  list_id: string;
  assigned_to: string;
  source_id: string;
  stage_id: string;
}

export function ImportExportPage() {
  const { can } = useAuth();
  const [tab, setTab] = React.useState<"import" | "export" | "history">(can("leads.import") ? "import" : "export");

  return (
    <>
      <PageHeader
        title="Import / Export"
        description="Bring in your lead spreadsheets (XLSX or CSV), or take your leads out to Excel."
      />
      <Tabs
        value={tab}
        onChange={setTab}
        className="mb-4"
        tabs={[
          ...(can("leads.import") ? [{ value: "import" as const, label: "Import" }] : []),
          ...(can("leads.export") ? [{ value: "export" as const, label: "Export" }] : []),
          ...(can("leads.import") ? [{ value: "history" as const, label: "Import history" }] : []),
        ]}
      />
      {tab === "import" && <ImportWizard />}
      {tab === "export" && <ExportCard />}
      {tab === "history" && <ImportHistory />}
    </>
  );
}

// ---------------------------------------------------------------------------

function ImportWizard() {
  const me = useMe();
  const lookups = useLookups();
  const invalidate = useInvalidateLeads();
  const qc = useQueryClient();
  const [step, setStep] = React.useState<Step>("upload");
  const [file, setFile] = React.useState<File | null>(null);
  const [sheet, setSheet] = React.useState<ParsedSheet | null>(null);
  const [parseError, setParseError] = React.useState<string | null>(null);
  const [mapping, setMapping] = React.useState<Partial<Record<ImportField, number>>>({});
  const [options, setOptions] = React.useState<Options>({ marketDefault: "infer", list_id: "", assigned_to: me.id, source_id: "", stage_id: "" });
  const [issues, setIssues] = React.useState<ImportIssue[]>([]);
  const [mode, setMode] = React.useState<Mode>("update");
  const [progress, setProgress] = React.useState(0);
  const [results, setResults] = React.useState<ImportRowResult[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const rows = React.useMemo(
    () => (sheet ? sheet.rows.map((r) => buildRow(r, mapping, options.marketDefault)) : []),
    [sheet, mapping, options.marketDefault],
  );
  const apiOptions = {
    list_id: options.list_id || undefined,
    assigned_to: options.assigned_to || undefined,
    source_id: options.source_id || undefined,
    stage_id: options.stage_id || undefined,
  };

  async function onFile(f: File) {
    setParseError(null);
    try {
      const parsed = await parseSpreadsheet(f);
      if (parsed.rows.length === 0) throw new Error("The file has a header row but no data rows.");
      if (parsed.rows.length > 20_000) throw new Error("Split files larger than 20,000 rows into smaller ones.");
      setFile(f);
      setSheet(parsed);
      setMapping(guessMapping(parsed.headers));
      setStep("map");
    } catch (e) {
      setParseError(errorMessage(e));
    }
  }

  async function runPreview() {
    setBusy(true);
    setError(null);
    setProgress(0);
    const found: ImportIssue[] = [];
    try {
      for (let offset = 0; offset < rows.length; offset += BATCH) {
        const batch = rows.slice(offset, offset + BATCH);
        found.push(...(await api<ImportIssue[]>("/leads/import/preview", { method: "POST", body: { rows: batch, options: apiOptions, offset } })));
        setProgress(Math.min(100, ((offset + batch.length) / rows.length) * 100));
      }
      setIssues(found);
      setStep("preview");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function runImport() {
    setStep("importing");
    setError(null);
    setProgress(0);
    const all: ImportRowResult[] = [];
    let jobId: string | undefined;
    try {
      for (let offset = 0; offset < rows.length; offset += BATCH) {
        const batch = rows.slice(offset, offset + BATCH);
        const res = await api<{ job_id: string; results: ImportRowResult[] }>("/leads/import", {
          method: "POST",
          body: {
            job_id: jobId,
            file_name: file?.name ?? "spreadsheet",
            mode,
            rows: batch,
            options: apiOptions,
            offset,
            total_rows: rows.length,
            last: offset + BATCH >= rows.length,
          },
        });
        jobId = res.job_id;
        all.push(...res.results);
        setResults([...all]);
        setProgress(Math.min(100, ((offset + batch.length) / rows.length) * 100));
      }
      setStep("done");
    } catch (e) {
      setError(`${errorMessage(e)} Rows already imported are saved; you can re-import the same file with “Update existing” to finish.`);
      setStep("done");
    } finally {
      invalidate();
      void qc.invalidateQueries({ queryKey: ["leads", "imports"] });
    }
  }

  function restart() {
    setStep("upload");
    setFile(null);
    setSheet(null);
    setIssues([]);
    setResults([]);
    setError(null);
  }

  if (step === "upload") {
    return (
      <Card>
        <CardBody className="pt-5">
          <DropZone onFile={onFile} error={parseError} />
          <div className="mt-5 grid gap-3 text-sm text-muted md:grid-cols-3">
            <Tip title="Any column order">ODDLY matches columns like “Business Name”, “FB Page” or “Municipality” for you, and you can adjust them.</Tip>
            <Tip title="No duplicates">Rows are checked against existing leads by website, email, phone and name + city before anything is saved.</Tip>
            <Tip title="Update instead of copy">Re-importing a sheet can fill in missing details on leads you already have.</Tip>
          </div>
        </CardBody>
      </Card>
    );
  }

  if (step === "map" && sheet) {
    const mappedCount = Object.keys(mapping).length;
    return (
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader
            title="Match your columns"
            description={`${file?.name} · ${sheet.rows.length.toLocaleString()} rows · ${mappedCount} of ${sheet.headers.length} columns matched`}
            action={<Button variant="ghost" size="sm" onClick={restart}><ArrowLeft /> Other file</Button>}
          />
          <CardBody>
            <div className="grid grid-cols-1 gap-x-6 gap-y-3 md:grid-cols-2">
              {IMPORT_FIELDS.map((f) => (
                <div key={f.field} className="flex items-center justify-between gap-3">
                  <label htmlFor={`map-${f.field}`} className="text-sm text-muted">
                    {f.label}
                    {f.field === "business_name" && <span className="text-danger"> *</span>}
                  </label>
                  <Select
                    id={`map-${f.field}`}
                    value={mapping[f.field] ?? ""}
                    onChange={(e) =>
                      setMapping((m) => {
                        const next = { ...m };
                        if (e.target.value === "") delete next[f.field];
                        else next[f.field] = Number(e.target.value);
                        return next;
                      })
                    }
                    className={cn("h-9 w-52", mapping[f.field] !== undefined && "border-accent/40")}
                  >
                    <option value="">— Don't import —</option>
                    {sheet.headers.map((h, i) => (
                      <option key={i} value={i}>
                        {h}
                      </option>
                    ))}
                  </Select>
                </div>
              ))}
            </div>
            <div className="mt-6">
              <p className="mb-2 text-xs font-medium uppercase tracking-[0.08em] text-subtle">First rows as ODDLY will read them</p>
              <SamplePreview rows={rows.slice(0, 5)} />
            </div>
          </CardBody>
        </Card>

        <Card className="self-start">
          <CardHeader title="For every imported lead" />
          <CardBody className="flex flex-col gap-4">
            <Field label="Market when the sheet doesn't say" htmlFor="opt-market">
              <Select id="opt-market" value={options.marketDefault} onChange={(e) => setOptions((o) => ({ ...o, marketDefault: e.target.value as MarketDefault }))}>
                <option value="infer">From country (Philippines = local)</option>
                <option value="local">Local</option>
                <option value="international">International</option>
              </Select>
            </Field>
            <Field label="Add to lead list" htmlFor="opt-list">
              <Select id="opt-list" value={options.list_id} onChange={(e) => setOptions((o) => ({ ...o, list_id: e.target.value }))}>
                <option value="">No list</option>
                {lookups.data?.lead_lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </Select>
            </Field>
            <Field label="Assign to" htmlFor="opt-assign">
              <Select id="opt-assign" value={options.assigned_to} onChange={(e) => setOptions((o) => ({ ...o, assigned_to: e.target.value }))}>
                <option value="">Unassigned</option>
                {lookups.data?.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </Select>
            </Field>
            <Field label="Lead source (if no column)" htmlFor="opt-source">
              <Select id="opt-source" value={options.source_id} onChange={(e) => setOptions((o) => ({ ...o, source_id: e.target.value }))}>
                <option value="">Not specified</option>
                {lookups.data?.lead_sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </Field>
            <Field label="Pipeline stage (if no column)" htmlFor="opt-stage">
              <Select id="opt-stage" value={options.stage_id} onChange={(e) => setOptions((o) => ({ ...o, stage_id: e.target.value }))}>
                <option value="">First stage</option>
                {lookups.data?.pipeline_stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </Field>
            {error && <FormAlert>{error}</FormAlert>}
            {busy && <Progress value={progress} />}
            <Button onClick={() => void runPreview()} loading={busy} disabled={mapping.business_name === undefined}>
              {!busy && <ArrowRight />} Check {rows.length.toLocaleString()} rows
            </Button>
            {mapping.business_name === undefined && <p className="text-xs text-danger">Choose the column with the business name.</p>}
          </CardBody>
        </Card>
      </div>
    );
  }

  if (step === "preview") {
    const failed = issues.filter((i) => Object.keys(i.errors).length > 0);
    const existing = issues.filter((i) => i.duplicate && !Object.keys(i.errors).length);
    const inFile = issues.filter((i) => i.duplicate_of_row !== null && !i.duplicate && !Object.keys(i.errors).length);
    const clean = rows.length - failed.length - existing.length - inFile.length;
    return (
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader
            title="Review before importing"
            description="Nothing has been saved yet."
            action={<Button variant="ghost" size="sm" onClick={() => setStep("map")}><ArrowLeft /> Back to mapping</Button>}
          />
          <CardBody>
            <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label="New leads" value={clean} tone="success" />
              <Stat label="Already in ODDLY" value={existing.length} tone="warning" />
              <Stat label="Repeated in file" value={inFile.length} tone="neutral" />
              <Stat label="Can't import" value={failed.length} tone="danger" />
            </div>
            {issues.length === 0 ? (
              <EmptyState icon={CircleCheck} title="Every row looks good" description="No errors and no duplicates were found." compact />
            ) : (
              <div className="max-h-[420px] overflow-y-auto rounded-control border border-line">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-card">
                    <tr className="border-b border-line text-left text-xs uppercase tracking-[0.06em] text-subtle">
                      <th className="px-3 py-2 font-medium">Row</th>
                      <th className="px-3 py-2 font-medium">Business</th>
                      <th className="px-3 py-2 font-medium">What we found</th>
                    </tr>
                  </thead>
                  <tbody>
                    {issues.slice(0, 500).map((i) => (
                      <tr key={i.index} className="border-b border-line/60 last:border-0">
                        <td className="px-3 py-2 tabular-nums text-subtle">{i.index + 2}</td>
                        <td className="px-3 py-2">{String(rows[i.index]?.business_name ?? "") || <span className="text-subtle">(blank)</span>}</td>
                        <td className="px-3 py-2 text-[13px]">
                          {Object.keys(i.errors).length > 0 ? (
                            <span className="text-danger-fg">{Object.values(i.errors).join(" ")}</span>
                          ) : i.duplicate ? (
                            <span className="text-warning-fg">
                              Matches <Link className="underline" to={`/leads/record/${i.duplicate.lead_id}`}>{i.duplicate.business_name}</Link> by {i.duplicate.matched_by}
                            </span>
                          ) : (
                            <span className="text-muted">Same business as row {(i.duplicate_of_row ?? 0) + 2}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-2 text-xs text-subtle">Row numbers match your spreadsheet (row 1 is the header).</p>
          </CardBody>
        </Card>
        <Card className="self-start">
          <CardHeader title="When a lead already exists" />
          <CardBody className="flex flex-col gap-3">
            {(
              [
                ["update", "Update existing", "Fill in missing details from the sheet. Values in the sheet replace what's there; blanks are ignored."],
                ["skip", "Skip it", "Leave the existing lead untouched."],
                ["create", "Create a copy anyway", "Import every row as a new lead, even if it looks like a duplicate."],
              ] as [Mode, string, string][]
            ).map(([value, label, hint]) => (
              <label
                key={value}
                className={cn(
                  "flex cursor-pointer gap-3 rounded-control border p-3 transition-colors",
                  mode === value ? "border-accent/50 bg-accent-soft/40" : "border-line hover:border-line-strong",
                )}
              >
                <input type="radio" name="mode" value={value} checked={mode === value} onChange={() => setMode(value)} className="mt-1 accent-[#A855F7]" />
                <span>
                  <span className="block text-sm font-medium">{label}</span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-subtle">{hint}</span>
                </span>
              </label>
            ))}
            <Button className="mt-2" onClick={() => void runImport()} disabled={rows.length === failed.length}>
              <Upload /> Import {(rows.length - failed.length).toLocaleString()} rows
            </Button>
          </CardBody>
        </Card>
      </div>
    );
  }

  // importing / done
  const count = (o: ImportRowResult["outcome"]) => results.filter((r) => r.outcome === o).length;
  const problems = results.filter((r) => r.outcome === "failed" || r.outcome === "skipped");
  return (
    <Card>
      <CardHeader
        title={step === "importing" ? "Importing…" : error ? "Import stopped" : "Import complete"}
        description={file?.name}
        action={
          step === "done" && (
            <>
              <Button variant="secondary" onClick={restart}><RefreshCw /> Import another file</Button>
              <Button asChild><Link to="/leads">View leads</Link></Button>
            </>
          )
        }
      />
      <CardBody>
        {step === "importing" && (
          <div className="mb-5">
            <Progress value={progress} className="h-2" />
            <p className="mt-2 text-xs text-subtle">{results.length.toLocaleString()} of {rows.length.toLocaleString()} rows · keep this window open</p>
          </div>
        )}
        {error && <div className="mb-4"><FormAlert>{error}</FormAlert></div>}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Created" value={count("created")} tone="success" />
          <Stat label="Updated" value={count("updated")} tone="accent" />
          <Stat label="Skipped" value={count("skipped")} tone="neutral" />
          <Stat label="Failed" value={count("failed")} tone="danger" />
        </div>
        {step === "done" && problems.length > 0 && (
          <div className="mt-5 flex items-center justify-between gap-3 rounded-control border border-line bg-raised/50 p-4">
            <p className="text-sm text-muted">{problems.length.toLocaleString()} rows were skipped or failed. Download them with the reason for each, fix, and re-import.</p>
            <Button
              variant="secondary"
              onClick={() =>
                void exportRows(
                  "csv",
                  "Import problems",
                  [
                    { header: "Row", value: (r: ImportRowResult) => r.index + 2 },
                    { header: "Outcome", value: (r) => r.outcome },
                    { header: "Business name", value: (r) => String(rows[r.index]?.business_name ?? "") },
                    { header: "Reason", value: (r) => r.message },
                  ],
                  problems,
                )
              }
            >
              <Download /> Error report
            </Button>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function DropZone({ onFile, error }: { onFile: (f: File) => void; error: string | null }) {
  const [over, setOver] = React.useState(false);
  const input = React.useRef<HTMLInputElement>(null);
  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={() => input.current?.click()}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const f = e.dataTransfer.files[0];
          if (f) onFile(f);
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-card border-2 border-dashed px-6 py-14 text-center transition-colors",
          over ? "border-accent bg-accent-soft/40" : "border-line hover:border-line-strong",
        )}
      >
        <span className="flex size-12 items-center justify-center rounded-2xl border border-accent/25 bg-accent-soft text-accent">
          <FileSpreadsheet className="size-6" />
        </span>
        <div>
          <p className="font-medium">Drop a spreadsheet here, or click to choose</p>
          <p className="mt-1 text-sm text-subtle">Excel (.xlsx) or CSV · first sheet · up to 20,000 rows</p>
        </div>
      </div>
      <input
        ref={input}
        type="file"
        accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
      {error && <div className="mt-3"><FormAlert>{error}</FormAlert></div>}
    </>
  );
}

function SamplePreview({ rows }: { rows: Record<string, unknown>[] }) {
  const cols: [string, string][] = [
    ["business_name", "Business"],
    ["market", "Market"],
    ["city", "City"],
    ["country", "Country"],
    ["contact_name", "Contact"],
    ["business_phone", "Phone"],
    ["website_url", "Website"],
  ];
  return (
    <div className="overflow-x-auto rounded-control border border-line">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-line text-left text-xs text-subtle">
            {cols.map(([, l]) => <th key={l} className="px-3 py-2 font-medium">{l}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-line/60 last:border-0">
              {cols.map(([k]) => (
                <td key={k} className="max-w-48 truncate px-3 py-2 text-muted">
                  {String(r[k] ?? "") || <span className="text-subtle">—</span>}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: "success" | "warning" | "neutral" | "danger" | "accent" }) {
  const color = { success: "text-success-fg", warning: "text-warning-fg", neutral: "text-fg", danger: "text-danger-fg", accent: "text-accent-fg" }[tone];
  return (
    <div className="rounded-control border border-line bg-raised/40 p-3">
      <p className={cn("text-2xl font-semibold tabular-nums", color)}>{value.toLocaleString()}</p>
      <p className="mt-0.5 text-xs text-subtle">{label}</p>
    </div>
  );
}

function Tip({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-control border border-line bg-raised/30 p-3">
      <p className="text-sm font-medium text-fg">{title}</p>
      <p className="mt-1 text-xs leading-relaxed text-subtle">{children}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------

function ExportCard() {
  const lookups = useLookups();
  const [market, setMarket] = React.useState<"" | Market>("");
  const [status, setStatus] = React.useState<"" | LeadStatus>("active");
  const [listId, setListId] = React.useState("");
  const [busy, setBusy] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function run(format: "xlsx" | "csv") {
    setBusy(format);
    setError(null);
    setResult(null);
    try {
      const rows = await exportLeads({ market: market || undefined, status, list_id: listId || undefined });
      if (rows.length === 0) {
        setError("No leads match these options.");
        return;
      }
      const saved = await exportRows(format, market === "local" ? "Local leads" : market === "international" ? "International leads" : "Leads", LEAD_EXPORT_COLUMNS, rows);
      if (saved) setResult(`Exported ${rows.length.toLocaleString()} leads.`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="max-w-2xl">
      <CardHeader title="Export leads" description="Columns match the import format, so an exported file can be edited and imported back." />
      <CardBody className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field label="Market" htmlFor="ex-market">
            <Select id="ex-market" value={market} onChange={(e) => setMarket(e.target.value as Market | "")}>
              <option value="">Local and international</option>
              <option value="local">Local only</option>
              <option value="international">International only</option>
            </Select>
          </Field>
          <Field label="Status" htmlFor="ex-status">
            <Select id="ex-status" value={status} onChange={(e) => setStatus(e.target.value as LeadStatus | "")}>
              <option value="active">Active</option>
              <option value="">All statuses</option>
              <option value="converted">Converted</option>
              <option value="disqualified">Disqualified</option>
            </Select>
          </Field>
          <Field label="Lead list" htmlFor="ex-list">
            <Select id="ex-list" value={listId} onChange={(e) => setListId(e.target.value)}>
              <option value="">All lists</option>
              {lookups.data?.lead_lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
          </Field>
        </div>
        {error && <FormAlert>{error}</FormAlert>}
        {result && <FormAlert tone="info">{result}</FormAlert>}
        <div className="flex gap-2">
          <Button onClick={() => void run("xlsx")} loading={busy === "xlsx"} disabled={!!busy}>
            {busy !== "xlsx" && <FileSpreadsheet />} Excel (.xlsx)
          </Button>
          <Button variant="secondary" onClick={() => void run("csv")} loading={busy === "csv"} disabled={!!busy}>
            {busy !== "csv" && <Download />} CSV
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

function ImportHistory() {
  const history = useImportHistory();
  if (history.isPending) return <Card className="p-6"><ListSkeleton rows={4} /></Card>;
  if (history.isError) return <Card><ErrorState error={history.error} onRetry={() => void history.refetch()} /></Card>;
  if (history.data.length === 0) {
    return <Card><EmptyState icon={History} title="No imports yet" description="Each spreadsheet import is recorded here with its results." /></Card>;
  }
  return (
    <Card className="overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs uppercase tracking-[0.06em] text-subtle">
            <th className="px-5 py-3 font-medium">File</th>
            <th className="px-4 py-3 font-medium">By</th>
            <th className="px-4 py-3 font-medium">When</th>
            <th className="px-4 py-3 font-medium">Duplicates</th>
            <th className="px-4 py-3 text-right font-medium">Created</th>
            <th className="px-4 py-3 text-right font-medium">Updated</th>
            <th className="px-4 py-3 text-right font-medium">Skipped</th>
            <th className="px-5 py-3 text-right font-medium">Failed</th>
          </tr>
        </thead>
        <tbody>
          {history.data.map((j) => (
            <tr key={j.id} className="border-b border-line/60 last:border-0">
              <td className="px-5 py-3">
                <span className="flex items-center gap-2">
                  <FileSpreadsheet className="size-4 text-subtle" />
                  {j.file_name}
                  {!j.finished_at && <Badge tone="warning">Incomplete</Badge>}
                </span>
              </td>
              <td className="px-4 py-3 text-muted">{j.user_name ?? "—"}</td>
              <td className="px-4 py-3 text-muted">{formatRelative(j.started_at)}</td>
              <td className="px-4 py-3 text-muted">{{ skip: "Skipped", update: "Updated", create: "Copied" }[j.mode]}</td>
              <td className="px-4 py-3 text-right tabular-nums">{j.created}</td>
              <td className="px-4 py-3 text-right tabular-nums">{j.updated}</td>
              <td className="px-4 py-3 text-right tabular-nums text-muted">{j.skipped}</td>
              <td className="px-5 py-3 text-right tabular-nums">
                {j.failed > 0 ? (
                  <span className="inline-flex items-center gap-1 text-danger-fg"><CircleAlert className="size-3.5" />{j.failed}</span>
                ) : (
                  0
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
