import { CalendarDays, CircleCheck, CircleDashed, Mail, Sparkles } from "lucide-react";
import type * as React from "react";

import { PageHeader } from "@/components/layout/app-shell";
import { ErrorState, ListSkeleton } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { useAiStatus } from "@/features/ai/api";

function Row({
  icon: Icon,
  name,
  status,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  name: string;
  status: "connected" | "not_configured" | "planned";
  children: React.ReactNode;
}) {
  return (
    <Card className="flex flex-col gap-3 p-5 sm:flex-row sm:items-start">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-raised text-accent">
        <Icon className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium">{name}</p>
          {status === "connected" ? (
            <Badge tone="success"><CircleCheck className="size-3" /> Connected</Badge>
          ) : status === "not_configured" ? (
            <Badge tone="warning"><CircleDashed className="size-3" /> Not configured</Badge>
          ) : (
            <Badge tone="neutral">Not available yet</Badge>
          )}
        </div>
        <div className="mt-1.5 text-sm leading-relaxed text-muted">{children}</div>
      </div>
    </Card>
  );
}

/** Real connection status for each integration — nothing is shown as connected unless it is. */
export function IntegrationsPage() {
  const ai = useAiStatus();
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Integrations" description="Services ODDLY connects to. Credentials live on the server, never in the apps." />
      {ai.isPending ? (
        <ListSkeleton rows={3} />
      ) : ai.isError ? (
        <ErrorState error={ai.error} onRetry={() => void ai.refetch()} />
      ) : (
        <div className="flex flex-col gap-3">
          <Row icon={Sparkles} name="OpenAI — AI assistant" status={ai.data.configured ? "connected" : "not_configured"}>
            {ai.data.configured ? (
              <>Using model <span className="font-medium text-fg">{ai.data.model}</span>. Powers the assistant, draft writer, lead analyzer and dashboard insights.</>
            ) : (
              <>
                Add <code className="rounded bg-raised px-1 py-0.5 text-xs">OPENAI_API_KEY</code> (and optionally{" "}
                <code className="rounded bg-raised px-1 py-0.5 text-xs">OPENAI_MODEL</code>) to the API server's environment and restart it. The key is
                never sent to the desktop or web app.
              </>
            )}
          </Row>
          <Row icon={Mail} name="Email" status="planned">
            Sending email from ODDLY isn't built. Outreach drafts are copied into your own email client, then logged as an interaction.
          </Row>
          <Row icon={CalendarDays} name="Calendar" status="planned">
            Calendar sync isn't built. Meetings are scheduled in ODDLY and add reminders for the people involved.
          </Row>
        </div>
      )}
    </div>
  );
}
