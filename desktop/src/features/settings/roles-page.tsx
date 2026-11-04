
import { PageHeader } from "@/components/layout/app-shell";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/states";
import { Card } from "@/components/ui/card";

import { useRoles } from "./team-page";

export function RolesPage() {
  const roles = useRoles();

  return (
    <>
      <PageHeader
        title="Roles & permissions"
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
          <EmptyState title="No roles found" />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {roles.data.map((r) => (
            <Card key={r.id} className="gap-3 p-5">
              <div>
                <p className="flex items-baseline justify-between gap-3 font-medium">{r.name}<span className="text-xs font-normal text-subtle">{r.member_count} member{r.member_count === 1 ? "" : "s"}</span></p>
                <p className="mt-1 text-sm leading-relaxed text-muted">{r.description}</p>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
