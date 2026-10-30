import { ShieldCheck } from "lucide-react";

import { PageHeader } from "@/components/layout/app-shell";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

import { useRoles } from "./team-page";

export function RolesPage() {
  const roles = useRoles();

  return (
    <>
      <PageHeader
        title="Roles & permissions"
        description="Built-in roles. Editing individual permissions arrives with Team Management in Phase 5."
      />
      {roles.isPending ? (
        <Card className="p-6">
          <ListSkeleton rows={6} />
        </Card>
      ) : roles.isError ? (
        <Card>
          <ErrorState error={roles.error} onRetry={() => void roles.refetch()} />
        </Card>
      ) : roles.data.length === 0 ? (
        <Card>
          <EmptyState icon={ShieldCheck} title="No roles found" description="Apply the database migrations to create the built-in roles." />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {roles.data.map((r) => (
            <Card key={r.id} className="gap-3 p-5">
              <div className="flex items-start justify-between gap-3">
                <span className="flex size-10 items-center justify-center rounded-xl border border-accent/25 bg-accent-soft text-accent">
                  <ShieldCheck className="size-5" />
                </span>
                <Badge>
                  {r.member_count} member{r.member_count === 1 ? "" : "s"}
                </Badge>
              </div>
              <div>
                <p className="font-medium">{r.name}</p>
                <p className="mt-1 text-sm leading-relaxed text-muted">{r.description}</p>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
