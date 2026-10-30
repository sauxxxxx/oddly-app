import { Microscope } from "lucide-react";
import * as React from "react";
import { useNavigate } from "react-router";

import { PageHeader } from "@/components/layout/app-shell";
import { EmptyState, ErrorState } from "@/components/states";
import { Card } from "@/components/ui/card";
import { DataTable, Pagination } from "@/components/ui/data-table";
import { Tabs } from "@/components/ui/form-controls";
import { useMe } from "@/features/auth/auth-context";

import { useLeads } from "./api";
import { leadColumns } from "./lead-columns";

/** Research queue: leads waiting to be researched, and ones already done. */
export function LeadResearchPage() {
  const me = useMe();
  const navigate = useNavigate();
  const [researched, setResearched] = React.useState<"todo" | "done">("todo");
  const [page, setPage] = React.useState(1);
  const leads = useLeads({ status: "active", researched: researched === "done", page, per_page: 50, sort: "created_at", dir: "desc" });
  const columns = React.useMemo(() => leadColumns(me.timezone).filter((c) => ["business", "stage", "priority", "assigned", "next"].includes(c.key)), [me.timezone]);

  return (
    <>
      <PageHeader
        title="Lead research"
        description="Score each business's website, social media and branding, then plan the outreach."
      />
      <Tabs
        className="mb-4"
        value={researched}
        onChange={(v) => {
          setResearched(v);
          setPage(1);
        }}
        tabs={[
          { value: "todo", label: "Needs research" },
          { value: "done", label: "Researched" },
        ]}
      />
      <Card className="overflow-hidden">
        {leads.isError ? (
          <ErrorState error={leads.error} onRetry={() => void leads.refetch()} />
        ) : leads.data?.total === 0 ? (
          <EmptyState
            icon={Microscope}
            title={researched === "todo" ? "Nothing waiting for research" : "No researched leads yet"}
            description={researched === "todo" ? "Every active lead you can see has been researched." : "Open a lead and use its Research tab."}
          />
        ) : (
          <>
            <DataTable
              columns={columns}
              rows={leads.data?.items ?? []}
              loading={leads.isPending}
              onRowClick={(l) => navigate(`/leads/record/${l.id}?tab=research`)}
            />
            {leads.data && <Pagination page={leads.data.page} perPage={leads.data.per_page} total={leads.data.total} onPage={setPage} />}
          </>
        )}
      </Card>
    </>
  );
}
