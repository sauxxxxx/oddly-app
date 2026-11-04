import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { useAuth } from "@/features/auth/auth-context";
import { errorMessage } from "@/lib/api";
import { formatRelative } from "@/lib/format";

import { useAnalyzeLead, type LeadAnalysis } from "./api";

function isAnalysis(v: unknown): v is LeadAnalysis {
  return !!v && typeof v === "object" && "analysis" in v;
}

function List({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-subtle">{title}</p>
      <ul className="flex list-disc flex-col gap-1 pl-4 text-sm text-muted">
        {items.map((t) => <li key={t}>{t}</li>)}
      </ul>
    </div>
  );
}

/** AI opportunity analysis for a lead — stored separately from the team's research and always labeled. */
export function AnalyzerCard({ leadId, suggestions, generatedAt }: { leadId: string; suggestions: unknown; generatedAt: string | null }) {
  const { can, me } = useAuth();
  const analyze = useAnalyzeLead(leadId);
  const stored = isAnalysis(suggestions) ? suggestions : null;
  const usable = !!me?.ai_configured && can("ai.use");
  const a = stored?.analysis;

  return (
    <Card className="self-start overflow-hidden">
      <CardHeader
        title="Opportunity analyzer"
        description="AI suggestions. Check before using."
      />
      <CardBody className="flex flex-col gap-4">
        {a ? (
          <>
            <p className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-warning-fg">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              {stored.label}. Generated {generatedAt ? formatRelative(generatedAt) : ""} by {stored.generated_by} from this lead's data only.
            </p>
            {a.summary && <p className="text-sm leading-relaxed text-fg">{a.summary}</p>}
            {a.opportunities.length > 0 && (
              <div>
                <p className="mb-1.5 text-xs font-medium text-subtle">Suggested services</p>
                <ul className="flex flex-col gap-2">
                  {a.opportunities.map((o) => (
                    <li key={o.service} className="rounded-md border border-line bg-raised/50 p-3 text-sm">
                      <p className="font-medium text-fg">{o.service}</p>
                      <p className="mt-0.5 text-muted">{o.why}</p>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {a.outreach_angle && (
              <div>
                <p className="mb-1.5 text-xs font-medium text-subtle">Outreach angle</p>
                <p className="text-sm text-muted">{a.outreach_angle}</p>
              </div>
            )}
            <List title="Observations" items={a.observations} />
            <List title="Check before relying on this" items={a.to_verify} />
            <List title="Missing information" items={a.data_gaps} />
          </>
        ) : (
          <p className="text-sm leading-relaxed text-muted">
            Reads this lead's details, your research and logged outreach, then suggests services and an outreach angle. It
            can't browse the web, so anything it can't confirm is listed for you to check.
          </p>
        )}
        {!usable ? (
          <p className="text-sm text-subtle">
            {!me?.ai_configured
              ? "Not available yet: an administrator needs to add an OpenAI key on the server."
              : "Your role doesn't include the AI assistant."}
          </p>
        ) : (
          <div>
            <Button variant="secondary" size="sm" onClick={() => analyze.mutate()} disabled={analyze.isPending}>
              {analyze.isPending ? "Analyzing…" : a ? "Analyze again" : "Analyze opportunity"}
            </Button>
            {analyze.isError && <p className="mt-2 text-sm text-danger-fg">{errorMessage(analyze.error)}</p>}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
