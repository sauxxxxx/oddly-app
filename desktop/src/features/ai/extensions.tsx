/** AI features contributed to other screens: "Draft with AI" on lead and client pages. */
import { Sparkles } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { useAuth } from "@/features/auth/auth-context";
import { clientDetailExtensions } from "@/features/clients/client-detail-page";
import { leadDetailExtensions } from "@/features/leads/lead-detail-page";
import type { ClientDetail } from "@/types/clients";
import type { LeadDetail } from "@/types/leads";

import { AiUnavailable } from "./assistant-page";
import { DraftDialog, DraftWriter } from "./draft-writer";

function LeadDraftAction({ lead }: { lead: LeadDetail }) {
  const { can, me } = useAuth();
  const [open, setOpen] = React.useState(false);
  if (!me?.ai_configured || !can("ai.use")) return null;
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <Sparkles /> Draft with AI
      </Button>
      {open && (
        <DraftDialog
          open={open}
          onOpenChange={setOpen}
          record={{ type: "lead", id: lead.id, name: lead.business_name }}
          kind={lead.last_contacted_at ? "follow_up" : "outreach"}
          kinds={["outreach", "follow_up", "proposal_description", "meeting_summary"]}
        />
      )}
    </>
  );
}

function ClientAiTab({ client }: { client: ClientDetail }) {
  const { can, me } = useAuth();
  if (!me?.ai_configured || !can("ai.use")) return <Card><CardBody className="pt-5"><AiUnavailable configured={!!me?.ai_configured} /></CardBody></Card>;
  return (
    <Card>
      <CardHeader title="Draft with AI" description="Suggestions only — edit and copy what you want; nothing is sent or saved." />
      <CardBody>
        <DraftWriter
          initialKind="client_summary"
          initialRecord={{ type: "client", id: client.id, name: client.company.name }}
          lockRecord
          kinds={["client_summary", "caption", "content_ideas", "proposal_description", "meeting_summary"]}
        />
      </CardBody>
    </Card>
  );
}

let registered = false;

export function registerAiExtensions() {
  if (registered) return;
  registered = true;
  leadDetailExtensions.actions.push(LeadDraftAction);
  clientDetailExtensions.tabs.push({ value: "ai", label: "AI drafts", component: ClientAiTab });
}
