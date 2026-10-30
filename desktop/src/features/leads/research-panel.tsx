import { Save, Sparkles } from "lucide-react";
import * as React from "react";

import { ErrorState, ListSkeleton } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { TagInput, Textarea } from "@/components/ui/form-controls";
import { Field } from "@/components/ui/input";
import { useAuth } from "@/features/auth/auth-context";
import { errorMessage } from "@/lib/api";
import { formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Research } from "@/types/leads";

import { useResearch, useSaveResearch } from "./api";
import { SERVICE_SUGGESTIONS } from "./lead-form";

const SCORES = [
  { key: "website_quality", label: "Website quality" },
  { key: "social_activity", label: "Social media activity" },
  { key: "branding_quality", label: "Branding quality" },
  { key: "content_consistency", label: "Content consistency" },
  { key: "online_presence", label: "Overall online presence" },
] as const;

type ScoreKey = (typeof SCORES)[number]["key"];

const SCORE_LABELS = ["", "Poor", "Weak", "Average", "Good", "Excellent"];

function emptyForm(r: Research | null | undefined) {
  return {
    website_quality: r?.website_quality ?? null,
    social_activity: r?.social_activity ?? null,
    branding_quality: r?.branding_quality ?? null,
    content_consistency: r?.content_consistency ?? null,
    online_presence: r?.online_presence ?? null,
    marketing_weaknesses: r?.marketing_weaknesses ?? "",
    potential_services: r?.potential_services ?? [],
    findings: r?.findings ?? "",
    outreach_strategy: r?.outreach_strategy ?? "",
  };
}

export function ResearchPanel({ leadId }: { leadId: string }) {
  const research = useResearch(leadId);
  const save = useSaveResearch(leadId);
  const { can, me } = useAuth();
  const [form, setForm] = React.useState(() => emptyForm(null));
  const editable = can("leads.edit");

  React.useEffect(() => {
    if (research.data !== undefined) setForm(emptyForm(research.data));
  }, [research.data]);

  if (research.isPending) return <Card className="p-6"><ListSkeleton rows={5} /></Card>;
  if (research.isError) return <Card><ErrorState error={research.error} onRetry={() => void research.refetch()} /></Card>;

  const scored = SCORES.map((s) => form[s.key]).filter((v): v is number => v !== null);
  const average = scored.length ? scored.reduce((a, b) => a + b, 0) / scored.length : null;

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      <Card>
        <CardHeader
          title="Research"
          description={
            research.data?.updated_at
              ? `Last updated ${formatRelative(research.data.updated_at)}${research.data.researched_by_name ? ` by ${research.data.researched_by_name}` : ""}`
              : "Score what you find online, then plan how to approach them."
          }
          action={
            average !== null && (
              <Badge tone={average < 2.5 ? "success" : average < 3.5 ? "warning" : "neutral"}>
                {average < 2.5 ? "Strong opportunity" : average < 3.5 ? "Some gaps" : "Already strong online"}
              </Badge>
            )
          }
        />
        <CardBody>
          <form
            className="flex flex-col gap-5"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate(form);
            }}
          >
            <div className="flex flex-col gap-3">
              {SCORES.map((s) => (
                <ScoreRow
                  key={s.key}
                  label={s.label}
                  value={form[s.key]}
                  disabled={!editable}
                  onChange={(v) => setForm((f) => ({ ...f, [s.key as ScoreKey]: v }))}
                />
              ))}
            </div>
            <Field label="Marketing weaknesses" htmlFor="r-weak">
              <Textarea id="r-weak" disabled={!editable} value={form.marketing_weaknesses} rows={3}
                onChange={(e) => setForm((f) => ({ ...f, marketing_weaknesses: e.target.value }))}
                placeholder="e.g. No website, last Facebook post 8 months ago, inconsistent logo" />
            </Field>
            <Field label="Potential services" htmlFor="r-services">
              <TagInput id="r-services" value={form.potential_services} suggestions={SERVICE_SUGGESTIONS}
                onChange={(v) => setForm((f) => ({ ...f, potential_services: v }))} />
            </Field>
            <Field label="Research findings" htmlFor="r-findings">
              <Textarea id="r-findings" disabled={!editable} value={form.findings} rows={4}
                onChange={(e) => setForm((f) => ({ ...f, findings: e.target.value }))} />
            </Field>
            <Field label="Suggested outreach strategy" htmlFor="r-strategy">
              <Textarea id="r-strategy" disabled={!editable} value={form.outreach_strategy} rows={3}
                onChange={(e) => setForm((f) => ({ ...f, outreach_strategy: e.target.value }))}
                placeholder="e.g. Message the owner on Facebook with 3 quick wins for their page" />
            </Field>
            {save.isError && <p className="text-sm text-danger">{errorMessage(save.error)}</p>}
            {editable && (
              <div className="flex items-center justify-end gap-3">
                {save.isSuccess && <span className="text-sm text-success-fg">Saved</span>}
                <Button type="submit" loading={save.isPending}>
                  {!save.isPending && <Save />} Save research
                </Button>
              </div>
            )}
          </form>
        </CardBody>
      </Card>

      <Card className="self-start overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute -right-14 -top-14 size-40 rounded-full bg-accent/15 blur-3xl" />
        <CardHeader
          title={<span className="flex items-center gap-2"><Sparkles className="size-4 text-accent" /> Opportunity analyzer</span>}
          description="AI suggestions · always labeled, never added automatically"
        />
        <CardBody>
          <p className="text-sm leading-relaxed text-muted">
            The analyzer will read this lead's details and your research, then suggest services and an outreach angle. It
            won't invent facts about the business — anything it can't verify is marked as a guess.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-subtle">
            {me?.ai_configured
              ? "Arrives with the AI Assistant in Phase 6."
              : "Arrives with the AI Assistant in Phase 6, once an administrator adds an OpenAI key on the server."}
          </p>
          <Button variant="secondary" size="sm" className="mt-4" disabled>
            <Sparkles /> Analyze opportunity
          </Button>
        </CardBody>
      </Card>
    </div>
  );
}

function ScoreRow({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm text-muted">{label}</span>
      <div className="flex items-center gap-2">
        <span className="w-16 text-right text-xs text-subtle">{value ? SCORE_LABELS[value] : "Not scored"}</span>
        <div className="flex gap-1" role="radiogroup" aria-label={label}>
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={value === n}
              aria-label={`${n} — ${SCORE_LABELS[n]}`}
              disabled={disabled}
              onClick={() => onChange(value === n ? null : n)}
              className={cn(
                "size-7 rounded-lg border text-xs font-medium tabular-nums transition-colors",
                value !== null && n <= value
                  ? "border-accent/40 bg-accent/80 text-white"
                  : "border-line bg-raised text-subtle hover:border-line-strong hover:text-fg",
              )}
            >
              {n}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
