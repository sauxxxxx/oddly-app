import type * as React from "react";

import { PageHeader } from "@/components/layout/app-shell";
import { ErrorState, ListSkeleton } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { useAiStatus } from "@/features/ai/api";

function Row({
  name,
  status,
  children,
}: {
  name: string;
  status: "connected" | "not_configured";
  children: React.ReactNode;
}) {
  return (
    <Card className="flex flex-col gap-3 p-5 sm:flex-row sm:items-start">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium">{name}</p>
          {status === "connected" ? (
            <Badge tone="success">Connected</Badge>
          ) : (
            <Badge tone="warning">Not configured</Badge>
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
      <PageHeader title="Integrations" />
      {ai.isPending ? (
        <ListSkeleton rows={3} />
      ) : ai.isError ? (
        <ErrorState error={ai.error} onRetry={() => void ai.refetch()} />
      ) : (
        <div className="flex flex-col gap-3">
          <Row name="OpenAI" status={ai.data.configured ? "connected" : "not_configured"}>
            {ai.data.configured ? (
              <>Using model <span className="font-medium text-fg">{ai.data.model}</span>. Powers the assistant, draft writer, lead analyzer and dashboard insights.</>
            ) : (
              "Add the OpenAI key to the server settings, then restart the server."
            )}
          </Row>
        </div>
      )}
    </div>
  );
}
